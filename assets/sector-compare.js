import { realtimeEnabled, staticHost } from './site-runtime.js'
import { validateComparisonHistorySnapshot } from './comparison-history-core.js';
import { getSectorPeriod } from './sector-compare-data.js';
import { mountSectorCompare } from './sector-compare-view.js';
import { createSectorEventIndex } from './sector-event-moves.js';
import { MARKET_DATA_POLICY } from './market-data-policy.js';

const autoRefreshEnabled = realtimeEnabled && MARKET_DATA_POLICY.autoRefreshEnabled
const liveRequestsEnabled = realtimeEnabled && MARKET_DATA_POLICY.liveRequestsEnabled

const host = document.getElementById('v-sector-compare');
const staticSite = !liveRequestsEnabled || staticHost;
const periodModels = new WeakMap();
let view;
let days = 90;
let entryTarget;
let generation = 0;
let historyFeed;
let savedMarket;
let marketFailed = false;
let displayedSnapshot;

async function readSnapshot(url, validate) {
  const response = await fetch(url, { cache: autoRefreshEnabled ? 'no-cache' : 'force-cache', signal: AbortSignal.timeout(20000) });
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
    })().catch(error => { if (autoRefreshEnabled) historyFeed = null; throw error; });
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
  savedMarket ??= readSnapshot(MARKET_DATA_POLICY.snapshotUrl).catch(error => { if (autoRefreshEnabled) savedMarket = null; throw error; });
  return { snapshot: await savedMarket, saved: true };
}

function draw(feed, period) {
  let cache = periodModels.get(feed.snapshot);
  if (!cache) {
    cache = { periods: new Map(), events: createSectorEventIndex(feed.snapshot) };
    periodModels.set(feed.snapshot, cache);
  }
  if (!cache.periods.has(period)) {
    const model = getSectorPeriod(feed.snapshot, period);
    model.eventMovesOn = cache.events.movesOn;
    model.sectorSessionDates = cache.events.sessionDates;
    if (feed.saved) model.source = (model.source || '종가') + ' · 배포 저장본';
    if (!autoRefreshEnabled) model.source = (model.source || '종가') + ' · ' + MARKET_DATA_POLICY.statusLabel;
    cache.periods.set(period, model);
  }
  view.showPeriod(cache.periods.get(period), period, { sectorId: entryTarget, openStocks: entryTarget === 'stocks' });
  entryTarget = undefined;
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
  if (!autoRefreshEnabled) {
    showPeriod(days, { loading: false });
    return;
  }
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

window.renderSectorCompare = function (target) {
  entryTarget = target;
  view ??= mountSectorCompare(host, { onPeriodChange: showPeriod, onRetry: retry });
  showPeriod(days);
};

if (!host.hidden) window.renderSectorCompare(location.hash.split('/')[1]);
