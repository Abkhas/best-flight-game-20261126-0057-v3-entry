// flight-model.js — helicopter physics: collective lift, tilt-to-fly, hover
// damping, wind gusts, fuel, airframe damage. Pure numbers in, pure numbers
// out — no three.js here, so the model is testable and the renderer just
// draws what it says. A helicopter hovers: tilt gives horizontal velocity,
// collective gives vertical velocity, and everything damps toward a hover
// when the stick centres — that is what makes the winch hover playable.

import { groundHeight, PAD, VALLEY_PAD } from './terrain.js';

export const LIMITS = {
  maxHorizSpeed: 26,   // m/s at full tilt
  maxClimb: 8,         // m/s at full collective
  maxSink: 9,          // m/s at idle collective
  fuelBurnBase: 0.10,  // % per second, hovering
  fuelBurnFull: 0.30,  // % per second at full collective
  softSink: 3.0,       // m/s — a soft pad landing
  hardSink: 6.0,       // m/s — hard, damages the airframe
};

export function freshState() {
  return {
    x: 0, y: 130, z: -560,
    heading: 0,        // radians, 0 = due north (-z), grows clockwise
    pitch: 0,          // radians, visual tilt (+ = nose up)
    bank: 0,           // radians, visual tilt (+ = right wing down)
    vx: 0, vy: 0, vz: 0,
    speed: 0,          // horizontal speed, m/s
    vs: 0,             // vertical speed m/s (for the landing verdict)
    collective: 0.5,   // 0..1 — rotor lift (W/S)
    rotorRpm: 97,      // % — the gauge the pilot watches
    fuel: 100,         // %
    damage: 0,         // % airframe lost
    cableWear: 0,      // % — the winch cable wears a little per rescue
    survivorOnHook: false,
    stalled: false,    // unused by a heli, kept for HUD parity (never true)
    onGround: false,
    landed: false,
    crashed: false,
    gust: 0,           // current crosswind gust, m/s (storm)
  };
}

// input: { pitch: -1..1 (stick back = +, forward = -), bank: -1..1,
//          yaw: -1..1, collective: -1..1 (W up / S down), dt, gust: m/s }
export function step(s, input, dt, gust = 0) {
  if (s.onGround || s.crashed) return s;

  // --- collective: rotor lift ---
  s.collective = clamp(s.collective + input.collective * dt * 0.45, 0, 1);
  s.rotorRpm = 88 + s.collective * 12;

  // --- fuel: hovering sips, full collective drinks ---
  const burn = LIMITS.fuelBurnBase + (LIMITS.fuelBurnFull - LIMITS.fuelBurnBase) * s.collective;
  s.fuel = Math.max(0, s.fuel - burn * dt);
  if (s.fuel <= 0) s.collective = Math.min(s.collective, 0.42); // flameout: sink, don't fall

  // --- vertical: collective sets a target climb rate, damped ---
  const targetVy = (s.collective - 0.5) * 2 * (s.collective > 0.5 ? LIMITS.maxClimb : LIMITS.maxSink);
  s.vy += (targetVy - s.vy) * Math.min(1, 2.2 * dt);
  s.vs = s.vy;
  s.y += s.vy * dt;

  // --- attitude follows the stick, smoothly ---
  s.pitch += (input.pitch * 0.16 - s.pitch) * Math.min(1, 5 * dt);
  s.bank += (input.bank * 0.32 - s.bank) * Math.min(1, 5 * dt);
  s.heading += input.yaw * 0.85 * dt;

  // --- horizontal: tilt commands velocity; damping holds the hover ---
  // ArrowUp = forward (nose down = negative pitch in world terms, so the
  // forward speed is -pitch * scale). Bank right = velocity to the right.
  const fwdX = Math.sin(s.heading), fwdZ = -Math.cos(s.heading);
  const rightX = Math.cos(s.heading), rightZ = Math.sin(s.heading);
  const targetVx = fwdX * (-s.pitch / 0.16) * LIMITS.maxHorizSpeed * 0.55
    + rightX * (s.bank / 0.32) * LIMITS.maxHorizSpeed * 0.5 + gust * rightX;
  const targetVz = fwdZ * (-s.pitch / 0.16) * LIMITS.maxHorizSpeed * 0.55
    + rightZ * (s.bank / 0.32) * LIMITS.maxHorizSpeed * 0.5 + gust * rightZ;
  s.vx += (targetVx - s.vx) * Math.min(1, 1.6 * dt);
  s.vz += (targetVz - s.vz) * Math.min(1, 1.6 * dt);
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  s.speed = Math.hypot(s.vx, s.vz);
  s.gust = gust;

  // --- stay inside the operating area (a 3 km box around the valley) ---
  s.x = clamp(s.x, -1500, 1500);
  s.z = clamp(s.z, -1400, 900);
  if (s.y > 420) { s.y = 420; s.vy = Math.min(s.vy, 0); }

  // --- ground contact ---
  const gy = groundHeight(s.x, s.z);
  if (s.y <= gy + 1.6) {
    s.y = gy + 1.6;
    s.onGround = true;
  }
  return s;
}

export function overPad(x, z, pad) {
  return Math.hypot(x - pad.x, z - pad.z) < pad.r * 0.85;
}

// Touchdown verdict on a pad. Returns 'soft' | 'hard' | 'crash'.
export function touchdown(s, pad) {
  const sink = -s.vs;
  s.onGround = true;
  if (!pad) return 'crash'; // rough terrain, not a pad
  if (sink <= LIMITS.softSink && s.speed <= 4) return 'soft';
  if (sink <= LIMITS.hardSink && s.speed <= 8) return 'hard';
  return 'crash';
}

export function applyLanding(s, verdict) {
  if (verdict === 'soft') { s.landed = true; return 0; }
  if (verdict === 'hard') { s.damage = Math.min(100, s.damage + 22); s.landed = true; return 22; }
  s.damage = 100; s.crashed = true; return 100;
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
