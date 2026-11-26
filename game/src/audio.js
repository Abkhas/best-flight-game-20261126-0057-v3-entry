// audio.js — synthesized WebAudio only: engine hum, wind, chimes. No audio
// files, no network. Everything is guarded: in headless capture or before the
// first user gesture the context simply stays silent.

let actx = null;
let humOsc = null, humGain = null, windSrc = null, windGain = null, windFilter = null;
let started = false;

export function ensureAudio() {
  if (started) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    started = true;
    // engine hum: two detuned saws through a lowpass
    humOsc = actx.createOscillator(); humOsc.type = 'sawtooth'; humOsc.frequency.value = 52;
    const humOsc2 = actx.createOscillator(); humOsc2.type = 'sawtooth'; humOsc2.frequency.value = 55;
    humGain = actx.createGain(); humGain.gain.value = 0.0;
    windFilter = actx.createBiquadFilter(); windFilter.type = 'lowpass'; windFilter.frequency.value = 420;
    humOsc.connect(windFilter); humOsc2.connect(windFilter);
    windFilter.connect(humGain); humGain.connect(actx.destination);
    humOsc.start(); humOsc2.start();
    // wind: looped noise buffer through a bandpass
    const len = actx.sampleRate * 2;
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    windSrc = actx.createBufferSource(); windSrc.buffer = buf; windSrc.loop = true;
    const band = actx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 700; band.Q.value = 0.6;
    windGain = actx.createGain(); windGain.gain.value = 0.0;
    windSrc.connect(band); band.connect(windGain); windGain.connect(actx.destination);
    windSrc.start();
  } catch { /* silent in headless / unsupported */ }
}

// throttle 0..1, speed m/s — call every frame while flying.
export function updateAudio(throttle, speed) {
  if (!started || !actx) return;
  try {
    const t = actx.currentTime;
    humGain.gain.setTargetAtTime(0.015 + throttle * 0.05, t, 0.1);
    windFilter.frequency.setTargetAtTime(300 + throttle * 900, t, 0.15);
    windGain.gain.setTargetAtTime(Math.min(0.09, speed * 0.00045), t, 0.15);
  } catch { /* ignore */ }
}

export function audioOn() { return started; }

export function chime(freq = 880) {
  if (!started || !actx) return;
  try {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.12, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.7);
    o.connect(g); g.connect(actx.destination);
    o.start(); o.stop(actx.currentTime + 0.75);
  } catch { /* ignore */ }
}

// Stall warning: two descending square-wave blasts — unmistakable, and
// called once per stall entry by main.js, never spammed every frame.
export function stallWarn() {
  if (!started || !actx) return;
  try {
    for (let i = 0; i < 2; i++) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'square'; o.frequency.setValueAtTime(660, actx.currentTime + i * 0.35);
      o.frequency.exponentialRampToValueAtTime(440, actx.currentTime + i * 0.35 + 0.22);
      g.gain.setValueAtTime(0.09, actx.currentTime + i * 0.35);
      g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + i * 0.35 + 0.3);
      o.connect(g); g.connect(actx.destination);
      o.start(actx.currentTime + i * 0.35); o.stop(actx.currentTime + i * 0.35 + 0.32);
    }
  } catch { /* ignore */ }
}

export function thud() {
  if (!started || !actx) return;
  try {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(120, actx.currentTime);
    o.frequency.exponentialRampToValueAtTime(38, actx.currentTime + 0.25);
    g.gain.setValueAtTime(0.25, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.3);
    o.connect(g); g.connect(actx.destination);
    o.start(); o.stop(actx.currentTime + 0.32);
  } catch { /* ignore */ }
}
