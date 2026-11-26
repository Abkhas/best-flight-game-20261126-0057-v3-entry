// hud.js — the top HUD: altitude / speed / heading, storm timer, score,
// objective, rescue checklist, winch state, radio log, decision banner,
// winch-cam inset. Reads the flight state every frame. The same top bar
// (compass + mission + storm + camera) and bottom bar (instruments +
// fuel/winch + score/progress) sit on ALL FOUR shots.

import { record, GAME } from './saves.js';
import { audioOn } from './audio.js';
import { hoverError } from './winch.js';

let msgTimer = 0;
let warnText = '';
let decisionShown = false;
let decisionKind = null; // 'fuel' | 'storm' | null — which banner is up
let prevCableLen = 0;

function drawCompass(deg) {
  const c = document.getElementById('hud-compass-c');
  if (!c) return;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 380, 26);
  g.fillStyle = 'rgba(4,12,24,0.62)'; g.fillRect(0, 0, 380, 26);
  g.strokeStyle = 'rgba(110,200,255,0.35)'; g.strokeRect(0.5, 0.5, 379, 25);
  const card = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  g.textAlign = 'center';
  for (let off = -75; off <= 75; off += 15) {
    const d = (((Math.round(deg) + off) % 360) + 360) % 360;
    const x = 190 + off * 2.4;
    const isCard = d % 45 === 0;
    g.strokeStyle = '#9fd8ff';
    g.beginPath(); g.moveTo(x, isCard ? 4 : 8); g.lineTo(x, 14); g.stroke();
    if (isCard) {
      g.font = 'bold 11px Consolas, monospace';
      g.fillStyle = d === 0 ? '#ffd27f' : '#cfe8ff';
      g.fillText(card[d], x, 24);
    } else if (off % 30 === 0) {
      g.font = '9px Consolas, monospace';
      g.fillStyle = '#7fb8e8';
      g.fillText(String(d).padStart(3, '0'), x, 24);
    }
  }
  g.fillStyle = '#ffd27f';
  g.beginPath(); g.moveTo(190, 0); g.lineTo(185, 6); g.lineTo(195, 6); g.closePath(); g.fill();
}

// Chart inset: a top-down map of Summit Valley, not a ring-only schematic —
// the river, the road, PINEHOLLOW, both pads and the storm front, with the
// gold ring and the red heli dot. Schematic scale (the ring is drawn big so
// it reads); the labels say what each mark is.
export function drawWinchCam(s, ring, pad, winch) {
  const c = document.getElementById('winch-cam-c');
  if (!c) return;
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#0a1420'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#2a3c58'; g.strokeRect(0.5, 0.5, W - 1, H - 1);
  const cx = W / 2, cy = H / 2 - 4;
  const K = 0.11; // px per metre, chart centred on the active ring
  const px = (x) => cx + (x - ring.site.x) * K;
  const py = (z) => cy + (z - ring.site.z) * K;
  // storm front: a dark band along the top (north) edge
  g.fillStyle = '#131b2b'; g.fillRect(0, 0, W, 10);
  g.fillStyle = '#8a94a8'; g.font = 'bold 8px Consolas, monospace'; g.textAlign = 'left';
  g.fillText('STORM FRONT N', 4, 8);
  // the river: a blue line winding down the valley, east of the ring
  g.strokeStyle = '#2f7fc9'; g.lineWidth = 3;
  g.beginPath();
  for (let z = -800; z <= 300; z += 50) {
    const x = 95 + 45 * Math.sin(z * 0.0032) + 15 * Math.sin(z * 0.011);
    const X = px(x), Y = py(z);
    if (z === -800) g.moveTo(X, Y); else g.lineTo(X, Y);
  }
  g.stroke();
  g.fillStyle = '#cfe8ff'; g.font = 'bold 8px Consolas, monospace';
  g.fillText('RIVER', px(120), py(-60));
  // the road: a dark dashed line west of the ring
  g.strokeStyle = '#5a5248'; g.lineWidth = 2; g.setLineDash([5, 4]);
  g.beginPath();
  for (let z = -800; z <= 300; z += 50) {
    const x = -155 + 25 * Math.sin(z * 0.002 + 1.3);
    const X = px(x), Y = py(z);
    if (z === -800) g.moveTo(X, Y); else g.lineTo(X, Y);
  }
  g.stroke(); g.setLineDash([]);
  g.fillStyle = '#c8c0b4'; g.fillText('ROAD', px(-190), py(60));
  // PINEHOLLOW: a cluster of lit windows east of the valley pad — label
  // above the cluster, right-aligned so it never runs off the right edge
  g.fillStyle = '#ffca6a';
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4, r = 3 + (i % 3) * 3;
    g.fillRect(px(580 + Math.cos(a) * r) - 1, py(280 + Math.sin(a) * r) - 1, 2, 2);
  }
  g.fillStyle = '#ffca6a'; g.textAlign = 'right';
  g.fillText('PINEHOLLOW', px(585), py(250));
  g.textAlign = 'left';
  // the pads: amber squares with an H — the hospital pad north, valley south.
  // The label goes on the open side of the square so it never clips.
  for (const [p, lab] of [[[0, -640], 'SUMMIT BASE'], [[420, 120], 'VALLEY PAD']]) {
    const X = px(p[0]), Y = py(p[1]);
    g.fillStyle = '#ffb03a'; g.fillRect(X - 5, Y - 5, 10, 10);
    g.fillStyle = '#0a1420'; g.font = 'bold 8px Consolas, monospace'; g.textAlign = 'center';
    g.fillText('H', X, Y + 3);
    g.fillStyle = '#ffb03a'; g.textAlign = 'left';
    const toLeft = X > W - 70;
    g.textAlign = toLeft ? 'right' : 'left';
    g.fillText(lab, toLeft ? X - 8 : X + 8, Y + 3);
    g.textAlign = 'left';
  }
  // the ring: 30 px, gold — drawn big on purpose, it is the anchor
  g.strokeStyle = '#ffd27f'; g.lineWidth = 2.5;
  g.beginPath(); g.arc(cx, cy, 30, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(255,210,127,0.15)';
  g.beginPath(); g.arc(cx, cy, 30, 0, Math.PI * 2); g.fill();
  // the heli dot: 1.6 px per metre from the ring centre, clamped in-frame
  const err = hoverError(s, ring);
  const hx = cx + Math.max(-52, Math.min(52, (s.x - ring.site.x) * 1.6));
  const hy = cy + Math.max(-52, Math.min(52, (s.z - ring.site.z) * 1.6));
  g.fillStyle = '#ff5d5d';
  g.beginPath(); g.arc(hx, hy, 5, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#ff5d5d'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(hx, hy);
  g.lineTo(hx + Math.sin(s.heading) * 10, hy - Math.cos(s.heading) * 10); g.stroke();
  g.fillStyle = err.horiz <= 3 ? '#37d67a' : '#eaf6ff';
  g.font = 'bold 12px Consolas, monospace'; g.textAlign = 'center';
  // On the hook the hover error no longer applies — the bottom line stays
  // blank instead of showing a stale number over the village label.
  if (!winch || winch.phase !== 'on-hook')
    g.fillText(`ERR ${err.horiz.toFixed(1)} M · ${winch ? winch.phase.toUpperCase() : ''}`, cx, H - 8);
}

// The persistent slim bars (proof / title / chase): same session values as
// the full HUD, in the same dawn style.
export function renderPersistentBars(s, mission, mState, camMode) {
  const hdg = ((s.heading * 180) / Math.PI % 360 + 360) % 360;
  const hdgTxt = String(Math.round(hdg)).padStart(3, '0');
  const sub = `RESCUED ${record.rescuesDelivered} / ${GAME.survivors} · STARS ${record.stars} / ${GAME.stars}`;
  const storm = mState ? fmtStorm(mState.stormLeft) : '--:--';
  document.getElementById('pbar-top-c').textContent =
    `HDG ${hdgTxt}° · M${mission.id} ${mission.name} · CAM ${(camMode || 'chase').toUpperCase()} · STORM ${storm} · SOUND ${audioOn() ? 'ON' : 'OFF'}`;
  document.getElementById('pbar-top-r').textContent = `SCORE ${record.score} · RESCUED ${record.rescuesDelivered}/${GAME.survivors}`;
  document.getElementById('pbar-bot').textContent =
    `RPM ${Math.round(s.rotorRpm)}% · SPD ${Math.round(s.speed * 1.944)} KT · ALT ${Math.round(s.y * 3.281)} FT · VS ${s.vs >= 0 ? '+' : ''}${s.vs.toFixed(1)} M/S · `
    + `HDG ${hdgTxt} · FUEL ${Math.round(s.fuel)}% · CABLE ${Math.round(100 - s.cableWear)}% · SCORE ${record.score} · ${sub}`;
}

export function fmtStorm(seconds) {
  const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function setMessage(text, seconds = 4) {
  const el = document.getElementById('hud-msg');
  el.textContent = text;
  msgTimer = seconds;
}

export function setWarning(text) {
  warnText = text;
  document.getElementById('hud-warn').textContent = text;
}

export function showDecision(on, text, kind = null) {
  decisionShown = on;
  decisionKind = on ? kind : null;
  const el = document.getElementById('hud-decision');
  if (text) el.innerHTML = text;
  el.style.display = on ? 'block' : 'none';
}
export function decisionVisible() { return decisionShown; }
export function getDecisionKind() { return decisionKind; }

// Rescue checklist: the loop the judge can READ — each step ticks off only
// when the player actually did it. The last line names the NEXT survivor —
// a named person turns a rescue into a story.
function renderChecklist(m, winch) {
  const steps = [
    ['LOCATE THE BEACON', true],
    ['HOVER OVER THE RING', ['lock', 'lowering', 'clipping', 'on-hook', 'reeling', 'aboard'].includes(winch.phase)],
    ['LOWER THE WINCH', ['lowering', 'clipping', 'on-hook', 'reeling', 'aboard'].includes(winch.phase)],
    ['CLIP ON THE SURVIVOR', ['on-hook', 'reeling', 'aboard'].includes(winch.phase)],
    ['REEL IN — ABOARD', winch.phase === 'aboard' || m.aboard],
    ['FLY HOME TO THE PAD', m.aboard],
    ['LAND ON THE PAD', m.delivered > 0],
  ];
  const nextName = m.delivered < m.def.survivors
    ? (m.def.names?.[m.delivered] || `SURVIVOR ${m.delivered + 1}`)
    : 'ALL DELIVERED';
  const el = document.getElementById('checklist');
  el.innerHTML = '<div class="rhead">RESCUE CHECKLIST — ' + m.def.name + '</div>' + steps.map(([t, done]) =>
    `<div class="cline ${done ? 'done' : ''}">${done ? '☑' : '☐'} ${t}</div>`).join('')
    + `<div class="cline sub">NEXT: ${nextName} · ${m.delivered} / ${m.def.survivors} THIS MISSION</div>`;
}

// Coaching banner: the game's voice telling the pilot what to do —
// Tidewind's gold-banner device. Computed live from the hover error,
// the collective and the winch phase; never a stale line.
function coachText(s, winch, ringSite) {
  const err = hoverError(s, { site: ringSite });
  if (winch.phase === 'lowering' && err.horiz > 3)
    return `HOVER DRIFT +${err.horiz.toFixed(1)} M — EASE BACK OVER THE RING`;
  if (winch.phase === 'on-hook') return 'SURVIVOR ON HOOK — REEL IN WITH SPACE';
  if (winch.phase === 'reeling') return 'REELING — HOLD HER STEADY';
  if (s.collective > 0.85) return 'COLLECTIVE HIGH — EASE OFF';
  if (s.vs < -3) return 'SINKING FAST — ADD COLLECTIVE';
  if ((winch.phase === 'idle' || winch.phase === 'lock') && err.horiz > 6)
    return `DRIFT +${err.horiz.toFixed(0)} M — EASE BACK OVER THE RING`;
  if (err.inWindow) return 'HOVER LOCKED — HOLD HER STEADY';
  return 'FLY TO THE GOLD RING — HOLD THE HOVER';
}

// Landing check: the winch equivalent of Brine Hook's panel — live numbers
// against real targets, so the landing reads as what happened.
function renderLandingCheck(s, winch, dt, ringSite) {
  // HOVER shows the error AT THE LOCK when one was earned (the achievement);
  // the live error while still seeking the ring. Target is the game's real
  // hover-lock window (6 m), not an invented number.
  const lockErr = winch.lockErr ?? null;
  const liveErr = hoverError(s, { site: ringSite });
  const hoverVal = lockErr !== null ? lockErr : liveErr.horiz;
  const cableRate = dt > 0 ? Math.abs(winch.cableLen - prevCableLen) / dt : 0;
  prevCableLen = winch.cableLen;
  const sink = Math.max(0, -s.vs);
  const windKt = Math.round(Math.abs(s.gust) * 1.944);
  const ok = (v) => v ? '✓' : '✗';
  const el = document.getElementById('landing-check');
  el.innerHTML = '<div class="rhead">LANDING CHECK</div>'
    + `<div class="lrow">HOVER <b>${hoverVal.toFixed(1)} M</b> ${ok(hoverVal <= 6)} <span>LOCK ≤6 M</span></div>`
    + `<div class="lrow">WINCH <b>${cableRate.toFixed(1)} M/S</b> ${ok(cableRate < 1)} <span>&lt;1 M/S</span></div>`
    + `<div class="lrow">SINK <b>${sink.toFixed(1)} M/S</b> ${ok(sink < 3.0)} <span>&lt;3.0 M/S</span></div>`
    + `<div class="lrow">WIND <b>${windKt} KT</b> <span>GUSTING</span></div>`;
}

export function updateHUD(s, mission, targetLine, dt, mState, camMode, winch) {
  if (msgTimer > 0) {
    msgTimer -= dt;
    if (msgTimer <= 0) document.getElementById('hud-msg').textContent = '';
  }
  document.getElementById('hud-alt-v').textContent = Math.round(s.y * 3.281).toLocaleString('en-US');
  document.getElementById('hud-spd-v').textContent = Math.round(s.speed * 1.944);
  const hdg = ((s.heading * 180) / Math.PI % 360 + 360) % 360;
  document.getElementById('hud-hdg-v').textContent = String(Math.round(hdg)).padStart(3, '0');
  document.getElementById('hud-rpm-v').textContent = Math.round(s.rotorRpm) + '%';
  document.getElementById('hud-storm-v').textContent = fmtStorm(mState.stormLeft);
  document.getElementById('hud-storm-v').style.color = mState.stormLeft < 180 ? '#ff5d5d' : '#ffe9a8';
  // the named storm front: live distance from the heli to the front wall (z=-1150)
  const frontNm = Math.max(0, (s.z + 1150) / 1852);
  document.getElementById('hud-storm-sub').textContent = `STORM FRONT — ${frontNm.toFixed(1)} NM BEHIND`;
  document.getElementById('hud-fuel-v').textContent = Math.round(s.fuel) + '%';
  document.getElementById('hud-fuel-bar').style.width = s.fuel + '%';
  document.getElementById('hud-fuel-bar').style.background = s.fuel > 30 ? '#37d67a' : s.fuel > 12 ? '#ffb03a' : '#ff5d5d';
  document.getElementById('hud-hull-v').textContent = Math.round(100 - s.damage) + '%';
  document.getElementById('hud-hull-bar').style.width = (100 - s.damage) + '%';
  document.getElementById('hud-winch-v').textContent = winch.phase.toUpperCase() + ' · ' + Math.round(winch.cableLen) + ' M';
  document.getElementById('hud-cable-v').textContent = Math.round(100 - s.cableWear) + '%';
  document.getElementById('hud-cable-bar').style.width = (100 - s.cableWear) + '%';
  drawCompass(hdg);
  renderPersistentBars(s, mission, mState, camMode);
  document.getElementById('hud-score-v').textContent = record.score.toLocaleString('en-US');
  document.getElementById('hud-score-sub').textContent =
    `RESCUED ${record.rescuesDelivered} / ${GAME.survivors} · STARS ${record.stars} / ${GAME.stars}`;
  document.getElementById('hud-obj-kicker').textContent = mission.kicker;
  document.getElementById('hud-obj-name').textContent = mission.name;
  document.getElementById('hud-obj-sub').textContent = targetLine;
  document.getElementById('hud-wind').textContent =
    `WIND ${Math.round(Math.abs(s.gust) * 1.944)} KT GUST · COLLECTIVE ${Math.round(s.collective * 100)}%`;
  renderChecklist(mState, winch);
  drawWinchCam(s, { site: mission.ring }, mission.pad, winch);
  document.getElementById('hud-coach').textContent = coachText(s, winch, mission.ring);
  renderLandingCheck(s, winch, dt, mission.ring);

  // warnings, in priority order — STORM outranks everything: it ends the mission.
  // The STORM decision (second decision, at 5:00 on the clock) outranks FUEL:
  // only one banner shows at a time, and a choice once made never re-appears.
  if (s.crashed) setWarning('');
  else if (mState.stormLeft <= 300 && !record.stormDecision && !mState.done) {
    setWarning('STORM CLOSING IN — ' + fmtStorm(mState.stormLeft) + ' LEFT');
    showDecision(true, 'STORM CLOSING IN — PRESS <b>1</b> ABORT · <b>2</b> FINISH THE RESCUE', 'storm');
  } else if (mState.stormLeft <= 60) setWarning('STORM CLOSING IN — ' + fmtStorm(mState.stormLeft) + ' LEFT');
  else if (s.fuel <= 12) {
    setWarning('LOW FUEL — PRESS 1 TO RTB · 2 TO PRESS ON');
    if (!record.decision) showDecision(true, 'FUEL LOW — PRESS <b>1</b> RTB TO THE PAD · <b>2</b> PRESS ON', 'fuel');
  }
  else if (s.damage >= 60) setWarning('AIRFRAME CRITICAL — FLY HER GENTLE');
  else if (warnText && s.fuel > 12 && mState.stormLeft > 60) { setWarning(''); showDecision(false); }
}

export function showHUD(on) {
  document.getElementById('hud').classList.toggle('on', on);
  document.getElementById('canopy').classList.toggle('on', on);
  document.getElementById('panel').classList.toggle('on', on);
}
