import { COMPANIES, SECTORS } from './home-map-core.js';
import { buildComparison } from './peer-comparison-core.js';

const chains = SECTORS.map((sector, index) => ({ id: index + 1, name: sector.name }));
const chainByName = new Map(chains.map(chain => [chain.name, chain.id]));
const instruments = COMPANIES.map(company => ({
  symbol: company.ticker,
  name: company.name,
  chains: [chainByName.get(company.sector)],
}));

// Only primary-sector membership and collected daily closes are reused here.
// The map's demonstration market caps and generated returns never enter this calculation.
export function buildHomeSectorReturns(snapshot, { now = Date.now() } = {}) {
  if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.quotes)) {
    throw new TypeError('A version 1 market snapshot with a quotes array is required');
  }
  const comparison = buildComparison({
    quotes: snapshot.quotes,
    instruments,
    chains,
    days: 90,
    requireFullPeriod: true,
    generatedAt: snapshot.generatedAt,
    source: snapshot.source,
    now,
  });
  comparison.methodology.universeCaveat = '현재 지도에 등록된 대표 종목을 각 기업의 주력 분야 한 곳에만 포함합니다. 과거 시점의 산업 구성 전체를 재현한 지수는 아닙니다.';
  return comparison;
}
