// capture.mjs — 4-shot capture + checks for SUMMIT LIFT.
// Headless Chromium over CDP (Node built-in WebSocket), game/ served from
// localhost, three.js vendored. Run: node capture.mjs
// Output: screenshots/01-cover.jpg, 02-night.jpg, 03-proof.jpg, 04-title.jpg
//         contact-sheet.jpg + checks.json at the repo root (NOT in screenshots/,
//         so the dossier holds exactly the 4 judged images).
//
// The harness FLIES A REAL RESCUE through the game's own input path: a
// proportional controller sets window.__kit.drive (pitch/bank/yaw/collective)
// every poll and the physics + winch state machine do the rest — hover lock,
// cable down, clip, reel, fly home, soft pad landing, all real events.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8333;
const CHROME = process.env.HOME + '/.cache/ms-playwright/chromium-1148/chrome-linux/chrome';
const BASE = `http://127.0.0.1:${PORT}/game/index.html`;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg' };

const server = http.createServer((req, res) => {
  try {
    const url = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const file = path.join(ROOT, url);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

async function main() {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'summitlift-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    '--use-gl=angle', '--use-angle=swiftshader',
    '--window-size=1280,993', '--hide-scrollbars',
    `--user-data-dir=${profile}`, '--remote-debugging-port=9226',
    '--enable-logging=stderr', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let chromeLog = '';
  chrome.stderr.on('data', (d) => { chromeLog += d.toString(); });
  const checks = {};
  const check = (name, ok, detail = '') => {
    checks[name] = { pass: !!ok, detail: String(detail).slice(0, 300) };
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  };
  const failedRequests = [];
  try {
    let targets = null;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      try { const r = await fetch('http://127.0.0.1:9226/json/list'); targets = await r.json(); if (targets?.length) break; } catch {}
    }
    if (!targets?.length) throw new Error('devtools never came up');
    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result?.result?.value;
    };
    const shot = async (name) => {
      const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
      fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, 'base64'));
    };

    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    const consoleErrors = [];
    const origOnMsg = ws.onmessage;
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Network.loadingFailed') failedRequests.push(m.params?.errorText || 'failed');
      if (m.method === 'Network.responseReceived' && m.params?.response?.status >= 400) failedRequests.push(m.params.response.status + ' ' + m.params.response.url);
      if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(JSON.stringify(m.params?.exceptionDetails).slice(0, 200));
      origOnMsg(ev);
    };
    await send('Page.navigate', { url: BASE });
    await sleep(5000);
    // Fly at a small viewport (SwiftShader renders ~4x faster), restore full
    // 1280x993 before every shot — the game resizes on the resize event.
    const setViewport = async (w, h) => {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await sleep(1200);
    };
    await setViewport(640, 497);
    check('boot: game object + first frames rendered', await evalJs(`!!window.__game && window.__game.frames > 5`), `frames=${await evalJs('window.__game.frames')}`);
    check('boot: title screen visible', await evalJs(`document.getElementById('title-screen').classList.contains('on')`));
    check('boot: 4 missions listed on the flight plan', await evalJs(`document.querySelectorAll('#mission-table .mrow').length === 4`));
    check('boot: 3 pilot slots on title', await evalJs(`document.querySelectorAll('#slots .slot').length === 3`));
    check('boot: turnaround refit row present', await evalJs(`document.getElementById('refit-row').textContent.includes('REFIT')`));
    check('boot: base card names Summit Base helipad', await evalJs(`document.querySelector('.base-card').textContent.includes('HELIPAD 07')`));

    const state = () => evalJs(`(() => { const f = window.__game.flight, w = window.__game.winch, m = window.__game.mission, s = window.__game.save;
      return { x: f.x, y: f.y, z: f.z, vx: f.vx, vy: f.vy, vz: f.vz, speed: f.speed, heading: f.heading,
        collective: f.collective, fuel: f.fuel, gust: f.gust, gh: window.__kit.groundHeight(f.x, f.z),
        onGround: f.onGround, crashed: f.crashed, screen: window.__game.screen,
        phase: w.phase, cableLen: w.cableLen, delivered: m.delivered, aboard: m.aboard, done: m.done,
        stormLeft: m.stormLeft, score: s.score, rescued: s.rescuesDelivered, stars: s.stars,
        lastRescue: m.lastRescue, stormFailed: m.stormFailed }; })()`);
    const snapshot = () => evalJs(`(() => { const s = window.__game.save; return { callsign: s.callsign, score: s.score,
      missionsFlown: s.missionsFlown, rescued: s.rescuesDelivered, stars: s.stars,
      flight: s.flightMinutes + ':' + Math.floor(s.flightSeconds) }; })()`);
    const legibility = async () => evalJs(`(() => {
      const problems = [];
      const els = document.querySelectorAll('.hud-box, #hud-msg, #hud-warn, #hud-decision, #radio-log, #checklist, #winch-cam, #hud-wind, #hud-hint, .slot, .pcell, .scell, .controls, .big-btn, #title-screen h1, #title-screen h2, #proof-screen h1, #proof-screen h2, #end-screen h1, .mrow, .base-card, #refit-row');
      for (const el of els) {
        if (getComputedStyle(el).display === 'none') continue;
        const scr = el.closest('.screen');
        if (scr && getComputedStyle(scr).display === 'none') continue;
        if (el.closest('#hud') && getComputedStyle(document.getElementById('hud')).display === 'none') continue;
        if (el.closest('#panel') && getComputedStyle(document.getElementById('panel')).display === 'none') continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.left < -1 || r.top < -1 || r.right > 1281 || r.bottom > 994) problems.push('out-of-frame ' + (el.id || el.className));
        if (el.scrollWidth > el.clientWidth + 1) problems.push('h-overflow ' + (el.id || el.className) + ' ' + el.scrollWidth + '>' + el.clientWidth);
      }
      return problems;
    })()`);

    // --- the rescue controller: steer through the game's own input path ---
    // target: {x, y, z} world point + desired altitude mode ('hover' | 'land')
    async function driveTo(tx, ty, tz, mode, until, timeoutMs, label) {
      const t0 = Date.now();
      let st = await state();
      let polls = 0;
      let ix = 0, iz = 0; // integral of position error (near target only) — kills
      // the gust's steady-state offset so the hover centres inside 3 m.
      console.log(`[drive] ${label} start — pos=(${st.x.toFixed(0)},${st.y.toFixed(0)},${st.z.toFixed(0)}) phase=${st.phase}`);
      while (Date.now() - t0 < timeoutMs) {
        st = await state();
        polls++;
        if (polls % 20 === 0) console.log(`[drive] ${label} poll ${polls} — pos=(${st.x.toFixed(0)},${st.y.toFixed(0)},${st.z.toFixed(0)}) vy=${st.vy.toFixed(1)} spd=${st.speed.toFixed(1)} phase=${st.phase} storm=${Math.round(st.stormLeft)}`);
        if (st.crashed || st.screen === 'ended') throw new Error(label + ' ended: crashed / ' + st.screen);
        if (until(st)) return st;
        const dx = tx - st.x, dz = tz - st.z;
        const distH = Math.hypot(dx, dz);
        // climb-first: while a big climb is owed, cap horizontal speed so the
        // heli gains height faster than rising terrain can meet it.
        const tyEff0 = mode === 'land' && distH < 15 ? ty : Math.max(ty, st.gh + 28);
        const climbing = tyEff0 - st.y > 25;
        const spd = climbing ? Math.min(6, distH * 0.18)
          : mode === 'land' ? Math.min(8, distH * 0.25) : Math.min(16, distH * 0.18);
        let dvx = distH > 0.5 ? (dx / distH) * spd : 0;
        let dvz = distH > 0.5 ? (dz / distH) * spd : 0;
        if (distH < 25) { ix = clamp(ix + dx * 0.02, -3, 3); iz = clamp(iz + dz * 0.02, -3, 3); }
        else { ix = 0; iz = 0; }
        dvx += ix; dvz += iz;
        // gust feedforward: the flight model adds gust * right-vector to the
        // target velocity, so command the desired velocity minus the gust.
        // Without this the heli settles ~15–25 m off-target in the storm.
        dvx -= st.gust * Math.cos(st.heading);
        dvz -= st.gust * Math.sin(st.heading);
        // body frame: forward = (sin h, -cos h), right = (cos h, sin h)
        const fh = Math.sin(st.heading), fz = -Math.cos(st.heading);
        const rh = Math.cos(st.heading), rz = Math.sin(st.heading);
        const fwdVel = dvx * fh + dvz * fz - (st.vx * fh + st.vz * fz);
        const rightVel = dvx * rh + dvz * rz - (st.vx * rh + st.vz * rz);
        // desired vertical speed from altitude error, then collective for it.
        // Cruise altitude is terrain-aware: never command below ground+28
        // except on the final pad descent (distH < 15, land mode).
        const tyEff = (mode === 'land' && distH < 15) ? ty : Math.max(ty, st.gh + 28);
        const altErr = tyEff - st.y;
        const desVy = clamp(altErr * 0.5, mode === 'land' ? -2.2 : -3, 4);
        const desColl = 0.5 + desVy / 18;
        const drive = {
          pitch: clamp(-fwdVel / 8, -1, 1),
          bank: clamp(rightVel / 7, -1, 1),
          yaw: 0,
          collective: clamp((desColl - st.collective) * 4, -1, 1),
        };
        // face the target when far away
        if (distH > 30) {
          const want = Math.atan2(dx, -dz);
          let err = want - st.heading;
          while (err > Math.PI) err -= 2 * Math.PI;
          while (err < -Math.PI) err += 2 * Math.PI;
          drive.yaw = clamp(err * 1.0, -1, 1);
        }
        await evalJs(`window.__kit.setDrive(${JSON.stringify(drive)})`);
        await sleep(300);
      }
      throw new Error(label + ' timed out after ' + timeoutMs + 'ms — ' + JSON.stringify(st));
    }

    // --- PHASE A: fly rescue 1 for real: ring → hover lock → clip → reel → pad ---
    await evalJs(`window.__kit.stageRescue()`);
    await sleep(800);
    const RING = { x: 0, y: 118, z: -260 };
    const PADP = { x: 0, y: 62, z: -640 };
    // 1) fly to the ring and hold the hover until the winch clips on
    await driveTo(RING.x, RING.y + 24, RING.z, 'hover', (st) => st.phase === 'on-hook', 300000, 'fly to ring + clip 1');
    let st = await state();
    check('play: hover lock earned for real (phase on-hook)', st.phase === 'on-hook', `phase=${st.phase} score=${st.score}`);
    check('play: survivor on the hook scores +500 (score >= 800)', st.score >= 800, `score=${st.score}`);
    check('play: radio log reports the hook (SUMMIT CONTROL)', await evalJs(`document.getElementById('radio-log').textContent.includes('SUMMIT CONTROL') && document.getElementById('radio-log').textContent.includes('HOOK')`));
    // 2) reel in, then fly home and land soft on the pad
    await evalJs(`window.__kit.reel()`);
    await driveTo(RING.x, RING.y + 30, RING.z, 'hover', (s2) => s2.phase === 'aboard', 30000, 'reel in');
    st = await state();
    check('play: survivor aboard for real (+200)', st.phase === 'aboard' && st.score >= 1000, `phase=${st.phase} score=${st.score}`);
    await driveTo(PADP.x, PADP.y + 14, PADP.z, 'hover', (s2) => Math.hypot(s2.x - PADP.x, s2.z - PADP.z) < 12, 300000, 'fly home to the pad');
    await driveTo(PADP.x, PADP.y + 1.2, PADP.z, 'land', (s2) => s2.delivered >= 1, 240000, 'soft pad landing');
    st = await state();
    await evalJs(`window.__kit.clearDrive()`);
    check('play: rescue 1 delivered for real (delivered = 1)', st.delivered === 1, `delivered=${st.delivered} score=${st.score}`);
    check('play: full rescue scores 1400 (300 lock + 500 hook + 200 aboard + 400 soft)', st.score === 1400, `score=${st.score}`);
    check('play: debrief measures recorded (steadiness, winch time, soft sink)', !!st.lastRescue && st.lastRescue.steadiness > 0 && st.lastRescue.winchTime > 0 && st.lastRescue.sink <= 3.0,
      JSON.stringify(st.lastRescue));
    check('play: fuel burned (not 100%)', st.fuel < 99, `fuel=${st.fuel}`);
    check('play: storm clock ticking (under 12:00)', st.stormLeft < 720 && st.stormLeft > 0, `stormLeft=${st.stormLeft}`);

    // --- PHASE B: climber 2 — fly back to the ring, hover, clip on ---
    await driveTo(RING.x, RING.y + 24, RING.z, 'hover', (s2) => s2.phase === 'on-hook', 300000, 'fly to ring + clip 2');
    st = await state();
    check('play: second survivor on the hook (score 2200)', st.score === 2200, `score=${st.score} phase=${st.phase}`);

    // --- SHOT 2: cockpit in the storm, survivor on the hook, panel lit ---
    await setViewport(1280, 993);
    await evalJs(`window.__kit.stageStorm()`);
    await sleep(900);
    await shot('02-night.jpg');
    const snap1 = await snapshot();
    check('legibility: night shot', (await legibility()).length === 0, JSON.stringify(await legibility()));
    check('play: cockpit panel lit (7 gauges drawn)', await evalJs(
      `['g-att','g-rpm','g-spd','g-alt','g-vs','g-hdg','g-fuel'].every(id => { const c = document.getElementById(id); const g = c.getContext('2d'); const d = g.getImageData(0,0,c.width,c.height).data; let lit = 0; for (let i = 0; i < d.length; i += 400) if (d[i]+d[i+1]+d[i+2] > 60) lit++; return lit > 20; })`));
    check('play: winch-cam inset drawn (ring + heli dot)', await evalJs(
      `(() => { const c = document.getElementById('winch-cam-c'); const g = c.getContext('2d'); const d = g.getImageData(0,0,c.width,c.height).data; let lit = 0; for (let i = 0; i < d.length; i += 40) if (d[i]+d[i+1]+d[i+2] > 60) lit++; return lit > 5; })()`));

    // --- SHOT 1: cover — chase view, hovering over the ring, survivor on hook ---
    await evalJs(`window.__kit.stageCover()`);
    await sleep(900);
    const ringPos = await evalJs(`window.__kit.inFrame(0, 118, -260)`);
    const padPos = await evalJs(`window.__kit.inFrame(0, 62, -640)`);
    await shot('01-cover.jpg');
    await evalJs(`window.__kit.freeze()`);
    const snap0 = await snapshot();
    check('cover: rescue ring ahead in frame', ringPos.visible, JSON.stringify(ringPos));
    check('cover: lit hospital pad ahead in frame', padPos.visible, JSON.stringify(padPos));
    check('cover: earned score on the HUD (2200, matches the record)', await evalJs(
      `document.getElementById('hud-score-v').textContent.replace(/,/g,'') === String(window.__game.save.score) && window.__game.save.score === 2200`), `score=${snap0.score}`);
    check('cover: rescued progress on the HUD (1/7)', await evalJs(`document.getElementById('hud-score-sub').textContent`) === 'RESCUED 1 / 7 · STARS ' + (await evalJs('window.__game.save.stars')) + ' / 21', await evalJs(`document.getElementById('hud-score-sub').textContent`));
    check('cover: storm timer on the HUD (counts down from 12:00)', await evalJs(`document.getElementById('hud-storm-v').textContent`) !== '12:00', await evalJs(`document.getElementById('hud-storm-v').textContent`));
    check('cover: HUD shows altitude + speed + heading + rotor RPM', await evalJs(
      `['hud-alt-v','hud-spd-v','hud-hdg-v','hud-rpm-v'].every(id => document.getElementById(id).textContent.trim() !== '0' && document.getElementById(id).textContent.trim() !== '0%')`));
    check('cover: objective shows live distance to the next target', await evalJs(`document.getElementById('hud-obj-sub').textContent.includes(' m ')`), await evalJs(`document.getElementById('hud-obj-sub').textContent`));
    check('cover: radio log has the named base voice (SUMMIT CONTROL)', await evalJs(`document.getElementById('radio-log').textContent.includes('SUMMIT CONTROL')`));
    check('cover: rescue checklist visible with steps ticked', await evalJs(`document.querySelectorAll('#checklist .cline.done').length >= 3`));
    check('cover: winch state on the HUD (ON-HOOK)', await evalJs(`document.getElementById('hud-winch-v').textContent.includes('ON-HOOK')`));
    check('legibility: cover (no overflow / overlap / out-of-frame)', (await legibility()).length === 0, JSON.stringify(await legibility()));

    // --- SHOT 3: proof screen ---
    await evalJs(`window.__kit.stageProof()`);
    await sleep(700);
    await shot('03-proof.jpg');
    const snap2 = await snapshot();
    check('legibility: proof screen', (await legibility()).length === 0, JSON.stringify(await legibility()));
    check('proof: 6 honest debrief cells shown', await evalJs(`document.querySelectorAll('.pcell').length === 6`));
    check('proof: total score cell shows the session score', await evalJs(
      `document.querySelector('.pcell:nth-child(1) .val').textContent === String(${snap2.score})`));
    check('proof: hover steadiness + winch time + landing softness shown', await evalJs(
      `document.querySelector('.pcell:nth-child(2) .val').textContent.includes('%') && document.querySelector('.pcell:nth-child(3) .val').textContent.includes('S') && document.querySelector('.pcell:nth-child(4) .val').textContent.includes('M/S')`));
    check('proof: session medal + rank + BEST score shown (real values)', await evalJs(
      `document.getElementById('proof-medal').textContent.includes('BEST SCORE 2200') && document.getElementById('proof-medal').textContent.includes('GOLD')`));
    check('proof: rank letter computed from the session', await evalJs(
      `document.getElementById('proof-medal').textContent.includes('RANK A')`));
    check('proof: debrief headline names the delivered survivor', await evalJs(
      `document.getElementById('proof-headline').textContent.includes('SURVIVOR 1 OF 3')`));
    check('proof: incident line from the record (clean session)', await evalJs(
      `document.getElementById('proof-incident').textContent.includes('INCIDENT LOG — Clean session')`));
    check('proof: all 4 missions show a score/medal state', await evalJs(
      `document.querySelectorAll('#proof-sorties .scell').length === 4 && document.getElementById('proof-sorties').textContent.includes('RIDGE RESCUE')`));
    check('proof: pilot-log progress line in the debrief note', await evalJs(
      `document.getElementById('proof-note').textContent.includes('PILOT LOG — RESCUES 1/7')`));
    check('proof: persistent top + bottom bars visible', await evalJs(
      `getComputedStyle(document.getElementById('pbar-top')).display === 'flex' && getComputedStyle(document.getElementById('pbar-bottom')).display === 'flex'`));

    // --- SHOT 4: title screen ---
    await evalJs(`window.__kit.stageTitle()`);
    await sleep(700);
    await shot('04-title.jpg');
    const snap3 = await snapshot();
    check('legibility: title screen', (await legibility()).length === 0, JSON.stringify(await legibility()));
    check('title: 4 missions with different goals listed', await evalJs(
      `['RIDGE RESCUE','NIGHT MEDEVAC','BLIZZARD RUN','VALLEY FERRY'].every(n => document.getElementById('mission-table').textContent.includes(n))`));
    check('title: mission 1 shows its earned score', await evalJs(
      `document.getElementById('mission-table').textContent.includes('2200 PTS')`));
    check('title: turnaround refit row visible (live points)', await evalJs(
      `document.getElementById('refit-row').textContent.includes('REFIT POINTS: ' + window.__game.save.refitPoints)`));
    check('title: persistent top + bottom bars visible', await evalJs(
      `getComputedStyle(document.getElementById('pbar-top')).display === 'flex' && getComputedStyle(document.getElementById('pbar-bottom')).display === 'flex'`));
    check('title: top bar shows the session score', await evalJs(
      `document.getElementById('pbar-top-r').textContent.includes('SCORE 2200')`));

    // --- Consistency: proof and title show the same pilot record ---
    const same = snap2.callsign === snap3.callsign && snap2.rescued === snap3.rescued
      && snap2.stars === snap3.stars && snap2.missionsFlown === snap3.missionsFlown
      && snap2.score === snap3.score;
    check('consistency: proof vs title record identical', same, JSON.stringify([snap2, snap3]));

    // --- Console / network ---
    await sleep(300);
    const errs = chromeLog.split('\n').filter((l) => /Uncaught|net::ERR_|Failed to load resource/.test(l));
    check('zero console errors', errs.length === 0 && consoleErrors.length === 0, [...errs.slice(0, 2), ...consoleErrors.slice(0, 2)].join(' | '));
    check('zero failed network requests', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | '));

    // --- Files exist + size/dimension limits (gate: each ≤256 KiB, long side ≤1280, short ≥480) ---
    for (const f of ['01-cover.jpg', '02-night.jpg', '03-proof.jpg', '04-title.jpg']) {
      const st = fs.statSync(path.join(OUT, f));
      check(`file: ${f} exists (${Math.round(st.size / 1024)} KB, ≤256 KiB)`, st.size > 20000 && st.size <= 262144, `${st.size} bytes`);
    }

    // --- Contact sheet: cover large on top, 3 small below (PIL), at repo root ---
    const sheetOk = await new Promise((res) => {
      execFile('python3', ['-c', `
from PIL import Image
import os
out = r'${OUT}'
root = r'${ROOT}'
cover = Image.open(os.path.join(out, '01-cover.jpg')).convert('RGB').resize((1280, 800))
print('cover size', Image.open(os.path.join(out, '01-cover.jpg')).size)
small = [Image.open(os.path.join(out, f)).convert('RGB').resize((416, 260)) for f in ['02-night.jpg', '03-proof.jpg', '04-title.jpg']]
sheet = Image.new('RGB', (1280, 800 + 8 + 260), (16, 16, 16))
sheet.paste(cover, (0, 0))
for i, im in enumerate(small):
    sheet.paste(im, (i * 424 + 4, 808))
sheet.save(os.path.join(root, 'contact-sheet.jpg'), quality=88)
print('sheet', sheet.size)
`], (err, stdout, stderr) => { if (err) console.log('sheet build failed:', stderr); else console.log(stdout.trim()); res(!err); });
    });
    check('contact sheet built', sheetOk && fs.existsSync(path.join(ROOT, 'contact-sheet.jpg')));

    fs.writeFileSync(path.join(ROOT, 'checks.json'), JSON.stringify({ shots: [snap0, snap1, snap2, snap3], checks }, null, 2));
    const fails = Object.values(checks).filter((c) => !c.pass).length;
    console.log(`\n${fails} FAILURES`);
    if (fails) process.exitCode = 1;
  } finally {
    chrome.kill();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
    server.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
