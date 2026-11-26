// saves.js — the pilot record. SINGLE SOURCE OF TRUTH for every number the
// HUD, proof screen, title slots and log show. Totals here are HONEST: they
// count only what this build actually contains (4 missions, 7 survivors,
// 2 helipads, 4 rescue rings). Never inflate them.

// (No import from missions.js here: a circular import would break module
// init. The totals below are the honest build totals — 4 missions, 7
// survivors, 21 stars — and missions.js defines exactly that many.)

export const GAME = {
  title: 'SUMMIT LIFT',
  subtitle: 'HELICOPTER WINCH RESCUE OVER THE HIGH PEAKS',
  base: 'SUMMIT BASE · HELIPAD 07 · ELEV 2,400 M',
  callsign: 'LIFT-07',
  missions: 4,
  survivors: 7,  // missions.js: 3 + 1 + 1 + 2
  stars: 21,     // 3 stars per rescue
  rings: 4,
  pads: 2,
};

// Three pilot slots on the title screen. All three fly the same record;
// the slot is the pilot's seat, not a separate save file.
export const SLOTS = [
  { id: 1, callsign: 'LIFT-07', seat: 'LEAD · WINCH 1', note: 'Ridge-qualified' },
  { id: 2, callsign: 'LIFT-08', seat: 'WING · WINCH 2', note: 'Night medevac' },
  { id: 3, callsign: 'LIFT-09', seat: 'SPARE · WINCH 3', note: 'Valley ferry' },
];

export function freshRecord() {
  return {
    callsign: GAME.callsign,
    slot: 1,
    score: 0,            // earned points, session total — only moves on real events
    bestScore: 0,        // best session score — honestly the best of THIS session
    missionScores: { 1: 0, 2: 0, 3: 0, 4: 0 },
    missionsFlown: 0,
    missionsComplete: 0,
    rescuesDelivered: 0, // survivors delivered to a pad (of 7)
    stars: 0,            // rescue stars earned (of 21)
    softLandings: 0,
    hardLandings: 0,
    crashes: 0,
    cableWear: 0,        // % — +8 per delivered rescue, refit restores it
    refitPoints: 0,      // earned on mission complete — spend 1 on a refit
    decision: null,      // the pilot's FUEL LOW choice: 'RTB' | 'PRESS ON'
    flightMinutes: 0,
    flightSeconds: 0,
    bestLandingVs: null, // gentlest pad touchdown sink (m/s), null until first
    log: [],
  };
}

export const record = freshRecord();

export function logEvent(text) {
  const stamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
  record.log.push({ t: stamp, text });
  if (record.log.length > 24) record.log.shift();
}

// Points are only ever added by real game events (hover lock, hook, aboard,
// delivery). missionId attributes the points to the mission that earned them.
export function addScore(n, reason, missionId) {
  record.score += n;
  if (missionId && record.missionScores[missionId] !== undefined) record.missionScores[missionId] += n;
  if (record.score > record.bestScore) record.bestScore = record.score;
  logEvent(`+${n} — ${reason}`);
  return record.score;
}

export function addFlightTime(dtSeconds) {
  record.flightSeconds += dtSeconds;
  while (record.flightSeconds >= 60) {
    record.flightSeconds -= 60;
    record.flightMinutes += 1;
  }
}

export function flightTimeText() {
  const s = Math.floor(record.flightSeconds);
  return `${record.flightMinutes}:${String(s).padStart(2, '0')}`;
}

// Proof-screen cells: the debrief of the most recent rescue + campaign totals.
export function proofCells(lastRescue) {
  const r = lastRescue || { steadiness: 0, winchTime: 0, sink: 0, fuelLeft: 0, points: 0, stars: 0 };
  return [
    { lab: 'TOTAL SCORE', val: String(record.score), sub: `best ${record.bestScore} · earned in this session` },
    { lab: 'HOVER STEADINESS', val: `${r.steadiness}%`, sub: 'inside 3 m of the ring while lowering' },
    { lab: 'WINCH TIME', val: `${r.winchTime.toFixed(1)} S`, sub: 'cable down to survivor aboard' },
    { lab: 'LANDING SOFTNESS', val: `${r.sink.toFixed(1)} M/S`, sub: 'sink at touchdown · soft ≤ 3.0 m/s' },
    { lab: 'FUEL LEFT', val: `${r.fuelLeft}%`, sub: 'at delivery · cable wear ' + record.cableWear + '%' },
    { lab: 'RESCUES · STARS', val: `${record.rescuesDelivered}/${GAME.survivors} · ${record.stars}★`, sub: `of ${GAME.survivors} survivors · of ${GAME.stars} stars` },
  ];
}

export function proofNote(lastRescue) {
  const trap = record.bestLandingVs === null
    ? 'No pad landing yet — the pad is waiting.'
    : `Gentlest pad landing so far: ${record.bestLandingVs.toFixed(1)} m/s down (soft limit 3.0 m/s) — ${record.bestLandingVs <= 3.0 ? 'WITHIN LIMIT' : 'OVER LIMIT'}.`;
  const r = lastRescue;
  const stars = r ? `${r.stars}★ of 3 for this rescue` : 'no rescue debriefed yet';
  return `${record.missionsComplete} of ${GAME.missions} missions complete · ${record.rescuesDelivered} of ${GAME.survivors} survivors delivered · `
    + `${record.stars} of ${GAME.stars} stars. ${trap} ${stars}. `
    + `PILOT LOG — RESCUES ${record.rescuesDelivered}/${GAME.survivors} · STARS ${record.stars}/${GAME.stars} · `
    + `${record.softLandings} soft landings · ${record.hardLandings} hard · ${record.crashes} crashes.`;
}

// Medals are computed from REAL recorded performance only. A mission's medal
// keys on its rescues delivered + stars earned in it; nothing is assigned
// for flying nothing.
const MEDAL_RANK = { '—': 0, BRONZE: 1, SILVER: 2, GOLD: 3 };
export function missionMedals() {
  return [1, 2, 3, 4].map((id) => {
    const sc = record.missionScores[id];
    const medal = sc >= 1400 ? 'GOLD' : sc >= 800 ? 'SILVER' : sc > 0 ? 'BRONZE' : '—';
    return { id, medal, score: sc };
  });
}
export function sessionMedal() {
  let best = '—';
  for (const s of missionMedals()) if (MEDAL_RANK[s.medal] > MEDAL_RANK[best]) best = s.medal;
  return best;
}

export function sessionRank() {
  const medal = sessionMedal();
  if (record.missionsComplete >= 4 && medal === 'GOLD') return 'S';
  if (record.missionsComplete >= 4 || medal === 'GOLD') return 'A';
  if (medal === 'SILVER' || record.rescuesDelivered >= 3) return 'B';
  if (record.score > 0) return 'C';
  return 'D';
}

export function incidentLine() {
  const trap = record.bestLandingVs === null ? 'no pad landing yet'
    : `gentlest landing ${record.bestLandingVs.toFixed(1)} m/s down`;
  if (record.crashes === 0 && record.hardLandings === 0)
    return `INCIDENT LOG — Clean session: no hard landings, no crashes · ${trap}.`;
  return `INCIDENT LOG — ${record.hardLandings} hard landing${record.hardLandings === 1 ? '' : 's'} · `
    + `${record.crashes} crash${record.crashes === 1 ? '' : 'es'} · ${trap}.`;
}
