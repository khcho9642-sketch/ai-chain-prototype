let loading
const positive = value => Number.isFinite(value) && value > 0
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value
const urlOK = value => value == null || /^https:\/\//.test(value) && URL.canParse(value)

export function validateCompanyMarket(snapshot) {
  if (snapshot?.schemaVersion !== 1 || !day(snapshot.asOf) || !day(snapshot.fxDate) || snapshot.fxDate > snapshot.asOf ||
      !Number.isFinite(Date.parse(snapshot.generatedAt)) || !snapshot.rows || Array.isArray(snapshot.rows) ||
      typeof snapshot.rows !== 'object' || !Object.keys(snapshot.rows).length) throw Error('기업 시세 기준일·원장 오류')
  for (const [id,row] of Object.entries(snapshot.rows)) {
    if (!/^(?:C|SCN)\d+$/.test(id) || row.companyId !== id || typeof row.listed !== 'boolean') throw Error('기업 시세 회사 ID 오류')
    for (const key of ['price','marketCapUsd','change1d','change1mo','changeYtd','high52w','fromHigh52w','revenueTtmUsd','revenueGrowth','pe','valuationUsd']) {
      if (row[key] !== null && !Number.isFinite(row[key])) throw Error('기업 시세 지표 오류: ' + key)
    }
    for (const key of ['sourceUrl','marketCapSourceUrl','fundamentalSourceUrl','valuationSourceUrl']) {
      if (!urlOK(row[key])) throw Error('기업 시세 출처 오류')
    }
    if (row.price !== null && (!row.listed || !positive(row.price) || row.asOf !== snapshot.asOf || !row.sourceUrl || !row.currency)) throw Error('비교 종가 기준일 오류')
    if (row.marketCapUsd !== null && (!row.listed || !positive(row.marketCapUsd) || row.marketCapDate !== snapshot.asOf || !row.marketCapSourceUrl)) throw Error('시총 기준일 오류')
    if (row.valuationUsd !== null && (row.listed || !positive(row.valuationUsd) || !day(row.valuationDate) || !row.valuationSourceUrl)) throw Error('비상장 평가 근거 오류')
    if (row.revenueTtmUsd !== null && (!day(row.revenueEnd) || row.revenueEnd > snapshot.asOf || !row.fundamentalSourceUrl)) throw Error('TTM 매출 근거 오류')
    if (row.loss === true && row.pe !== null) throw Error('적자 PER 오류')
  }
  return snapshot
}

export function getCompanyMarket(snapshot,id) {
  return Object.hasOwn(snapshot?.rows ?? {},id) ? snapshot.rows[id] : null
}

async function readSnapshot(path) {
  const response = await fetch(path,{cache:'no-cache',signal:AbortSignal.timeout(7000)})
  if (!response.ok) throw Error('기업 시세 HTTP ' + response.status)
  return validateCompanyMarket(await response.json())
}

export function loadCompanyMarket() {
  // Stored snapshot only: no polling or upstream quote requests during browsing.
  if (!loading) loading = readSnapshot('./data/company-market.json')
    .catch(error => { loading=undefined; throw error })
  return loading
}
