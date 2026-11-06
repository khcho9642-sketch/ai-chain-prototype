import { MARKET_DATA_POLICY } from '../../assets/market-data-policy.js'

// This projection never collects prices. The complete stored archive remains
// unchanged; the browser receives only the saved timestamps and close values
// needed by its charts, return calculations and co-movement observations.
function closePoints(points) {
  if (!Array.isArray(points)) return points
  return points.map(point => {
    if (!point || typeof point !== 'object' || Array.isArray(point)) return point
    const result = {}
    for (const key of ['time', 'close']) if (Object.hasOwn(point, key)) result[key] = point[key]
    return result
  })
}

export function buildMarketDisplaySnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.quotes)) throw new Error('저장된 시세 스냅샷 형식이 올바르지 않습니다.')
  return {
    ...snapshot,
    displayOnly: true,
    displayBasis: 'stored-closes',
    collectionStopped: !MARKET_DATA_POLICY.collectionEnabled,
    quotes: snapshot.quotes.map(quote => {
      if (!quote || typeof quote !== 'object' || Array.isArray(quote)) return quote
      const result = { ...quote }
      for (const key of ['bars', 'bars1year']) {
        if (Object.hasOwn(quote, key)) result[key] = closePoints(quote[key])
      }
      if (quote.histories && typeof quote.histories === 'object' && !Array.isArray(quote.histories)) {
        result.histories = Object.fromEntries(Object.entries(quote.histories)
          .map(([range, points]) => [range, closePoints(points)]))
      }
      return result
    }),
  }
}
