import { SECTORS } from './home-map-core.js';
import { validateComparisonHistorySnapshot } from './comparison-history-core.js';
import { getSectorPeriod } from './sector-compare-data.js';
import { mountSectorCompare } from './sector-compare-view.js';

const host = document.getElementById('v-sector-compare');
const staticSite = location.hostname.endsWith('.github.io') || location.protocol === 'file:';
const periodModels = new WeakMap();
let view;
let days = 90;
let requestedSector;
let generation = 0;
let historyFeed;
let savedMarket;
let marketFailed = false;
let displayedSnapshot;

async function readSnapshot(url, validate) {
  const response = await fetch(url, { cache: 'no-cache', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('종가 조회 실패 (HTTP ' + response.status + ')');
  const snapshot = await response.json();
  if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.quotes)) throw new Error('종가 파일 형식 오류');
  return validate ? validate(snapshot) : snapshot;
}

function loadHistory() {
  if (!historyFeed) {
    historyFeed = (async () => {
      if (!staticSite) {
        try {
          return { snapshot: await readSnapshot('./api/comparison-history', validateComparisonHistorySnapshot) };
        } catch {
          // A bundled snapshot preserves its own observation dates and collection timestamp.
        }
      }
      return { snapshot: await readSnapshot('./data/comparison-history.json', validateComparisonHistorySnapshot), saved: true };
    })().catch(error => { historyFeed = null; throw error; });
  }
  return historyFeed;
}

function waitForMarket() {
  // The dashboard owns the short-period request and publishes the result to every chapter.
  return new Promise(resolve => {
    const finish = () => {
      clearTimeout(timer);
      window.removeEventListener('market-snapshot', finish);
      window.removeEventListener('market-snapshot-error', finish);
      resolve();
    };
    const timer = setTimeout(finish, 21000);
    window.addEventListener('market-snapshot', finish);
    window.addEventListener('market-snapshot-error', finish);
  });
}

async function loadMarket() {
  if (!window.aiChainSnapshot && !marketFailed && !savedMarket) await waitForMarket();
  if (window.aiChainSnapshot) return { snapshot: window.aiChainSnapshot };
  savedMarket ??= readSnapshot('./data/market.json').catch(error => { savedMarket = null; throw error; });
  return { snapshot: await savedMarket, saved: true };
}

function draw(feed, period) {
  let cache = periodModels.get(feed.snapshot);
  if (!cache) {
    cache = new Map();
    periodModels.set(feed.snapshot, cache);
  }
  if (!cache.has(period)) {
    const model = getSectorPeriod(feed.snapshot, period);
    if (feed.saved) model.source = (model.source || '종가') + ' · 배포 저장본';
    cache.set(period, model);
  }
  view.showPeriod(cache.get(period), period, { sectorId: requestedSector });
  requestedSector = undefined;
  displayedSnapshot = feed.snapshot;
}

async function showPeriod(period, { loading = true } = {}) {
  const token = ++generation;
  days = period;
  if (loading) view.showLoading(period);
  try {
    const feed = await (period > 365 ? loadHistory() : loadMarket());
    if (token === generation && !host.hidden) draw(feed, period);
  } catch {
    if (token === generation && !host.hidden) view.showError(period, '선택한 기간의 종가를 불러오지 못했습니다.');
  }
}

function retry() {
  if (days > 365) historyFeed = null;
  else {
    savedMarket = null;
    marketFailed = false;
    window.dispatchEvent(new Event('market-refresh-request'));
  }
  showPeriod(days);
}

window.addEventListener('market-snapshot-error', () => { marketFailed = true; });
window.addEventListener('market-snapshot', event => {
  marketFailed = false;
  if (view && !host.hidden && days <= 365 && displayedSnapshot &&
      displayedSnapshot.generatedAt !== event.detail.generatedAt) showPeriod(days, { loading: false });
});

window.renderSectorCompare = function (sectorId) {
  requestedSector = SECTORS.some(sector => sector.id === sectorId) ? sectorId : undefined;
  view ??= mountSectorCompare(host, { onPeriodChange: showPeriod, onRetry: retry });
  showPeriod(days);
};

if (!host.hidden) window.renderSectorCompare(location.hash.split('/')[1]);
