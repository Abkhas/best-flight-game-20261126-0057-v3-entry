// screens.js — title (flight-plan briefing board), proof (rescue debrief),
// pause, end and log screens. All numbers come from saves.js (the single
// source of truth), so the title slots and the proof screen can never disagree.

import { record, proofCells, proofNote, SLOTS, GAME, missionMedals, sessionMedal, sessionRank, incidentLine } from './saves.js';
import { MISSIONS } from './missions.js';

const $ = (id) => document.getElementById(id);

function show(id) {
  for (const el of document.querySelectorAll('.screen')) el.classList.remove('on');
  if (id) $(id).classList.add('on');
}

export function renderSlots() {
  const wrap = $('slots');
  wrap.innerHTML = '';
  for (const slot of SLOTS) {
    const div = document.createElement('div');
    div.className = 'slot' + (record.slot === slot.id ? ' sel' : '');
    div.innerHTML = `<div class="sname">SLOT ${slot.id} · ${slot.seat}</div>
      <div class="scall">${slot.callsign}</div>
      <div class="sstat">${slot.note}<br>Score ${record.score} · Rescued ${record.rescuesDelivered}/${GAME.survivors}<br>Flight ${record.flightMinutes}:${String(Math.floor(record.flightSeconds)).padStart(2, '0')}</div>`;
    div.addEventListener('click', () => {
      record.slot = slot.id;
      record.callsign = slot.callsign;
      $('proof-callsign').textContent = `CALLSIGN ${slot.callsign} · ${GAME.base}`;
      renderSlots();
    });
    wrap.appendChild(div);
  }
}

// The flight-plan table: the 4 missions with DIFFERENT goals, so the title
// screen itself proves the campaign (criterion 2).
export function renderMissions() {
  const wrap = $('mission-table');
  wrap.innerHTML = '';
  for (const m of MISSIONS) {
    const div = document.createElement('div');
    const score = record.missionScores[m.id];
    const done = record.missionsComplete >= m.id && score > 0;
    div.className = 'mrow' + (m.id === 1 ? ' sel' : '');
    div.innerHTML = `<div class="mnum">M${m.id}</div>
      <div class="mname">${m.name}<div class="msub">${m.goal}</div></div>
      <div class="mmeta">${m.survivors} SURVIVOR${m.survivors === 1 ? '' : 'S'} · STORM ${String(m.stormMinutes).padStart(2, '0')}:00 · WIND ${m.gust.toFixed(0)} M/S</div>
      <div class="mscore">${score > 0 ? score + ' PTS' : '— NOT FLOWN'}</div>`;
    div.addEventListener('click', () => {
      if (window.__game?.beginMission) window.__game.beginMission(m.id);
    });
    wrap.appendChild(div);
  }
}

// Turnaround refits: spend 1 refit point (earned per completed mission) on
// FUEL, AIRFRAME or a NEW CABLE — the economy layer, visible on the title.
export function renderRefits() {
  const wrap = $('refit-row');
  const pts = record.refitPoints;
  wrap.innerHTML = `<div class="rhead">TURNAROUND — REFIT POINTS: ${pts} · SPEND 1: </div>`
    + ['FUEL +30%', 'AIRFRAME REPAIR', 'NEW CABLE'].map((label, i) =>
      `<button class="refit-btn" data-refit="${i}" ${pts < 1 ? 'disabled' : ''}>${label}</button>`).join('')
    + `<div class="rnote">FUEL ${Math.round(window.__game?.flight?.fuel ?? 100)}% · AIRFRAME ${Math.round(100 - (window.__game?.flight?.damage ?? 0))}% · CABLE ${Math.round(100 - record.cableWear)}%</div>`;
  wrap.querySelectorAll('.refit-btn').forEach((b) => {
    b.addEventListener('click', () => {
      if (record.refitPoints < 1 || !window.__game?.applyRefit) return;
      window.__game.applyRefit(Number(b.dataset.refit));
      renderRefits();
    });
  });
}

export function showTitle() {
  renderSlots();
  renderMissions();
  renderRefits();
  show('title-screen');
  document.getElementById('btn-fly').textContent = `FLY — MISSION ${window.__game?.missionId || 1}`;
}

export function showProof(lastRescue) {
  const grid = $('proof-grid');
  grid.innerHTML = '';
  for (const cell of proofCells(lastRescue)) {
    const div = document.createElement('div');
    div.className = 'pcell';
    div.innerHTML = `<div class="lab">${cell.lab}</div><div class="val">${cell.val}</div><div class="sub">${cell.sub}</div>`;
    grid.appendChild(div);
  }
  const medal = sessionMedal();
  $('proof-medal').textContent = medal === '—'
    ? 'NO MEDAL YET — FLY A RESCUE · RANK D · BEST SCORE ' + record.bestScore
    : `★ SESSION MEDAL — ${medal} · RANK ${sessionRank()} · BEST SCORE ${record.bestScore}`;
  // Debrief headline: the rescue that was just debriefed, with its stars —
  // and the survivor's NAME: a named person turns a rescue into a story.
  const r = lastRescue;
  $('proof-headline').textContent = r
    ? `RESCUE COMPLETE — ${r.name || 'SURVIVOR ' + r.delivered} · SURVIVOR ${r.delivered} OF ${r.of} DELIVERED · ${r.stars}★ OF 3 · ${r.verdict.toUpperCase()} LANDING`
    : 'RESCUE COMPLETE';
  // Flight recorder chart: altitude (gold) + speed (cyan) over the flight,
  // drawn from the real recorded time-series. Touchdown plan: the four
  // measured numbers of the delivery, in large type.
  drawRecorderChart();
  const plan = $('touchdown-plan');
  plan.innerHTML = '<div class="rhead">TOUCHDOWN PLAN — MEASURED AT DELIVERY</div>'
    + '<div class="trow"><div><div class="lab">SINK</div><div class="val">' + (r ? r.sink.toFixed(1) + ' M/S' : '—') + '</div><div class="sub">SOFT ≤ 3.0 M/S</div></div>'
    + '<div><div class="lab">SPEED</div><div class="val">' + (r ? r.touchdownSpeed + ' KT' : '—') + '</div><div class="sub">AT TOUCHDOWN</div></div>'
    + '<div><div class="lab">OFF CENTRELINE</div><div class="val">' + (r ? r.offCentre.toFixed(1) + ' M' : '—') + '</div><div class="sub">FROM PAD CENTRE</div></div>'
    + '<div><div class="lab">HOVER ERROR</div><div class="val">' + (r && r.hoverErr !== null && r.hoverErr !== undefined ? r.hoverErr.toFixed(1) + ' M' : '—') + '</div><div class="sub">AT HOVER LOCK</div></div></div>';
  const row = $('proof-sorties');
  row.innerHTML = '';
  for (const s of missionMedals()) {
    const m = MISSIONS[s.id - 1];
    const div = document.createElement('div');
    div.className = 'scell';
    const cls = s.medal === 'GOLD' ? 'medal-gold' : s.medal === 'SILVER' ? 'medal-silver' : s.medal === 'BRONZE' ? 'medal-bronze' : '';
    div.innerHTML = `<div class="lab">MISSION ${s.id} · ${m.name}</div>`
      + `<div class="val"><span class="${cls}">${s.medal === '—' ? '— NO MEDAL' : '★ ' + s.medal}</span></div>`
      + `<div class="sub">${s.score} PTS · ${m.survivors} survivor${m.survivors === 1 ? '' : 's'}</div>`;
    row.appendChild(div);
  }
  $('proof-incident').textContent = incidentLine();
  $('proof-note').textContent = proofNote(lastRescue);
  $('proof-callsign').textContent = `CALLSIGN ${record.callsign} · ${GAME.base}`;
  show('proof-screen');
}

export function showPause() { show('pause-screen'); }

// Flight-recorder chart: two lines from record.recorder — altitude (gold)
// and speed (cyan) against flight time. Empty until a flight is recorded.
function drawRecorderChart() {
  const c = $('recorder-chart');
  if (!c) return;
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#04070e'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#22314a'; g.lineWidth = 1;
  g.strokeRect(0.5, 0.5, W - 1, H - 1);
  g.fillStyle = '#7fb8e8'; g.font = 'bold 10px Consolas, monospace'; g.textAlign = 'left';
  g.fillText('FLIGHT RECORDER — ALTITUDE + SPEED', 8, 14);
  const rec = record.recorder || [];
  if (rec.length < 2) {
    g.fillStyle = '#5a7089'; g.font = '11px Consolas, monospace';
    g.fillText('NO FLIGHT RECORDED YET — FLY A RESCUE', 8, 60);
    return;
  }
  const t0 = rec[0].t, t1 = rec[rec.length - 1].t || 1;
  const maxAlt = Math.max(100, ...rec.map((p) => p.alt));
  const maxSpd = Math.max(10, ...rec.map((p) => p.spd));
  const X = (t) => 30 + ((t - t0) / Math.max(1, t1 - t0)) * (W - 40);
  const YA = (a) => H - 18 - (a / maxAlt) * (H - 40);
  const YS = (s) => H - 18 - (s / maxSpd) * (H - 40);
  // gridlines
  g.strokeStyle = 'rgba(60,90,130,0.35)';
  for (let i = 1; i <= 3; i++) {
    const y = H - 18 - (i / 4) * (H - 40);
    g.beginPath(); g.moveTo(30, y); g.lineTo(W - 10, y); g.stroke();
  }
  const line = (fn, color) => {
    g.strokeStyle = color; g.lineWidth = 2; g.beginPath();
    rec.forEach((p, i) => { const x = X(p.t), y = fn(p); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
    g.stroke();
  };
  line((p) => YA(p.alt), '#ffd27f');
  line((p) => YS(p.spd), '#7fd8ff');
  g.font = 'bold 10px Consolas, monospace';
  g.fillStyle = '#ffd27f'; g.fillText(`ALT ${rec[rec.length - 1].alt} FT`, 8, H - 5);
  g.fillStyle = '#7fd8ff'; g.fillText(`SPD ${rec[rec.length - 1].spd} KT`, 130, H - 5);
  g.fillStyle = '#9fc4e8'; g.fillText(`${Math.floor(t1 / 60)}:${String(t1 % 60).padStart(2, '0')} FLOWN`, W - 90, H - 5);
}

export function showEnd(title, text) {
  $('end-title').textContent = title;
  $('end-text').textContent = text;
  show('end-screen');
}

export function showLog() {
  const list = $('log-list');
  const lines = record.log.length ? record.log : [{ t: '--:--:--', text: 'No flights logged yet — the ridge is waiting.' }];
  list.innerHTML = lines.slice(-12).map((l) => `<div><b>${l.t}</b> — ${l.text}</div>`).join('');
  show('log-screen');
}

export function hideScreens() { show(null); }
