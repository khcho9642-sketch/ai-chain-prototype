// Temporary public deployment mode: serve reviewed snapshots without live services.
export const realtimeEnabled = false
export const staticHost = !realtimeEnabled || (typeof location !== 'undefined' && (location.hostname.endsWith('.github.io') || location.protocol === 'file:'))
