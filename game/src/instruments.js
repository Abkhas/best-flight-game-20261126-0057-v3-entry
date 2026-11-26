// instruments.js — the lit instrument panel. Seven canvas gauges drawn every
// frame from the flight state, so they always agree with the HUD: rotor RPM,
// airspeed, altimeter, vertical speed, heading tape, fuel, winch cable.
// Glowing on dark glass — instruments that look flown, not drawn.

function ctx2d(canvas) { return canvas.getContext('2d'); }

function dial(c, label, color) {
  const g = ctx2d(c); const W = c.width, H = c.height, cx = W / 2, cy = H / 2;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#04070e'; g.beginPath(); g.arc(cx, cy, 62, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#2a3c58'; g.lineWidth = 2; g.stroke();
  g.fillStyle = color; g.font = 'bold 10px Consolas, monospace'; g.textAlign = 'center';
  g.fillText(label, cx, 20);
  return g;
}

function needle(g, cx, cy, angle, len, color, width = 3) {
  g.save(); g.translate(cx, cy); g.rotate(angle);
  g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round';
  g.beginPath(); g.moveTo(0, 8); g.lineTo(0, -len); g.stroke(); g.restore();
}

function digital(g, cx, y, text, color = '#eaf6ff', size = 20) {
  g.fillStyle = '#000'; g.fillRect(cx - 42, y - size + 4, 84, size + 8);
  g.strokeStyle = '#2a3c58'; g.lineWidth = 1; g.strokeRect(cx - 42, y - size + 4, 84, size + 8);
  g.fillStyle = color; g.font = `bold ${size}px Consolas, monospace`; g.textAlign = 'center';
  g.fillText(text, cx, y + 5);
}

export function drawAttitude(canvas, pitch, bank) {
  const g = dial(canvas, 'ATTITUDE', '#7fd8ff');
  const cx = 66, cy = 68, R = 52;
  g.save();
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
  g.translate(cx, cy); g.rotate(bank);
  const yOff = pitch * 110;
  g.fillStyle = '#1d4a7a'; g.fillRect(-R - 4, -R - 4 + yOff, R * 2 + 8, R + 4 - yOff);
  g.fillStyle = '#7a4a26'; g.fillRect(-R - 4, yOff, R * 2 + 8, R + 4);
  g.strokeStyle = '#eaf6ff'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(-R, yOff); g.lineTo(R, yOff); g.stroke();
  g.restore();
  g.strokeStyle = '#ffd27f'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(cx - 26, cy); g.lineTo(cx - 8, cy); g.moveTo(cx + 8, cy); g.lineTo(cx + 26, cy); g.stroke();
  g.fillStyle = '#ffd27f'; g.beginPath(); g.arc(cx, cy, 3.5, 0, Math.PI * 2); g.fill();
  needle(g, cx, cy, bank, 58, '#ffd27f', 2);
}

// --- Rotor RPM: the heli's master gauge — needle + digital %, green band ---
export function drawRotor(canvas, rpm) {
  const g = dial(canvas, 'ROTOR RPM · %', '#7fd8ff');
  const cx = 66, cy = 68;
  // green operating band 92–102%
  g.strokeStyle = '#37d67a'; g.lineWidth = 6;
  g.beginPath(); g.arc(cx, cy, 50, -Math.PI * 0.75 + 0.61 * Math.PI * 1.5, -Math.PI * 0.75 + 0.68 * Math.PI * 1.5); g.stroke();
  g.strokeStyle = '#3a5a7a'; g.lineWidth = 1;
  for (let v = 0; v <= 120; v += 20) {
    const a = -Math.PI * 0.75 + (v / 120) * Math.PI * 1.5;
    g.beginPath();
    g.moveTo(cx + Math.sin(a) * 46, cy - Math.cos(a) * 46);
    g.lineTo(cx + Math.sin(a) * 54, cy - Math.cos(a) * 54);
    g.stroke();
    g.fillStyle = '#9fc4e8'; g.font = '10px Consolas, monospace'; g.textAlign = 'center';
    g.fillText(String(v), cx + Math.sin(a) * 36, cy - Math.cos(a) * 36 + 3);
  }
  const a = -Math.PI * 0.75 + (Math.min(rpm, 120) / 120) * Math.PI * 1.5;
  needle(g, cx, cy, a, 50, '#ff5d5d', 3);
  g.fillStyle = '#eaf6ff'; g.beginPath(); g.arc(cx, cy, 4, 0, Math.PI * 2); g.fill();
  digital(g, cx, 108, String(Math.round(rpm)) + '%');
}

export function drawAirspeed(canvas, kt) {
  const g = dial(canvas, 'AIRSPEED · KT', '#7fd8ff');
  const cx = 66, cy = 68;
  g.strokeStyle = '#3a5a7a'; g.lineWidth = 1;
  for (let v = 0; v <= 120; v += 20) {
    const a = -Math.PI * 0.75 + (v / 120) * Math.PI * 1.5;
    g.beginPath();
    g.moveTo(cx + Math.sin(a) * 46, cy - Math.cos(a) * 46);
    g.lineTo(cx + Math.sin(a) * 54, cy - Math.cos(a) * 54);
    g.stroke();
    g.fillStyle = '#9fc4e8'; g.font = '10px Consolas, monospace'; g.textAlign = 'center';
    g.fillText(String(v), cx + Math.sin(a) * 36, cy - Math.cos(a) * 36 + 3);
  }
  const a = -Math.PI * 0.75 + (Math.min(kt, 120) / 120) * Math.PI * 1.5;
  needle(g, cx, cy, a, 50, '#ff5d5d', 3);
  g.fillStyle = '#eaf6ff'; g.beginPath(); g.arc(cx, cy, 4, 0, Math.PI * 2); g.fill();
  digital(g, cx, 108, String(Math.round(kt)));
}

export function drawAltimeter(canvas, ft) {
  const g = dial(canvas, 'ALTITUDE · FT', '#7fd8ff');
  const cx = 66, cy = 68;
  g.strokeStyle = '#3a5a7a'; g.lineWidth = 1;
  for (let v = 0; v < 1000; v += 100) {
    const a = -Math.PI * 0.75 + (v / 1000) * Math.PI * 1.5;
    g.beginPath();
    g.moveTo(cx + Math.sin(a) * 46, cy - Math.cos(a) * 46);
    g.lineTo(cx + Math.sin(a) * 54, cy - Math.cos(a) * 54);
    g.stroke();
    g.fillStyle = '#9fc4e8'; g.font = '10px Consolas, monospace'; g.textAlign = 'center';
    g.fillText(String(v / 100), cx + Math.sin(a) * 36, cy - Math.cos(a) * 36 + 3);
  }
  const a = -Math.PI * 0.75 + ((ft % 1000) / 1000) * Math.PI * 1.5;
  needle(g, cx, cy, a, 50, '#7fd8ff', 3);
  const a2 = -Math.PI * 0.75 + ((ft % 10000) / 10000) * Math.PI * 1.5;
  needle(g, cx, cy, a2, 34, '#ffd27f', 2);
  g.fillStyle = '#eaf6ff'; g.beginPath(); g.arc(cx, cy, 4, 0, Math.PI * 2); g.fill();
  digital(g, cx, 108, String(Math.round(ft)));
}

// --- Vertical speed: climb/sink needle, centre zero, red below -3 m/s ---
export function drawVS(canvas, vsMs) {
  const g = dial(canvas, 'VERT SPEED · M/S', '#7fd8ff');
  const cx = 66, cy = 68;
  g.strokeStyle = '#3a5a7a'; g.lineWidth = 1;
  for (let v = -8; v <= 8; v += 2) {
    const a = -Math.PI * 0.75 + ((v + 8) / 16) * Math.PI * 1.5;
    g.beginPath();
    g.moveTo(cx + Math.sin(a) * 46, cy - Math.cos(a) * 46);
    g.lineTo(cx + Math.sin(a) * 54, cy - Math.cos(a) * 54);
    g.stroke();
    g.fillStyle = '#9fc4e8'; g.font = '10px Consolas, monospace'; g.textAlign = 'center';
    g.fillText(String(v), cx + Math.sin(a) * 36, cy - Math.cos(a) * 36 + 3);
  }
  const clamped = Math.max(-8, Math.min(8, vsMs));
  const a = -Math.PI * 0.75 + ((clamped + 8) / 16) * Math.PI * 1.5;
  needle(g, cx, cy, a, 50, vsMs < -3 ? '#ff5d5d' : '#7fd8ff', 3);
  g.fillStyle = '#eaf6ff'; g.beginPath(); g.arc(cx, cy, 4, 0, Math.PI * 2); g.fill();
  digital(g, cx, 108, (vsMs >= 0 ? '+' : '') + vsMs.toFixed(1), vsMs < -3 ? '#ff5d5d' : '#eaf6ff');
}

export function drawHeading(canvas, hdgDeg) {
  const g = ctx2d(canvas); const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#04070e'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#2a3c58'; g.lineWidth = 2; g.strokeRect(1, 1, W - 2, H - 2);
  g.fillStyle = '#7fd8ff'; g.font = 'bold 10px Consolas, monospace'; g.textAlign = 'center';
  g.fillText('HEADING', W / 2, 16);
  const pxPerDeg = 1.1;
  const norm = ((hdgDeg % 360) + 360) % 360;
  for (let d = -90; d <= 90; d += 5) {
    const deg = Math.round((norm + d) / 5) * 5;
    const dd = ((deg - norm + 540) % 360) - 180;
    const x = W / 2 + dd * pxPerDeg;
    if (x < 4 || x > W - 4) continue;
    const major = deg % 30 === 0;
    g.strokeStyle = major ? '#eaf6ff' : '#3a5a7a'; g.lineWidth = major ? 2 : 1;
    g.beginPath(); g.moveTo(x, 34); g.lineTo(x, major ? 58 : 48); g.stroke();
    if (major) {
      const label = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[deg % 360] || String(deg % 360).padStart(3, '0');
      g.fillStyle = '#eaf6ff'; g.font = 'bold 12px Consolas, monospace';
      g.fillText(label, x, 76);
    }
  }
  g.fillStyle = '#ffd27f';
  g.beginPath(); g.moveTo(W / 2 - 8, 26); g.lineTo(W / 2 + 8, 26); g.lineTo(W / 2, 38); g.fill();
  digital(g, W / 2, 112, String(Math.round(norm)).padStart(3, '0') + '°', '#ffd27f', 18);
}

// --- Fuel + winch: collective quadrant, fuel arc, cable length bar ---
export function drawFuelWinch(canvas, collective, fuel, cableLen, cableMax, phase) {
  const g = ctx2d(canvas); const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#04070e'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#2a3c58'; g.lineWidth = 2; g.strokeRect(1, 1, W - 2, H - 2);
  g.fillStyle = '#7fd8ff'; g.font = 'bold 10px Consolas, monospace'; g.textAlign = 'center';
  g.fillText('COLLECTIVE', 36, 16); g.fillText('FUEL', 92, 16);
  g.strokeStyle = '#3a5a7a'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(36, 100); g.lineTo(36, 30); g.stroke();
  const ty = 100 - collective * 70;
  g.fillStyle = '#ffd27f'; g.fillRect(26, ty - 5, 20, 10);
  g.fillStyle = '#eaf6ff'; g.font = 'bold 13px Consolas, monospace';
  g.fillText(Math.round(collective * 100) + '%', 36, 122);
  const fx = 92, fy = 66;
  g.strokeStyle = '#22314a'; g.lineWidth = 9;
  g.beginPath(); g.arc(fx, fy, 30, -Math.PI * 0.75, Math.PI * 0.75); g.stroke();
  const col = fuel > 30 ? '#37d67a' : fuel > 12 ? '#ffb03a' : '#ff5d5d';
  g.strokeStyle = col; g.lineWidth = 9;
  g.beginPath(); g.arc(fx, fy, 30, -Math.PI * 0.75, -Math.PI * 0.75 + (fuel / 100) * Math.PI * 1.5); g.stroke();
  g.fillStyle = col; g.font = 'bold 14px Consolas, monospace';
  g.fillText(Math.round(fuel) + '%', fx, fy + 5);
  // winch cable: vertical bar + phase label
  g.fillStyle = '#7fd8ff'; g.font = 'bold 10px Consolas, monospace';
  g.fillText('WINCH', 158, 16);
  g.strokeStyle = '#22314a'; g.lineWidth = 8;
  g.beginPath(); g.moveTo(158, 100); g.lineTo(158, 30); g.stroke();
  const frac = cableMax > 0 ? Math.min(1, cableLen / cableMax) : 0;
  g.strokeStyle = phase === 'on-hook' ? '#ffd27f' : '#9fd8ff'; g.lineWidth = 8;
  g.beginPath(); g.moveTo(158, 100); g.lineTo(158, 100 - frac * 70); g.stroke();
  g.fillStyle = '#eaf6ff'; g.font = 'bold 11px Consolas, monospace';
  g.fillText(Math.round(cableLen) + ' M', 158, 122);
}

export function drawAll(state, winch) {
  drawAttitude(document.getElementById('g-att'), state.pitch, state.bank);
  drawRotor(document.getElementById('g-rpm'), state.rotorRpm);
  drawAirspeed(document.getElementById('g-spd'), state.speed * 1.944);
  drawAltimeter(document.getElementById('g-alt'), state.y * 3.281);
  drawVS(document.getElementById('g-vs'), state.vs);
  drawHeading(document.getElementById('g-hdg'), ((state.heading * 180) / Math.PI % 360 + 360) % 360);
  drawFuelWinch(document.getElementById('g-fuel'), state.collective, state.fuel,
    winch ? winch.cableLen : 0, 30, winch ? winch.phase : 'idle');
}
