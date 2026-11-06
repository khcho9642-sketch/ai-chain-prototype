import { sectorEvents } from './sector-event-catalog.js';

const DAY = 86_400_000;

function firstOnOrAfter(dates, day) {
  let low = 0;
  let high = dates.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (dates[middle] < day) low = middle + 1;
    else high = middle;
  }
  return low;
}

function fractionOnAxis(dates, day) {
  const index = firstOnOrAfter(dates, day);
  if (dates[index] === day) return index / (dates.length - 1);
  const before = Date.parse(dates[index - 1]);
  const after = Date.parse(dates[index]);
  return (index - 1 + (Date.parse(day) - before) / (after - before)) / (dates.length - 1);
}

function extremaDates(dates, series) {
  const result = new Map();
  if (series?.length !== dates.length) return result;
  let high = -1, low = -1, count = 0;
  for (let i = 0; i < series.length; i++) {
    const value = series[i];
    if (!Number.isFinite(value) || value <= 0) continue;
    if (high < 0 || value > series[high]) high = i;
    if (low < 0 || value < series[low]) low = i;
    count++;
  }
  if (count < 2) return result;
  result.set(dates[high], ['high']);
  if (low === high) result.get(dates[high]).push('low');
  else result.set(dates[low], ['low']);
  return result;
}

function standardLimit(days) {
  if (days <= 30) return 5;
  if (days <= 90) return 6;
  if (days <= 180) return 8;
  return 12;
}

export function getSectorEventCandidates(model, sectorId, catalog = sectorEvents, options = {}) {
  const dates = model?.dates;
  const sector = model?.sectors?.find(item => item.id === sectorId);
  if (!sector || !dates || dates.length < 2) return [];
  const first = dates[0], last = dates.at(-1);
  const range = options.days ?? (Date.parse(last) - Date.parse(first)) / DAY;
  const { limit = standardLimit(range), threshold = 4, radius = 3 } = options;
  const sessions = model.sectorSessionDates?.(sectorId) ?? dates;
  const extrema = extremaDates(dates, sector.series);
  const focusedEvents = catalog.filter(event => event.sectorIds?.includes(sectorId));
  const directDates = new Set(focusedEvents.map(event => event.tradingDate)
    .filter(date => date >= first && date <= last));
  const moves = new Map();
  const candidates = new Set([...directDates, ...extrema.keys()]);
  for (const date of sessions) {
    if (date < first || date > last) continue;
    const move = model.eventMovesOn?.(date)?.find(row => row.sectorId === sectorId);
    if (!Number.isFinite(move?.changePct) || move.observedCount === 0) continue;
    moves.set(date, move.changePct);
    if (Math.abs(move.changePct) + 1e-10 >= threshold) candidates.add(date);
  }
  const rows = [];
  for (const date of candidates) {
    const kinds = [...(extrema.get(date) ?? [])];
    const mandatory = kinds.length > 0;
    const changePct = moves.get(date) ?? null;
    const magnitude = Math.abs(changePct ?? 0);
    const large = changePct !== null && magnitude + 1e-10 >= threshold;
    if (large) kinds.push(changePct > 0 ? 'rise' : 'fall');

    let from = date, through = date;
    const center = firstOnOrAfter(sessions, date);
    if (mandatory && sessions[center] === date) {
      from = sessions[Math.max(0, center - radius)];
      through = sessions[Math.min(sessions.length - 1, center + radius)];
    }
    // The trading date, including an after-hours shift, locates an announcement.
    // Keep its original record intact so the card can separately show its publication date.
    const distance = event => Math.abs(firstOnOrAfter(sessions, event.tradingDate) - center);
    const events = focusedEvents.filter(event => event.tradingDate >= from && event.tradingDate <= through)
      .sort((a, b) => distance(a) - distance(b) ||
        a.tradingDate.localeCompare(b.tradingDate) || a.id.localeCompare(b.id));
    let score = 50 + Math.min(40, Number(magnitude.toFixed(6)));
    if (mandatory) score = 100;
    else if (directDates.has(date)) score = 95;
    rows.push({ date, fraction: fractionOnAxis(dates, date), sectorId, kinds,
      changePct, events, mandatory, related: true, score });
  }
  // Reserve one recent observation in each direction so a later sell-off (or rally)
  // can still be seen when much larger historical moves fill the score ranking.
  const recentStart = new Date(Date.parse(last) - 90 * DAY).toISOString().slice(0, 10);
  const recent = rows.filter(row => row.date >= recentStart).sort((a, b) => b.date.localeCompare(a.date));
  const represented = new Set(['rise', 'fall'].map(kind => recent.find(row => row.kinds.includes(kind))));
  rows.sort((a, b) => Number(b.mandatory) - Number(a.mandatory) ||
    Number(represented.has(b)) - Number(represented.has(a)) || b.score - a.score ||
    b.date.localeCompare(a.date));
  return rows.slice(0, Math.max(extrema.size, limit))
    .sort((a, b) => a.date.localeCompare(b.date));
}
