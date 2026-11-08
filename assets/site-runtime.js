// Latest approved main with all live services temporarily paused.
export const realtimeEnabled = false
export const staticHost = !realtimeEnabled || (typeof location !== 'undefined' && (location.hostname.endsWith('.github.io') || location.protocol === 'file:'))
export const sourceCommit = '8a0eea41ce08b43ef0e859916d0ce6f87cda3d85'
