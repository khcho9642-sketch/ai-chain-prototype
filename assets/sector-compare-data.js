import { SECTORS } from './home-map-core.js';
import { sectorChains, sectorInstruments } from './home-sector-returns.js';
import { buildComparison, comparisonPeriods } from './peer-comparison-core.js';

// Single-company groups give the detail table the exact same dates and base as the sector.
const companyChains = sectorInstruments.map((instrument, i) => ({
  id: sectorChains.length + i + 1,
  name: instrument.symbol,
}));
const chains = [...sectorChains, ...companyChains];
const instruments = sectorInstruments.map((instrument, i) => ({
  ...instrument,
  chains: [...instrument.chains, companyChains[i].id],
}));
const supportedDays = new Set(Object.values(comparisonPeriods));

export function getSectorPeriod(snapshot, days) {
  if (snapshot?.schemaVersion !== 1 || !Array.isArray(snapshot.quotes)) {
    throw new TypeError('A version 1 snapshot with a quotes array is required');
  }
  const periodDays = comparisonPeriods[days] ?? Number(days);
  if (!supportedDays.has(periodDays)) throw new RangeError('Unsupported sector comparison period');

  const { dates, groups, metadata } = buildComparison({
    quotes: snapshot.quotes,
    generatedAt: snapshot.generatedAt,
    source: snapshot.source,
    instruments,
    chains,
    days: periodDays,
    requireFullPeriod: true,
  });
  const companyGroups = new Map(groups.slice(sectorChains.length).map(group => [group.name, group]));
  return {
    dates,
    generatedAt: metadata.generatedAt,
    source: metadata.source,
    warnings: metadata.warnings,
    sectors: SECTORS.map(({ id, name, color }, i) => ({
      id, name, color,
      series: groups[i].series.map(point => point.index),
      members: groups[i].peers.map(({ symbol, name, currency, reason }) => {
        const group = companyGroups.get(symbol);
        if (!group.available) {
          return { symbol, name, currency, series: null, reason: reason || group.unavailableReason };
        }
        return { symbol, name, currency, series: group.series.map(point => point.index) };
      }),
    })),
  };
}
