import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export const instruments = [
  ['ASML','ASML',[1]], ['042700.KS','한미반도체',[1]],
  ['TSM','TSMC ADR',[2]], ['005930.KS','삼성전자',[2,3]], ['INTC','인텔',[2]],
  ['000660.KS','SK하이닉스',[3]], ['MU','마이크론',[3]],
  ['NVDA','엔비디아',[4]], ['AMD','AMD',[4]], ['AVGO','브로드컴',[4]],
  ['267260.KS','HD현대일렉트릭',[5]], ['010120.KS','LS ELECTRIC',[5]], ['VRT','버티브',[5]],
  ['MSFT','마이크로소프트',[6]], ['AMZN','아마존',[6]],
  ['EQIX','에퀴닉스 · 데이터센터 리츠',[6]], ['DLR','디지털 리얼티 · 데이터센터 리츠',[6]],
  ['GOOGL','알파벳 (구글)',[7]], ['META','메타',[7]],
  ['035420.KS','NAVER',[8]], ['PLTR','팔란티어',[8]],
  ['^KS11','코스피',[0]], ['^KQ11','코스닥',[0]], ['^GSPC','S&P 500',[0]], ['^IXIC','나스닥',[0]], ['KRW=X','달러/원',[0]],
].map(([symbol,name,chains]) => ({symbol,name,chains}))

const number = value => Number.isFinite(value) ? value : null
export function normalize(result) {
  const meta = result.meta || {}
  const q = result.indicators?.quote?.[0] || {}
  const bars = (result.timestamp || []).map((time,i) => ({ time, open:number(q.open?.[i]), high:number(q.high?.[i]), low:number(q.low?.[i]), close:number(q.close?.[i]), volume:number(q.volume?.[i]) })).filter(b => Number.isFinite(b.close))
  const price = number(meta.regularMarketPrice)
  // A one-year chart's chartPreviousClose is NOT yesterday's close.
  const past = bars.filter(b => b.time < meta.regularMarketTime && new Date(b.time * 1000).toLocaleDateString('en-CA', {timeZone:meta.exchangeTimezoneName || 'UTC'}) !== new Date(meta.regularMarketTime * 1000).toLocaleDateString('en-CA', {timeZone:meta.exchangeTimezoneName || 'UTC'}))
  const previousClose = number(meta.previousClose) ?? (Number.isFinite(meta.fulldayChange) && price !== null ? price - meta.fulldayChange : past.at(-1)?.close ?? null)
  const change = price !== null && previousClose !== null ? price - previousClose : null
  return {price, previousClose, change, changePercent: change !== null && previousClose ? change / previousClose * 100 : null, currency:meta.currency || '', exchange:meta.fullExchangeName || meta.exchangeName || '', timezone:meta.exchangeTimezoneName || 'UTC', marketTime:number(meta.regularMarketTime), high:number(meta.regularMarketDayHigh), low:number(meta.regularMarketDayLow), volume:number(meta.regularMarketVolume), yearHigh:number(meta.fiftyTwoWeekHigh), yearLow:number(meta.fiftyTwoWeekLow), bars, events:result.events || {}}
}
export async function fetchInstrument(item) {
  let last
  for (const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']) {
    try {
      const results = await Promise.all(['range=1y&interval=1d&events=div%2Csplits','range=1d&interval=5m'].map(async params => {
        const res = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(item.symbol)}?${params}`, { headers:{'User-Agent':'Mozilla/5.0'}, signal:AbortSignal.timeout(15000) })
        if (!res.ok) throw new Error(`제공처 HTTP ${res.status}`)
        const body = await res.json()
        if (!body.chart?.result?.[0]) throw new Error(body.chart?.error?.description || '시세 없음')
        return body.chart.result[0]
      }))
      // Use a one-day quote's baseline together with the historical daily bars.
      const daily = results[1].meta
      const data = normalize({...results[0],meta:{...daily,previousClose:daily.previousClose ?? daily.chartPreviousClose}})
      if (data.price === null || !data.marketTime || !data.bars.length) throw new Error('필수 시세 데이터 없음')
      return {...item,...data,status:'ok',fetchedAt:new Date().toISOString(),source:'Yahoo Finance',sourceUrl:`https://finance.yahoo.com/quote/${encodeURIComponent(item.symbol)}/`,error:null}
    } catch (error) { last = error }
  }
  throw last
}
export async function collect(output = 'data/market.json') {
  let previous = {}
  try { previous = JSON.parse(await readFile(output,'utf8')) } catch {}
  const queue = [...instruments], quotes = []
  await Promise.all(Array.from({length:3},async () => {
    while (queue.length) {
      const item = queue.shift()
      try { quotes.push(await fetchInstrument(item)) }
      catch(error) {
        const old = previous.quotes?.find(q => q.symbol === item.symbol && Number.isFinite(q.price))
        quotes.push({...item,...(old || {}),status:old?'stale':'error',error:error.message})
        console.error(item.symbol,error.message)
      }
    }
  }))
  quotes.sort((a,b) => instruments.findIndex(i => i.symbol === a.symbol) - instruments.findIndex(i => i.symbol === b.symbol))
  const data = {schemaVersion:1,generatedAt:new Date().toISOString(),source:'Yahoo Finance',mode:'scheduled-snapshot',refreshMinutes:30,quotes}
  await mkdir(fileURLToPath(new URL('../data/',import.meta.url)),{recursive:true})
  await writeFile(output+'.tmp',JSON.stringify(data)+'\n')
  await rename(output+'.tmp',output)
  const ok = quotes.filter(q => q.status === 'ok').length
  console.log(`market snapshot: ${ok}/${quotes.length} successful`)
  if (!ok) throw new Error('전체 조회 실패. 이전 시세는 기준시각과 실패 상태로 유지합니다.')
  return data
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) collect().catch(error => { console.error(error); process.exitCode = 1 })
