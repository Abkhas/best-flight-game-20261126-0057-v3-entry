// winch.js — the winch state machine, the distinctive loop. Hover over the
// ring, hold steady, the cable goes down, clips the survivor, reels in.
// Phases: idle → hover-lock → lowering → clipping → on-hook → reeling →
// aboard. Every phase change is a real event the radio log and the score
// report. Hover steadiness is MEASURED during lowering: the share of samples
// inside 3 m of the ring centre — that number is the debrief.

import { groundHeight } from './terrain.js';
import { record, addScore, logEvent } from './saves.js';
import { radio } from './radio.js';

export const WINCH = {
  hoverRadius: 6,      // m horizontal from ring centre to hold the lock — inside
  // the 11 m ring, so the cable goes down from a centred hover (steadiness
  // is measured from here, and a 14 m lock left the heli 10 m off-centre)
  hoverAltMin: 10,     // m above the ground at the ring
  hoverAltMax: 32,
  steadyRadius: 3,     // m — inside this counts as steady
  lockTime: 1.2,       // s of steady hover to earn the lock
  lowerTime: 4.0,      // s for the cable to reach the ground
  clipTime: 1.5,       // s to clip the survivor on
  reelTime: 4.0,       // s to reel the survivor up
};

export function freshWinch() {
  return {
    phase: 'idle',     // idle | lock | lowering | clipping | on-hook | reeling | aboard
    cableLen: 0,       // m of cable out
    lockTimer: 0,
    phaseTimer: 0,
    steadySamples: 0,
    totalSamples: 0,
    hoverSteadiness: null, // % — measured during lowering, null until then
    winchStart: 0,     // flight seconds when lowering started
    winchTime: null,   // s from lower-start to aboard, null until then
    survivorOnHook: false,
    lockErr: null,     // m — hover error at the moment the lock was earned
  };
}

// The winch only works over the ACTIVE ring, inside the hover window.
export function hoverError(s, ring) {
  const dx = s.x - ring.site.x, dz = s.z - ring.site.z;
  const ground = groundHeight(s.x, s.z);
  return {
    horiz: Math.hypot(dx, dz),
    alt: s.y - ground,
    inWindow: Math.hypot(dx, dz) <= WINCH.hoverRadius
      && (s.y - ground) >= WINCH.hoverAltMin && (s.y - ground) <= WINCH.hoverAltMax
      && s.speed < 3.5,
  };
}

// Per-frame winch logic. Returns an event string when something happens.
export function updateWinch(w, s, ring, mission, dt, flightSeconds) {
  if (!ring || mission.done) return null;
  const err = hoverError(s, ring);
  const ground = groundHeight(s.x, s.z);

  if (w.phase === 'idle' || w.phase === 'aboard') {
    if (w.phase === 'aboard') return null; // this survivor is aboard; wait for delivery
    if (err.inWindow) {
      w.lockTimer += dt;
      if (w.lockTimer >= WINCH.lockTime) {
        w.phase = 'lock';
        w.phaseTimer = 0;
        w.lockErr = err.horiz;
        addScore(3000, 'hover lock over the ring', mission.id);
        radio('SUMMIT CONTROL', 'HOVER LOCK — WINCH GOING DOWN');
        logEvent(`Hover lock over ${ring.label} ring — +3000`);
        return 'HOVER LOCK — WINCH GOING DOWN +3000';
      }
    } else {
      w.lockTimer = 0;
    }
    return null;
  }

  if (w.phase === 'lock') {
    // lock holds while the pilot stays in the window; drift out and it drops
    if (!err.inWindow) { w.phase = 'idle'; w.lockTimer = 0; return 'HOVER LOST — BACK OVER THE RING'; }
    w.phase = 'lowering'; w.phaseTimer = 0; w.winchStart = flightSeconds;
    w.steadySamples = 0; w.totalSamples = 0;
    radio('SUMMIT CONTROL', 'CABLE DOWN — STAY INSIDE 3 M');
    return 'WINCH LOWERING — HOLD STEADY';
  }

  if (w.phase === 'lowering') {
    w.phaseTimer += dt;
    w.totalSamples += 1;
    if (err.horiz <= WINCH.steadyRadius) w.steadySamples += 1;
    const target = Math.max(0, s.y - ground - 1.2);
    w.cableLen = Math.min(target, (w.phaseTimer / WINCH.lowerTime) * target);
    if (w.phaseTimer >= WINCH.lowerTime) {
      w.phase = 'clipping'; w.phaseTimer = 0;
      w.hoverSteadiness = w.totalSamples ? Math.round((w.steadySamples / w.totalSamples) * 100) : 0;
      radio('SUMMIT CONTROL', `HOOK DOWN — STEADY ${w.hoverSteadiness}%`);
      return 'HOOK DOWN — CLIPPING ON';
    }
    return null;
  }

  if (w.phase === 'clipping') {
    w.phaseTimer += dt;
    if (w.phaseTimer >= WINCH.clipTime) {
      w.phase = 'on-hook'; w.phaseTimer = 0;
      w.survivorOnHook = true; s.survivorOnHook = true;
      addScore(5000, 'survivor on the hook', mission.id);
      radio('SUMMIT CONTROL', 'ON THE HOOK +5000 — REEL IN');
      logEvent(`Survivor on the hook — +5000 (steadiness ${w.hoverSteadiness}%)`);
      return 'SURVIVOR ON HOOK — REEL IN';
    }
    return null;
  }

  if (w.phase === 'on-hook') {
    // the pilot reels in with SPACE (or the harness drives it); the cable
    // stays down and the survivor hangs until reeling starts.
    return null;
  }

  if (w.phase === 'reeling') {
    w.phaseTimer += dt;
    const target = Math.max(0, s.y - ground - 1.2);
    w.cableLen = Math.max(0, target * (1 - w.phaseTimer / WINCH.reelTime));
    if (w.phaseTimer >= WINCH.reelTime) {
      w.cableLen = 0;
      w.phase = 'aboard';
      mission.aboard = true;
      w.survivorOnHook = false; s.survivorOnHook = false;
      w.winchTime = flightSeconds - w.winchStart;
      addScore(2000, 'survivor aboard', mission.id);
      radio('SUMMIT CONTROL', `ABOARD +2000 — FLY HOME`);
      logEvent(`Survivor aboard — +2000, winch ${w.winchTime.toFixed(1)} s`);
      return 'SURVIVOR ABOARD +2000 — FLY HOME TO THE PAD';
    }
    return null;
  }
  return null;
}

// SPACE (or the harness): start reeling when the survivor is on the hook.
export function reelIn(w) {
  if (w.phase === 'on-hook') { w.phase = 'reeling'; w.phaseTimer = 0; return true; }
  return false;
}

// Reset for the next survivor at the same ring.
export function resetWinchForNext(w) {
  w.phase = 'idle'; w.cableLen = 0; w.lockTimer = 0; w.phaseTimer = 0;
  w.steadySamples = 0; w.totalSamples = 0;
  w.survivorOnHook = false;
}
