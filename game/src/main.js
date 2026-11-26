// main.js — renderer, input, game loop, screen state, and the window.__kit
// staging API the screenshot harness drives. No network, no build step.

import * as THREE from 'three';
import { buildWorld, PAD, groundHeight } from './terrain.js';
import { buildHelicopter, poseHelicopter, animateHelicopter } from './helicopter.js';
import { freshState, step, LIMITS } from './flight-model.js';
import { MISSIONS, missionState, updateMission, nextTarget, nextTargetPos } from './missions.js';
import { freshWinch, updateWinch, reelIn } from './winch.js';
import { drawAll } from './instruments.js';
import { updateHUD, setMessage, showHUD, renderPersistentBars, showDecision } from './hud.js';
import { makeCamera, updateCamera, CAM_MODES } from './camera.js';
import { ensureAudio, updateAudio, chime, thud } from './audio.js';
import { record, logEvent, addFlightTime, GAME } from './saves.js';
import { radio } from './radio.js';
import { showTitle, showProof, showPause, showEnd, showLog, hideScreens } from './screens.js';

// --- renderer / scene ------------------------------------------------------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(1);
const scene = new THREE.Scene();
const camera = makeCamera();
const world = buildWorld(scene);
const heli = buildHelicopter();
scene.add(heli);

let flight = freshState();
let winch = freshWinch();
let missionId = 1;
let mission = missionState(1);
let camMode = 'chase';
let camIndex = 0;
let prevCamMode = '';
let screen = 'title'; // title | flying | paused | ended | proof | log
let frozen = false; // capture harness freezes physics after the cover shot
let frames = 0;
let lastT = performance.now();
let msgShown = false;
let drive = null; // harness steering: {pitch, bank, yaw, collective} -1..1, merged with keys
let flightSeconds = 0;

// --- mission control -------------------------------------------------------
function beginMission(id, count = true) {
  const def = MISSIONS[id - 1];
  missionId = id;
  mission = missionState(id);
  winch = freshWinch();
  flight = freshState();
  Object.assign(flight, def.spawn);
  flight.pitch = 0; flight.bank = 0; flight.vx = 0; flight.vy = 0; flight.vz = 0;
  flight.fuel = 100; flight.damage = 0; flight.cableWear = record.cableWear;
  flightSeconds = 0;
  world.setWeather(def.weather === 'whiteout' ? 'whiteout' : def.weather === 'night' ? 'storm' : 'storm');
  camMode = 'chase'; camIndex = 0;
  if (count) {
    record.missionsFlown += 1;
    logEvent(`Mission ${id} started — ${def.name}`);
    radio('SUMMIT CONTROL', `LIFT-07, CLEARED FOR ${def.name.toUpperCase()}`);
    radio('SUMMIT CONTROL', def.brief.toUpperCase());
  }
  setMessage(def.name + ' — ' + def.brief, 5);
  hideScreens();
  showHUD(true);
  applyCamVisibility();
  screen = 'flying';
  msgShown = false;
}

function parkAtBase() {
  // Title backdrop: the heli sits on the hospital helipad at dawn.
  flight = freshState();
  flight.x = PAD.x + 8; flight.y = PAD.y + 1.6; flight.z = PAD.z + 6;
  flight.heading = 0.5; flight.collective = 0; flight.rotorRpm = 88;
  flight.onGround = true;
  poseHelicopter(heli, flight);
}

function applyCamVisibility() {
  const cockpit = camMode === 'cockpit';
  document.getElementById('canopy').classList.toggle('on', cockpit && screen === 'flying');
  document.getElementById('panel').classList.toggle('on', cockpit && screen === 'flying');
  document.getElementById('reticle').style.display = cockpit && screen === 'flying' ? 'block' : 'none';
  document.getElementById('winch-cam').style.display = screen === 'flying' ? 'block' : 'none';
  layoutPersistentBars();
}

// Persistent slim bars: the top bar shows on the proof + title screens
// (where the full HUD is hidden); the bottom gauge bar shows there too, and
// in chase/winch view while flying (where the big cockpit panel hides).
// In cockpit flight the panel itself is the bottom bar, so the slim one stays off.
function layoutPersistentBars() {
  const top = document.getElementById('pbar-top');
  const bot = document.getElementById('pbar-bottom');
  const staticScreen = screen === 'proof' || screen === 'title';
  top.style.display = staticScreen ? 'flex' : 'none';
  bot.style.display = (staticScreen || (screen === 'flying' && camMode !== 'cockpit')) ? 'flex' : 'none';
}

function endMission(title, text) {
  showHUD(false);
  showEnd(title, text);
  screen = 'ended';
}

const hooks = {
  onComplete: (def) => {
    chime(1318);
    setMessage(def.name + ' COMPLETE', 5);
  },
  onCrash: (reason) => {
    thud();
    radio('SUMMIT CONTROL', 'MAYDAY — RESCUE LAUNCHED');
    endMission('SORTIE LOST', reason === 'pad impact'
      ? 'Down on the pad. The heli is done — press R to fly again.'
      : 'Into the ridge. The mountain keeps what it catches — press R to fly again.');
  },
  onStormFail: (m) => {
    thud();
    endMission('STORM CLOSED IN', 'The storm front arrived before the last survivor was '
      + 'delivered. Press R to fly the mission again — faster this time.');
  },
};

// --- refits (turnaround economy) -------------------------------------------
function applyRefit(i) {
  if (record.refitPoints < 1) return false;
  record.refitPoints -= 1;
  if (i === 0) { flight.fuel = Math.min(100, flight.fuel + 30); logEvent('Refit: fuel +30%'); }
  if (i === 1) { flight.damage = 0; logEvent('Refit: airframe repaired'); }
  if (i === 2) { flight.cableWear = 0; record.cableWear = 0; logEvent('Refit: new winch cable'); }
  radio('SUMMIT CONTROL', 'REFIT DONE — SHE IS READY FOR THE NEXT ONE');
  return true;
}

// --- input -----------------------------------------------------------------
const keys = {};
let drag = null;

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys[e.code] = true;
  ensureAudio();
  const code = e.code;
  if (code === 'KeyC' && screen === 'flying') {
    camIndex = (camIndex + 1) % CAM_MODES.length;
    camMode = CAM_MODES[camIndex];
    applyCamVisibility();
    setMessage('CAMERA — ' + camMode.toUpperCase(), 2);
  }
  if (code === 'Space' && screen === 'flying') {
    if (reelIn(winch)) setMessage('REELING IN — SURVIVOR COMING UP', 3);
    e.preventDefault();
  }
  if (code === 'KeyP') {
    if (screen === 'flying') { screen = 'paused'; showPause(); }
    else if (screen === 'paused') { screen = 'flying'; hideScreens(); }
  }
  if (code === 'KeyR' && (screen === 'flying' || screen === 'ended' || screen === 'paused')) beginMission(missionId);
  if (code === 'KeyM') {
    if (screen === 'flying') { screen = 'log'; showLog(); }
    else if (screen === 'log') { screen = 'flying'; hideScreens(); }
    else if (screen === 'paused') { screen = 'log'; showLog(); }
  }
  if (code === 'Digit1' || code === 'Digit2' || code === 'Digit3' || code === 'Digit4') {
    if (screen === 'flying' && record.decision === null && flight.fuel <= 12) {
      // the FUEL LOW decision: 1 = RTB to the pad, 2 = press on
      if (code === 'Digit1') {
        record.decision = 'RTB';
        radio('LIFT-07', 'SUMMIT CONTROL, LIFT-07 RTB — LOW FUEL');
        radio('SUMMIT CONTROL', 'ROGER, RTB — PAD IS LIT FOR YOU');
        showDecision(false);
        setMessage('DECISION — RTB TO THE PAD', 4);
      } else if (code === 'Digit2') {
        record.decision = 'PRESS ON';
        radio('LIFT-07', 'SUMMIT CONTROL, LIFT-07 PRESSING ON');
        radio('SUMMIT CONTROL', 'ROGER — WATCH THE FUEL, THE STORM IS COMING');
        showDecision(false);
        setMessage('DECISION — PRESSING ON', 4);
      }
      return;
    }
    if (screen !== 'title') beginMission(Number(code.slice(-1)));
  }
  if (code === 'Enter' && screen === 'title') beginMission(missionId);
  if (code === 'Escape' && screen === 'log') { screen = 'flying'; hideScreens(); }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, dx: 0, dy: 0 }; ensureAudio(); });
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  drag.dx = e.clientX - drag.x; drag.dy = e.clientY - drag.y;
});
window.addEventListener('pointerup', () => { drag = null; });

document.getElementById('btn-fly').addEventListener('click', () => { ensureAudio(); beginMission(missionId); });
document.getElementById('btn-resume').addEventListener('click', () => { screen = 'flying'; hideScreens(); });
document.getElementById('btn-again').addEventListener('click', () => beginMission(missionId));
document.getElementById('btn-proof-back').addEventListener('click', () => {
  if (screen === 'proof') { screen = 'flying'; hideScreens(); showHUD(true); }
});
document.getElementById('btn-log-back').addEventListener('click', () => { screen = 'flying'; hideScreens(); });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- main loop -------------------------------------------------------------
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - lastT) / 1000 || 0.016);
  lastT = now;
  frames += 1;
  const t = now / 1000;
  world.tick(t);

  if (screen === 'flying' && !frozen) {
    // stick: arrows fly (up = forward), A/D yaw, W/S collective, drag steers.
    // The harness drive overrides keys when set (same input path, real physics).
    const pitchIn = (keys.ArrowUp ? -1 : 0) + (keys.ArrowDown ? 1 : 0)
      + (drag ? drag.dy / 120 : 0) + (drive ? drive.pitch : 0);
    const bankIn = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0)
      + (drag ? drag.dx / 120 : 0) + (drive ? drive.bank : 0);
    const yawIn = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + (drive ? drive.yaw : 0);
    const collIn = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) + (drive ? drive.collective : 0);
    // storm gusts: a slow sinusoid crosswind, stronger per mission
    const gust = Math.sin(t * 0.35) * MISSIONS[missionId - 1].gust
      + Math.sin(t * 0.9) * MISSIONS[missionId - 1].gust * 0.4;
    step(flight, {
      pitch: Math.max(-1, Math.min(1, pitchIn)),
      bank: Math.max(-1, Math.min(1, bankIn)),
      yaw: Math.max(-1, Math.min(1, yawIn)),
      collective: Math.max(-1, Math.min(1, collIn)),
    }, dt, gust);
    flightSeconds += dt;
    addFlightTime(dt);
    world.markNext?.(nextTargetPos(mission, world), flight);
    const wEvent = updateWinch(winch, flight, world.rings.find((r) => r.label === mission.def.ringLabel || r.site === mission.def.ring) || world.rings[0], mission, dt, flightSeconds);
    if (wEvent) { setMessage(wEvent, 4); if (/HOOK|ABOARD|LOCK/.test(wEvent)) chime(988); }
    const mEvent = updateMission(mission, flight, winch, world, hooks, dt);
    if (mEvent) { setMessage(mEvent, 5); if (/COMPLETE|DELIVERED/.test(mEvent)) chime(1318); }
    updateHUD(flight, MISSIONS[missionId - 1], nextTarget(mission, world, flight), dt, mission, camMode, winch);
    drawAll(flight, winch);
    updateAudio(flight.collective, flight.speed);
    if (flight.fuel <= 0 && !msgShown) { msgShown = true; setMessage('FUEL EMPTY — AUTOROTATING DOWN, FIND THE PAD', 5); }
  }

  poseHelicopter(heli, flight);
  animateHelicopter(heli, flight, winch.cableLen, t);
  const camForView = screen === 'title' ? 'orbit' : camMode;
  const snapCam = camForView !== prevCamMode;
  prevCamMode = camForView;
  const tgt = nextTargetPos(mission, world);
  updateCamera(camera, flight, camForView, t, snapCam, tgt);
  renderer.render(scene, camera);
}

// --- public handles for the capture harness + debugging --------------------
window.__game = {
  get frames() { return frames; },
  get screen() { return screen; },
  get missionId() { return missionId; },
  get camMode() { return camMode; },
  get save() { return record; },
  get flight() { return flight; },
  get mission() { return mission; },
  get winch() { return winch; },
  get flightSeconds() { return flightSeconds; },
  beginMission,
  applyRefit,
  heli, world, camera,
};

window.__kit = {
  freeze() { frozen = true; },
  unfreeze() { frozen = false; },
  groundHeight,
  setDrive(d) { drive = d; },
  clearDrive() { drive = null; },
  reel() { reelIn(winch); },
  inFrame(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return {
      x: Math.round((v.x + 1) / 2 * window.innerWidth),
      y: Math.round((1 - v.y) / 2 * window.innerHeight),
      visible: v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1,
    };
  },
  // Shot A — fly mission 1 from the pad (the harness drives the rescue).
  stageRescue() {
    beginMission(1);
    camMode = 'chase'; camIndex = 0; applyCamVisibility();
    setMessage('RIDGE RESCUE — FLY TO THE BEACON', 6);
  },
  // Test-only staging: the exact post-delivery state (rescue 1 delivered,
  // heli on the pad) so the harness can probe the takeoff in isolation.
  stagePadTakeoff() {
    beginMission(1, false);
    mission.delivered = 1;
    mission.lastRescue = { steadiness: 85, winchTime: 9.8, sink: 0.7, fuelLeft: 79, verdict: 'soft', points: 400, stars: 2, delivered: 1, of: 3 };
    record.rescuesDelivered = 1; record.stars = 2; record.missionScores[1] = 1400;
    record.score = 1400; record.bestScore = 1400; record.refitPoints = 1; record.bestLandingVs = 0.7;
    flight.x = 0; flight.y = PAD.y + 2; flight.z = PAD.z + 1;
    flight.vx = 0; flight.vy = 0; flight.vz = 0; flight.heading = 0;
    flight.collective = 0.5; flight.fuel = 79; flight.onGround = false;
    camMode = 'chase'; camIndex = 0; applyCamVisibility();
    setMessage('RESUCE 1 DELIVERED — NEXT CLIMBER WAITS AT THE RING', 6);
  },
  // Shot 1 — cover: chase view, hovering over the ring, survivor on the hook.
  // The record is the real one earned in the flight; only the camera and the
  // hover position are staged (same pattern as NIGHT DECK's stageCover).
  stageCover() {
    const ring = MISSIONS[0].ring;
    // 12 m south of the ring centre, facing it: the ring reads ahead-below
    // in the chase frame (directly underneath it drops out of frame) and
    // the survivor hangs just off the ring as she lifts away.
    flight.x = ring.x + 1; flight.y = ring.y + 24; flight.z = ring.z + 12;
    flight.vx = 0; flight.vy = 0; flight.vz = 0;
    flight.heading = 0.15; flight.pitch = 0; flight.bank = 0;
    flight.collective = 0.5; flight.onGround = false;
    winch.phase = 'on-hook'; winch.survivorOnHook = true; flight.survivorOnHook = true;
    winch.cableLen = Math.max(0, flight.y - groundHeight(flight.x, flight.z) - 1.2);
    camMode = 'chase'; camIndex = 0; applyCamVisibility();
    setMessage('SURVIVOR ON HOOK +500 — REEL IN', 6);
    radio('SUMMIT CONTROL', 'SURVIVOR ON THE HOOK +500 — REEL HER IN');
  },
  // Shot 2 — cockpit in the storm, survivor on the hook, panel lit.
  stageStorm() {
    // Turned for home (north, toward the pad): the cockpit shows the valley
    // and the lit pad ahead instead of a rock wall behind the ring.
    flight.heading = 0;
    camMode = 'cockpit'; camIndex = 1; applyCamVisibility();
    world.setWeather('storm');
    setMessage('SURVIVOR ON HOOK — FLY HER HOME', 6);
  },
  // Shot 3 — proof screen (debrief of the rescue just delivered).
  stageProof() {
    screen = 'proof'; showHUD(false);
    renderPersistentBars(flight, MISSIONS[missionId - 1], mission, camMode);
    layoutPersistentBars(); showProof(mission.lastRescue);
  },
  // Shot 4 — title screen (flight-plan briefing board).
  stageTitle() {
    parkAtBase(); missionId = 1; screen = 'title'; showHUD(false);
    renderPersistentBars(flight, MISSIONS[0], missionState(1), camMode);
    layoutPersistentBars(); showTitle();
  },
};

// --- boot ------------------------------------------------------------------
parkAtBase();
showTitle();
requestAnimationFrame(loop);
