// Collection is stopped at the user's request. Existing snapshots remain viewable.
export const MARKET_DATA_POLICY = Object.freeze({
  collectionEnabled: false,
  liveRequestsEnabled: false,
  autoRefreshEnabled: false,
  snapshotUrl: './data/market-display.json',
  statusLabel: '시세 수집 중지 · 저장된 종가 표시',
})
