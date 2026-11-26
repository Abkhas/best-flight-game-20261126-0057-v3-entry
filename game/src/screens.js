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
  // Debrief headline: the rescue that was just debriefed, with its stars.
  const r = lastRescue;
  $('proof-headline').textContent = r
    ? `RESCUE COMPLETE — SURVIVOR ${r.delivered} OF ${r.of} DELIVERED · ${r.stars}★ OF 3 · ${r.verdict.toUpperCase()} LANDING`
    : 'RESCUE COMPLETE';
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
