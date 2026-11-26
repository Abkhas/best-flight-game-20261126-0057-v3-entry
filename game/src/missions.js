// missions.js — the campaign: 4 rescues with DIFFERENT goals, sites, storm
// clocks and weather. Each mission has its own pickup ring, delivery pad,
// survivor count, storm timer and gust strength. Counts here are the honest
// totals in saves.js (7 survivors across 4 missions) — change them here and
// saves.js follows by hand.

import { RING_A, RING_B, RING_C, RING_D, PAD, VALLEY_PAD, groundHeight } from './terrain.js';
import { record, logEvent, addScore } from './saves.js';
import { radio } from './radio.js';
import { touchdown, applyLanding, overPad } from './flight-model.js';
import { resetWinchForNext } from './winch.js';

export const MISSIONS = [
  {
    id: 1, name: 'RIDGE RESCUE', kicker: 'MISSION 1 OF 4 · STORM CLOSING IN',
    brief: 'Winch 3 climbers off Storm Ridge before the storm closes in.',
    goal: '3 CLIMBERS · HOVER + WINCH + DELIVER',
    ring: RING_A, pad: PAD, survivors: 3, stormMinutes: 12, gust: 2.5, weather: 'storm',
    spawn: { x: 0, y: PAD.y + 55, z: -560, heading: Math.PI, collective: 0.55 },
  },
  {
    id: 2, name: 'NIGHT MEDEVAC', kicker: 'MISSION 2 OF 4 · AFTER DARK',
    brief: 'A patient waits on a ledge in the dark — lift them to the lit pad.',
    goal: '1 PATIENT · LEDGE PICKUP · NIGHT LANDING',
    ring: RING_B, pad: PAD, survivors: 1, stormMinutes: 8, gust: 2.5, weather: 'night',
    spawn: { x: -260, y: RING_B.y + 60, z: -360, heading: -0.79, collective: 0.55 },
  },
  {
    id: 3, name: 'BLIZZARD RUN', kicker: 'MISSION 3 OF 4 · WHITEOUT',
    brief: 'Supply drop and one rescue in a whiteout — fly by the beacon alone.',
    goal: '1 SURVIVOR · WHITEOUT · BEACON-ONLY NAV',
    ring: RING_C, pad: PAD, survivors: 1, stormMinutes: 10, gust: 6.0, weather: 'whiteout',
    spawn: { x: 240, y: RING_C.y + 60, z: -100, heading: 0.79, collective: 0.55 },
  },
  {
    id: 4, name: 'VALLEY FERRY', kicker: 'MISSION 4 OF 4 · STRETCHER TRANSFER',
    brief: 'Ferry 2 stretcher patients between the pads — gentle wins.',
    goal: '2 PATIENTS · PAD TO PAD · GENTLE LANDINGS',
    ring: RING_D, pad: VALLEY_PAD, survivors: 2, stormMinutes: 14, gust: 2.0, weather: 'dawn',
    spawn: { x: 0, y: PAD.y + 45, z: -560, heading: 0, collective: 0.55 },
  },
];

export const CAMPAIGN_SURVIVORS = MISSIONS.reduce((n, m) => n + m.survivors, 0); // 7
export const CAMPAIGN_STARS = CAMPAIGN_SURVIVORS * 3; // 21 — 3 stars per rescue

export function missionState(id) {
  const def = MISSIONS[id - 1];
  return {
    id, def, delivered: 0, aboard: false, done: false, result: null,
    stormLeft: def.stormMinutes * 60, // seconds — the global countdown
    stormFailed: false,
    lastRescue: null, // debrief measures for the most recent delivery
  };
}

// Next target the pilot should fly toward (for the objective line + marker).
export function nextTargetPos(m, world) {
  if (m.done) return { kind: 'pad', x: m.def.pad.x, y: m.def.pad.y, z: m.def.pad.z };
  // survivor aboard → fly home to the delivery pad; otherwise → the ring
  if (m.aboard) return { kind: 'pad', x: m.def.pad.x, y: m.def.pad.y, z: m.def.pad.z };
  const r = m.def.ring;
  return { kind: 'ring', x: r.x, y: r.y, z: r.z };
}

function distTo(s, x, y, z) { return Math.hypot(s.x - x, s.y - y, s.z - z); }

function relArrow(s, x, z) {
  const want = Math.atan2(x - s.x, -(z - s.z));
  const rel = (((want - s.heading) * 180 / Math.PI) % 360 + 540) % 360 - 180;
  const a = Math.abs(rel);
  if (a <= 22) return '↑ AHEAD';
  if (a <= 67) return rel > 0 ? '↗ RIGHT' : '↖ LEFT';
  if (a <= 112) return rel > 0 ? '→ RIGHT' : '← LEFT';
  if (a <= 157) return rel > 0 ? '↘ BEHIND-R' : '↙ BEHIND-L';
  return '↓ BEHIND';
}

export function nextTarget(m, world, s) {
  const t = nextTargetPos(m, world);
  const d = Math.round(distTo(s, t.x, t.y, t.z));
  if (m.aboard) return `Survivor aboard — ${m.def.pad === PAD ? 'hospital pad' : 'valley pad'} ${d} m ${relArrow(s, t.x, t.z)} — land gentle`;
  const left = m.def.survivors - m.delivered;
  return `Ring ${left} survivor${left === 1 ? '' : 's'} left — ${d} m ${relArrow(s, t.x, t.z)} — hover over the gold ring`;
}

// Per-frame mission logic. Returns an event string when something happens.
export function updateMission(m, s, winch, world, hooks, dt) {
  // --- the storm clock: the global countdown that forces decisions ---
  if (!m.done && !m.stormFailed) {
    m.stormLeft -= dt;
    if (m.stormLeft <= 0) {
      m.stormLeft = 0; m.stormFailed = true;
      radio('SUMMIT CONTROL', 'STORM CLOSED IN — MISSION FAILED, RTB');
      logEvent(`Storm closed in on mission ${m.id} — failed`);
      hooks.onStormFail?.(m);
      return 'STORM CLOSED IN — MISSION FAILED';
    }
  }

  // --- delivery: land on the delivery pad with a survivor aboard ---
  if (m.aboard && s.onGround) {
    const pad = overPad(s.x, s.z, m.def.pad) ? m.def.pad : null;
    const verdict = touchdown(s, pad);
    const dmg = applyLanding(s, verdict);
    if (verdict === 'soft' || verdict === 'hard') {
      const sink = -s.vs;
      const pts = verdict === 'soft' ? 400 : 200;
      addScore(pts, `soft landing on the pad (${sink.toFixed(1)} m/s)`, m.id);
      m.delivered += 1;
      record.rescuesDelivered += 1;
      // the debrief for THIS rescue, from real measured values
      const stead = winch.hoverSteadiness ?? 0;
      const wtime = winch.winchTime ?? 0;
      const stars = (stead >= 80 ? 1 : 0) + (wtime > 0 && wtime <= 12 ? 1 : 0) + (verdict === 'soft' ? 1 : 0);
      record.stars += stars;
      m.lastRescue = {
        steadiness: stead, winchTime: wtime, sink, fuelLeft: Math.round(s.fuel),
        verdict, points: pts, stars, delivered: m.delivered, of: m.def.survivors,
      };
      if (record.bestLandingVs === null || sink < record.bestLandingVs) record.bestLandingVs = sink;
      record.cableWear = Math.min(100, record.cableWear + 8);
      s.cableWear = record.cableWear;
      radio('SUMMIT CONTROL', `${verdict === 'soft' ? 'SOFT' : 'HARD'} LANDING +${pts} — SURVIVOR ${m.delivered} OF ${m.def.survivors} DELIVERED`);
      logEvent(`Survivor ${m.delivered}/${m.def.survivors} delivered — ${verdict} landing ${sink.toFixed(1)} m/s, ${stars}★`);
      m.aboard = false;
      s.onGround = false; s.landed = false;
      s.y = m.def.pad.y + 2; s.vy = 0; s.vx = 0; s.vz = 0; s.collective = 0.5;
      resetWinchForNext(winch);
      if (m.delivered >= m.def.survivors) {
        m.done = true; m.result = 'complete';
        record.missionsComplete += 1;
        record.refitPoints += 1;
        radio('SUMMIT CONTROL', `${m.def.name} COMPLETE — ALL ${m.def.survivors} DELIVERED · REFIT EARNED`);
        logEvent(`Mission ${m.id} complete — all ${m.def.survivors} delivered`);
        hooks.onComplete?.(m.def);
        return `${m.def.name} COMPLETE — ALL ${m.def.survivors} DELIVERED +${pts}`;
      }
      return `SURVIVOR DELIVERED ${m.delivered}/${m.def.survivors} +${pts} — NEXT ONE WAITS AT THE RING`;
    }
    record.crashes += 1;
    logEvent('Crash on the pad — sortie over');
    hooks.onCrash?.('pad impact');
    return 'CRASH — PAD IMPACT';
  }

  // --- rough-terrain contact with nobody aboard: crash, unless it's a pad ---
  if (s.onGround && !m.aboard) {
    const pad = overPad(s.x, s.z, m.def.pad) ? m.def.pad
      : overPad(s.x, s.z, VALLEY_PAD) ? VALLEY_PAD : null;
    const verdict = touchdown(s, pad);
    applyLanding(s, verdict);
    if (verdict === 'soft' || verdict === 'hard') {
      // a practice touchdown on a pad without a survivor aboard: fine, lift off
      s.onGround = false; s.landed = false;
      s.y = (pad ? pad.y : groundHeight(s.x, s.z)) + 2; s.vy = 0;
      return verdict === 'soft' ? 'TOUCHDOWN — LIFT OFF WHEN READY' : 'HARD TOUCHDOWN — AIRFRAME CHECK';
    }
    record.crashes += 1;
    logEvent('Crash into the ridge — sortie over');
    hooks.onCrash?.('terrain impact');
    return 'CRASH — TERRAIN IMPACT';
  }
  return null;
}
