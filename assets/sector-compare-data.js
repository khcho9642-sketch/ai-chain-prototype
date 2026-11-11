import { DISPLAY_SECTORS, SECTORS } from './home-map-core.js';
import { sectorChains as mapChains, sectorInstruments as mapInstruments } from './home-sector-returns.js';
import { buildComparison, comparisonPeriods } from './peer-comparison-core.js';

// Optical companies are compared using the same saved daily closes as the map.
const optical = { id: 'optical-communications', name: '광통신', color: '#62D0E8' };
const opticalMembers = [
  ['GLW', '코닝'], ['300308.SZ', '이노라이트'], ['LITE', '루멘텀'],
  ['300502.SZ', 'Eoptolink'], ['5803.T', '후지쿠라'], ['COHR', '코히어런트'], ['CIEN', '시에나'],
];
const hasOptical = SECTORS.some(sector => sector.id === optical.id);
const sectors = hasOptical ? SECTORS : [...SECTORS, optical];
export const comparisonSectors = [...DISPLAY_SECTORS];
if (!hasOptical) comparisonSectors.splice(comparisonSectors.findIndex(sector => sector.id === 'ai-equipment') + 1, 0, optical);
const sectorChains = hasOptical ? mapChains : [...mapChains, { id: sectors.length, name: optical.name }];
const opticalSymbols = new Set(opticalMembers.map(([symbol]) => symbol));
export const comparisonInstruments = hasOptical ? mapInstruments : [
  ...mapInstruments.filter(instrument => !opticalSymbols.has(instrument.symbol)),
  ...opticalMembers.map(([symbol, name]) => ({ symbol, name, chains: [sectors.length] })),
];

// Single-company groups give the detail table the exact same dates and base as the sector.
const companyChains = comparisonInstruments.map((instrument, i) => ({
  id: sectorChains.length + i + 1,
  name: instrument.symbol,
}));
const chains = [...sectorChains, ...companyChains];
const instruments = comparisonInstruments.map((instrument, i) => ({
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
  const sectorGroups = new Map(sectors.map(({ id }, index) => [id, groups[index]]));
  const companyGroups = new Map(groups.slice(sectorChains.length).map(group => [group.name, group]));
  return {
    dates,
    generatedAt: metadata.generatedAt,
    source: metadata.source,
    warnings: metadata.warnings,
    sectors: comparisonSectors.map(({ id, name, color }) => {
      const sector = sectorGroups.get(id);
      return {
        id, name, color,
        series: sector.series.map(point => point.index),
        members: sector.peers.map(({ symbol, name, currency, reason }) => {
          const group = companyGroups.get(symbol);
          if (!group.available) {
            return { symbol, name, currency, series: null, reason: reason || group.unavailableReason };
          }
          return { symbol, name, currency, series: group.series.map(point => point.index) };
        }),
      };
    }),
  };
}
