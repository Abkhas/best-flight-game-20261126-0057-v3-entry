// radio.js — the base radio log. The base voice is NAMED: SUMMIT CONTROL,
// the Summit Base controller on the dawn watch — every line in the log is
// spoken by her, not by a generic "TOWER". The feed only ever reports things
// that actually happened in the game (clearances, hover locks, hooks, traps,
// storm warnings). Rendered into #radio-log; the last 4 lines show, the full
// feed lives in the pilot log.

const lines = [];
const MAX = 24;

export function radio(speaker, text) {
  lines.push({ speaker, text });
  if (lines.length > MAX) lines.shift();
  render();
}

export function radioLines() { return lines.slice(); }

function render() {
  const el = document.getElementById('radio-log');
  if (!el) return;
  const last = lines.slice(-4);
  el.innerHTML = '<div class="rhead">RADIO · SUMMIT CONTROL — SUMMIT BASE</div>' + last.map((l) =>
    `<div class="rline"><b class="${l.speaker === 'SUMMIT CONTROL' ? 'twr' : l.speaker === 'LIFT-07' ? 'plt' : 'sys'}">${l.speaker}</b> ${l.text}</div>`,
  ).join('');
}

export function clearRadio() { lines.length = 0; render(); }
