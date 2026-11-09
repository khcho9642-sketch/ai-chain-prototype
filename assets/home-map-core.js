/**
 * AI value-chain map calculation module. No network calls or dependencies.
 * All company market caps and returns below are synthetic demonstration data,
 * not current quotes, published market caps, or investment recommendations.
 * cap is measured in USD billions. country identifies the issuer's home market.
 */

import { SECTOR_DISPLAY_IDS } from './chain-order.js';

export const DATA_NOTE = '화면 미리보기용 합성 데이터입니다. 실시간 시세가 아닙니다. 시총 단위: USD 십억.';

// This order also defines the original workbook codes and the ripple direction.
export const SECTORS = Object.freeze([
  { id: 'semiconductor-equipment', name: '반도체 소부장', color: '#68A9FF' },
  { id: 'foundry-packaging', name: '파운드리·패키징', color: '#47CCDE' },
  { id: 'memory', name: '메모리', color: '#B397EF' },
  { id: 'ai-chips', name: 'AI 칩', color: '#F1B45D' },
  { id: 'ai-equipment', name: 'AI 장비', color: '#4BD2AA' },
  { id: 'power-cooling', name: '전력·냉각', color: '#E583AE' },
  { id: 'data-centers', name: '데이터센터', color: '#D9C466' },
  { id: 'cloud-gpu', name: '클라우드·GPU 컴퓨팅', color: '#71BDEB' },
  { id: 'ai-models', name: 'AI 모델', color: '#CA98E5' },
].map(Object.freeze));

export const DISPLAY_SECTORS = Object.freeze(SECTOR_DISPLAY_IDS.map(id => SECTORS.find(sector => sector.id === id)));

// A company has one primary sector, so its market cap is counted only once.
const ROWS = [
  ['asml', 'ASML', 'ASML', 'NL', 0, 420, 1.8],
  ['applied-materials', 'AMAT', '어플라이드 머티어리얼즈', 'US', 0, 185, 1.3],
  ['lam-research', 'LRCX', '램리서치', 'US', 0, 142, -0.8],
  ['kla', 'KLAC', 'KLA', 'US', 0, 118, 0.9],
  ['tokyo-electron', '8035.T', '도쿄일렉트론', 'JP', 0, 102, 2.4],
  ['advantest', '6857.T', '어드반테스트', 'JP', 0, 64, 3.6],
  ['disco', '6146.T', '디스코', 'JP', 0, 36, -1.1],
  ['hpsp', '403870.KQ', 'HPSP', 'KR', 0, 4.6, 2.7],

  ['tsmc', 'TSM', 'TSMC', 'TW', 1, 1320, 1.2],
  ['umc', 'UMC', 'UMC', 'TW', 1, 24, -0.7],
  ['globalfoundries', 'GFS', '글로벌파운드리스', 'US', 1, 29, -1.6],
  ['amkor', 'AMKR', '앰코테크놀로지', 'US', 1, 13, 0.6],
  ['ase', '3711.TW', 'ASE 테크놀로지', 'TW', 1, 25, 1.7],
  ['hanmi-semiconductor', '042700.KS', '한미반도체', 'KR', 1, 11, 4.3],
  ['besi', 'BESI.AS', 'BE 세미컨덕터 인더스트리스', 'NL', 1, 12, -0.4],

  ['sk-hynix', '000660.KS', 'SK하이닉스', 'KR', 2, 330, 3.8],
  ['samsung-electronics', '005930.KS', '삼성전자', 'KR', 2, 410, 1.6],
  ['micron', 'MU', '마이크론', 'US', 2, 178, 4.7],
  ['western-digital', 'WDC', '웨스턴디지털', 'US', 2, 28, -0.9],
  ['sandisk', 'SNDK', '샌디스크', 'US', 2, 21, 2.1],
  ['nanya', '2408.TW', '난야테크놀로지', 'TW', 2, 7, 0],

  ['nvidia', 'NVDA', '엔비디아', 'US', 3, 3900, 2.6],
  ['amd', 'AMD', 'AMD', 'US', 3, 390, 3.4],
  ['broadcom', 'AVGO', '브로드컴', 'US', 3, 1100, -1.2],
  ['marvell', 'MRVL', '마벨테크놀로지', 'US', 3, 92, 2.3],
  ['qualcomm', 'QCOM', '퀄컴', 'US', 3, 190, -0.7],
  ['arm', 'ARM', '암 홀딩스', 'GB', 3, 180, 1.9],
  ['mediatek', '2454.TW', '미디어텍', 'TW', 3, 76, 1.1],
  ['cambricon', '688256.SS', '캠브리콘', 'CN', 3, 38, -2.6],

  ['dell', 'DELL', '델 테크놀로지스', 'US', 4, 98, 1.4],
  ['supermicro', 'SMCI', '슈퍼마이크로컴퓨터', 'US', 4, 28, -3.8],
  ['hpe', 'HPE', '휴렛팩커드 엔터프라이즈', 'US', 4, 32, 0.7],
  ['arista', 'ANET', '아리스타 네트웍스', 'US', 4, 160, 2.9],
  ['cisco', 'CSCO', '시스코', 'US', 4, 238, 0],
  ['innolight', '300308.SZ', '이노라이트', 'CN', 4, 34, 3.1],
  ['accton', '2345.TW', '액톤테크놀로지', 'TW', 4, 16, 1.8],

  ['ge-vernova', 'GEV', 'GE 버노바', 'US', 5, 145, 2.2],
  ['vistra', 'VST', '비스트라', 'US', 5, 65, 4.1],
  ['constellation', 'CEG', '컨스텔레이션 에너지', 'US', 5, 102, 2.8],
  ['eaton', 'ETN', '이튼', 'IE', 5, 160, 0.9],
  ['vertiv', 'VRT', '버티브', 'US', 5, 58, 3.5],
  ['schneider', 'SU.PA', '슈나이더 일렉트릭', 'FR', 5, 152, 1.2],
  ['abb', 'ABBN.SW', 'ABB', 'CH', 5, 112, -0.6],
  ['hd-hyundai-electric', '267260.KS', 'HD현대일렉트릭', 'KR', 5, 14, 5.2],

  ['equinix', 'EQIX', '에퀴닉스', 'US', 6, 86, 0.8],
  ['digital-realty', 'DLR', '디지털리얼티', 'US', 6, 62, -0.5],
  ['iron-mountain', 'IRM', '아이언마운틴', 'US', 6, 35, 1.1],
  ['gds', 'GDS', 'GDS 홀딩스', 'CN', 6, 9, 2.4],
  ['vnet', 'VNET', 'VNET 그룹', 'CN', 6, 3.5, -1.7],
  ['keppel-dc-reit', 'AJBU.SI', '케펠 DC 리츠', 'SG', 6, 5.2, 0.6],

  ['microsoft', 'MSFT', '마이크로소프트', 'US', 7, 3750, -0.4],
  ['amazon', 'AMZN', '아마존', 'US', 7, 2400, 1.1],
  ['oracle', 'ORCL', '오라클', 'US', 7, 720, 2.2],
  ['coreweave', 'CRWV', '코어위브', 'US', 7, 78, 5.7],
  ['nebius', 'NBIS', '네비우스', 'NL', 7, 22, 4.6],
  ['alibaba', 'BABA', '알리바바', 'CN', 7, 310, -1.5],
  ['tencent', '0700.HK', '텐센트', 'CN', 7, 580, 0.7],
  ['kt', '030200.KS', 'KT', 'KR', 7, 10, 0.3],

  ['alphabet', 'GOOGL', '알파벳 구글', 'US', 8, 2760, -1.1],
  ['meta', 'META', '메타 플랫폼스', 'US', 8, 1780, 0.8],
  ['baidu', 'BIDU', '바이두', 'CN', 8, 40, -2.1],
  ['naver', '035420.KS', '네이버', 'KR', 8, 34, 1.7],
  ['kakao', '035720.KS', '카카오', 'KR', 8, 19, -0.6],
  ['iflytek', '002230.SZ', '아이플라이텍', 'CN', 8, 16, 2.6],
];

export const COMPANIES = Object.freeze(ROWS.map(([id, ticker, name, country, sectorIndex, cap, day]) =>
  Object.freeze({ id, ticker, name, country, sector: SECTORS[sectorIndex].name, cap, day })
));

const PERIOD_ALIASES = new Map([
  ['1d', '1d'], ['day', '1d'], ['1일', '1d'],
  ['1w', '1w'], ['week', '1w'], ['1주', '1w'],
  ['1m', '1m'], ['month', '1m'], ['1개월', '1m'],
  ['3m', '3m'], ['3개월', '3m'], ['6m', '6m'], ['6개월', '6m'],
  ['1y', '1y'], ['year', '1y'], ['1년', '1y'], ['ytd', 'ytd'],
]);
const PERIOD_PARAMETERS = {
  '1w': [1.6, 4], '1m': [3.2, 11], '3m': [5.0, 22],
  '6m': [6.6, 34], '1y': [8.3, 48], ytd: [6.0, 36],
};
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const round = (value, digits = 2) => Number(value.toFixed(digits));
function hashUnit(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

/** Other periods are deterministic synthetic values, not compounded live data. */
export function getReturn(company, period = '1d') {
  const canonical = PERIOD_ALIASES.get(String(period).toLowerCase());
  if (!canonical) throw new RangeError(`Unsupported return period: ${period}`);
  if (company?.returns && Object.hasOwn(company.returns, canonical)) {
    return isFiniteNumber(company.returns[canonical]) ? company.returns[canonical] : null;
  }
  if (!isFiniteNumber(company?.day)) return null;
  if (canonical === '1d') return company.day;
  const [multiplier, variation] = PERIOD_PARAMETERS[canonical];
  const noise = (hashUnit(`${company.id ?? company.ticker}:${canonical}`) * 2 - 1) * variation;
  return round(Math.max(-95, company.day * multiplier + noise));
}

const normalizeText = (value) => String(value ?? '').normalize('NFKC').toLowerCase();
const compactText = (value) => normalizeText(value).replace(/[^\p{L}\p{N}]/gu, '');
const isAll = (value) => value == null || value === '' || /^(all|전체)$/i.test(String(value));
function selectionSet(value, upperCase = false) {
  const values = Array.isArray(value) ? value : [value];
  if (!values.length || values.some(isAll)) return null;
  return new Set(values.map((entry) => upperCase ? String(entry).toUpperCase() : String(entry)));
}

/** Country AND sector AND query; alternatives inside one filter are OR. */
export function filterCompanies(companies = COMPANIES, { country = 'all', sector = 'all', query = '' } = {}) {
  const countries = selectionSet(country, true);
  const sectors = selectionSet(sector);
  const terms = normalizeText(query).trim().split(/\s+/).filter(Boolean).map(compactText);
  return companies.filter((company) => {
    if (countries && !countries.has(String(company.country).toUpperCase())) return false;
    if (sectors && !sectors.has(company.sector)) return false;
    const searchable = compactText(`${company.id} ${company.ticker} ${company.name} ${company.sector}`);
    return terms.every((term) => searchable.includes(term));
  });
}

/**
 * Squarified treemap without gutters. Every rectangle's area is proportional to
 * its positive finite weight. Apply decorative tile borders inside these boxes.
 */
export function treemap(items, x, y, w, h, weightFn = (item) => item.cap) {
  if (![x, y, w, h].every(isFiniteNumber) || w < 0 || h < 0 ||
      !Number.isFinite(x + w) || !Number.isFinite(y + h) || !Number.isFinite(w * h)) {
    throw new RangeError('Treemap bounds must be finite with non-negative dimensions.');
  }
  if (w === 0 || h === 0 || !items?.length) return [];
  const weighted = items.map((data, index) => ({ data, index, weight: weightFn(data) }))
    .filter((item) => isFiniteNumber(item.weight) && item.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  if (!weighted.length) return [];
  const maxWeight = weighted[0].weight;
  const normalizedSum = weighted.reduce((sum, item) => sum + item.weight / maxWeight, 0);
  const totalArea = w * h;
  const nodes = weighted.map((item) => ({ ...item, area: totalArea * (item.weight / maxWeight) / normalizedSum }));
  const rects = [];
  const box = { x, y, w, h };

  function worst(row, side) {
    if (!row.length || side <= 0) return Infinity;
    const sum = row.reduce((value, node) => value + node.area, 0);
    const largest = row[0].area;
    const smallest = row[row.length - 1].area;
    return Math.max((side * side * largest) / (sum * sum), (sum * sum) / (side * side * smallest));
  }

  function place(row, finalRow) {
    const area = row.reduce((sum, node) => sum + node.area, 0);
    if (box.w >= box.h) {
      const stripWidth = finalRow ? box.w : Math.min(box.w, area / box.h);
      let cy = box.y;
      row.forEach((node, index) => {
        const height = index === row.length - 1 ? box.y + box.h - cy : node.area / stripWidth;
        rects.push({ data: node.data, x: box.x, y: cy, w: stripWidth, h: Math.max(0, height) });
        cy += height;
      });
      box.x += stripWidth;
      box.w = Math.max(0, box.w - stripWidth);
    } else {
      const stripHeight = finalRow ? box.h : Math.min(box.h, area / box.w);
      let cx = box.x;
      row.forEach((node, index) => {
        const width = index === row.length - 1 ? box.x + box.w - cx : node.area / stripHeight;
        rects.push({ data: node.data, x: cx, y: box.y, w: Math.max(0, width), h: stripHeight });
        cx += width;
      });
      box.y += stripHeight;
      box.h = Math.max(0, box.h - stripHeight);
    }
  }

  let row = [];
  let index = 0;
  while (index < nodes.length) {
    const next = nodes[index];
    const side = Math.min(box.w, box.h);
    if (!row.length || worst([...row, next], side) <= worst(row, side)) {
      row.push(next);
      index += 1;
    } else {
      place(row, false);
      row = [];
    }
  }
  if (row.length) place(row, true);
  return rects;
}

function niceStep(value) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(Number.EPSILON, value)));
  const fraction = value / magnitude;
  const choice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return choice * magnitude;
}

/**
 * Categorical x / return y / market-cap area. Only x is adjusted for overlap.
 * All nodes share one r = radiusScale * sqrt(cap); no minimum-radius distortion.
 * Browser UI may add an invisible larger hit target to small nodes.
 */
export function bubbleLayout(items, width = 1080, height = 560, { period = '1d', sector = 'all' } = {}) {
  if (!isFiniteNumber(width) || !isFiniteNumber(height) || width <= 0 || height <= 0) {
    throw new RangeError('Bubble chart dimensions must be positive finite numbers.');
  }
  const viewWidth = Math.max(360, width);
  const viewHeight = Math.max(240, height);
  const plotBounds = {
    x: 48, y: 22, width: viewWidth - 64, height: viewHeight - 100,
    left: 48, right: viewWidth - 16, top: 22, bottom: viewHeight - 78,
  };
  const requested = selectionSet(sector);
  const sectors = DISPLAY_SECTORS.filter((entry) => !requested || requested.has(entry.name) || requested.has(entry.id));
  const sectorByName = new Map(sectors.map((entry) => [entry.name, entry]));
  const excluded = [];
  const valid = [];
  for (const data of items ?? []) {
    if (!sectorByName.has(data.sector)) continue;
    const value = getReturn(data, period);
    if (!isFiniteNumber(data.cap) || data.cap <= 0) excluded.push({ data, reason: 'missing-cap' });
    else if (!isFiniteNumber(value)) excluded.push({ data, reason: 'missing-return' });
    else valid.push({ data, value });
  }
  const values = valid.map((entry) => entry.value);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const span = Math.max(2, rawMax - rawMin);
  const padding = Math.max(0.6, span * 0.25);
  const step = niceStep((span + padding * 2) / 5);
  const yDomain = [Math.floor((rawMin - padding) / step) * step, Math.ceil((rawMax + padding) / step) * step];
  const columnWidth = plotBounds.width / Math.max(1, sectors.length);
  const maximumRadius = Math.min(54, columnWidth * 0.44, plotBounds.height * 0.13);
  const maximumCap = Math.max(0, ...valid.map((entry) => entry.data.cap));
  const radiusScale = maximumCap > 0 ? maximumRadius / Math.sqrt(maximumCap) : 0;
  const sectorCenters = sectors.map((entry, index) => ({
    sector: entry.name, x: plotBounds.x + columnWidth * (index + 0.5), index, color: entry.color,
  }));
  const nodes = [];
  for (const center of sectorCenters) {
    const members = valid.filter((entry) => entry.data.sector === center.sector)
      .sort((a, b) => b.data.cap - a.data.cap || a.data.id.localeCompare(b.data.id));
    const placed = [];
    for (const entry of members) {
      const r = radiusScale * Math.sqrt(entry.data.cap);
      const y = plotBounds.y + (yDomain[1] - entry.value) / (yDomain[1] - yDomain[0]) * plotBounds.height;
      const minimumX = center.x - columnWidth / 2 + r + 1;
      const maximumX = center.x + columnWidth / 2 - r - 1;
      const candidates = [center.x];
      for (let index = 0; index <= 20; index += 1) {
        candidates.push(minimumX + (maximumX - minimumX) * index / 20);
      }
      let chosenX = center.x;
      let smallestPenalty = Infinity;
      for (const candidate of candidates) {
        const penalty = placed.reduce((sum, other) => {
          const overlap = Math.max(0, r + other.r + 1 - Math.hypot(candidate - other.x, y - other.y));
          return sum + overlap * overlap;
        }, 0) + (candidate - center.x) ** 2 * 0.0001;
        if (penalty < smallestPenalty) {
          smallestPenalty = penalty;
          chosenX = candidate;
        }
      }
      const node = { data: entry.data, x: chosenX, y, r, value: entry.value };
      placed.push(node);
      nodes.push(node);
    }
  }
  return { nodes, sectorCenters, yDomain, plotBounds, width: viewWidth, height: viewHeight, radiusScale, excluded };
}
