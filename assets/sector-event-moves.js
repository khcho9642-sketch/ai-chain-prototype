import { comparisonSectors as DISPLAY_SECTORS, comparisonInstruments } from './sector-compare-data.js';
import { SECTORS } from './home-map-core.js';
const sectorOrder = [...SECTORS.map(sector => sector.id)];
if (!sectorOrder.includes('optical-communications')) sectorOrder.push('optical-communications');

const stocksBySector = new Map(sectorOrder.map((id, index) => [
  id, comparisonInstruments.filter(stock => stock.chains.includes(index + 1)).map(stock => stock.symbol),
]));
const stockSymbols = new Set(comparisonInstruments.map(stock => stock.symbol));
const DAY_MS = 86_400_000;

function closingPrices(quote, generatedAt, markets) {
  const bars = quote.bars1year ?? quote.histories?.['1y'] ?? (quote.interval === '1d' ? quote.bars : null);
  if (!Array.isArray(bars) || !quote.timezone || quote.status === 'error') return null;
  let market = markets.get(quote.timezone);
  if (!market) {
    let formatter;
    try {
      formatter = new Intl.DateTimeFormat('sv-SE', {
        year: 'numeric', month: '2-digit', day: '2-digit', timeZone: quote.timezone,
      });
    } catch { return null; }
    market = { formatter, barDates: new Map(), dates: new Set(), previous: new Map() };
    markets.set(quote.timezone, market);
  }
  const asOf = Math.min(generatedAt, Date.parse(quote.fetchedAt ?? '') || generatedAt);
  if (!Number.isFinite(asOf)) return null;
  const asOfDate = market.formatter.format(asOf);
  const confirmed = quote.priceBasis === 'previous-completed-session';
  if (confirmed && (typeof quote.closeDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(quote.closeDate) ||
      quote.closeDate > asOfDate)) return null;
  const prices = new Map();
  for (const bar of bars) {
    const time = bar?.time;
    if (!Number.isFinite(time) || time <= 0 || time * 1000 >= asOf) continue;
    // Most stocks in a market have identical candle timestamps.
    let date = market.barDates.get(time);
    if (!date) {
      date = market.formatter.format(time * 1000);
      market.barDates.set(time, date);
    }
    // Only the close collector can confirm a candle captured on its session date.
    if (confirmed ? date > quote.closeDate : date >= asOfDate) continue;
    market.dates.add(date);
    const prior = prices.get(date);
    if (!prior || time >= prior.time) prices.set(date, { time, close: bar.close });
  }
  return { prices, market };
}

// Return the equally weighted mean of members' individual daily moves. Each member needs
// both closes on adjacent observed sessions in its own market, including after holidays.
export function createSectorEventIndex(snapshot) {
  if (snapshot?.schemaVersion !== 1 || !Array.isArray(snapshot.quotes)) {
    throw new TypeError('A version 1 snapshot with a quotes array is required');
  }
  const markets = new Map();
  const stocks = new Map();
  const generatedAt = Date.parse(snapshot.generatedAt);
  for (const quote of snapshot.quotes) {
    if (!stockSymbols.has(quote?.symbol)) continue;
    const stock = closingPrices(quote, generatedAt, markets);
    if (stock) stocks.set(quote.symbol, stock);
  }
  for (const market of markets.values()) {
    const dates = [...market.dates].sort();
    for (let index = 1; index < dates.length; index++) {
      const date = dates[index];
      const prior = dates[index - 1];
      // Extended closures and source outages cannot be distinguished in the saved bars.
      if (Date.parse(date) - Date.parse(prior) <= 7 * DAY_MS) market.previous.set(date, prior);
    }
  }
  const sessionsBySector = new Map();
  function sessionDates(sectorId) {
    if (!sessionsBySector.has(sectorId)) {
      const days = new Set();
      for (const symbol of stocksBySector.get(sectorId) ?? []) {
        for (const [date, bar] of stocks.get(symbol)?.prices ?? []) {
          if (Number.isFinite(bar.close) && bar.close > 0) days.add(date);
        }
      }
      sessionsBySector.set(sectorId, [...days].sort());
    }
    return sessionsBySector.get(sectorId);
  }

  function sectorMove(date, { id: sectorId, name, color }) {
    const symbols = stocksBySector.get(sectorId);
    let sum = 0;
    let observedCount = 0;
    for (const symbol of symbols) {
      const stock = stocks.get(symbol);
      if (!stock) continue;
      const close = stock.prices.get(date)?.close;
      const previous = stock.prices.get(stock.market.previous.get(date))?.close;
      if (!Number.isFinite(close) || close <= 0 || !Number.isFinite(previous) || previous <= 0) continue;
      const change = (close / previous - 1) * 100;
      if (!Number.isFinite(change)) continue;
      sum += change;
      observedCount++;
    }
    return {
      sectorId, name, color, changePct: observedCount ? sum / observedCount : null,
      observedCount, totalCount: symbols.length,
    };
  }

  const movesByDate = new Map();
  function movesOn(date) {
    if (!movesByDate.has(date)) movesByDate.set(date, DISPLAY_SECTORS.map(sector => sectorMove(date, sector)));
    return movesByDate.get(date);
  }
  return { sessionDates, movesOn };
}

export function createSectorEventMoves(snapshot) {
  return createSectorEventIndex(snapshot).movesOn;
}
