// Display precision only. Requests, chart coordinates and attribution retain their raw values.
export const oneDecimal = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export function signedValue(value, unit = '%') {
  const magnitude = oneDecimal.format(Math.abs(value))
  const sign = magnitude === '0.0' ? '' : value < 0 ? '−' : '+'
  return sign + magnitude + unit
}
