const DAY = 86400000
const positive = value => Number.isFinite(value) && value > 0
const gap = (a,b) => (Date.parse(a)-Date.parse(b))/DAY
const formatter = new Map()
function dayInZone(seconds,zone) {
  if (!formatter.has(zone)) formatter.set(zone,new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}))
  return formatter.get(zone).format(new Date(seconds*1000))
}
function barDates(quote) {
  if (quote?.priceBasis !== 'previous-completed-session' || !quote.closeDate || !quote.timezone) return []
  return quote.bars.filter(bar => positive(bar.close) && Number.isFinite(bar.time))
    .map(bar => ({date:dayInZone(bar.time,quote.timezone),close:bar.close,high:bar.high}))
    .filter(bar => bar.date<=quote.closeDate)
}

function selectIssuers(quotes,masterIds) {
  const result=new Map()
  for(const quote of quotes){
    if(!masterIds.has(quote.companyId))continue
    if(!result.has(quote.companyId) || quote.primaryForCompany)result.set(quote.companyId,quote)
  }
  return result
}

// Pick the latest widely completed date. A holiday or suspended issuer never
// turns an earlier close into a price for the comparison session.
export function commonSession(histories) {
  const counts=new Map()
  for(const bars of histories){
    for(const date of new Set(bars.slice(-6).map(row=>row.date)))counts.set(date,(counts.get(date)||0)+1)
  }
  if(!counts.size)throw Error('비교할 확정 종가가 없습니다.')
  const latest=[...counts.keys()].sort().at(-1)
  const dates=[...counts.keys()].filter(date=>gap(latest,date)<=8).sort().reverse()
  const most=Math.max(...dates.map(date=>counts.get(date)))
  return dates.find(date=>counts.get(date)>=most*.95)
}
function priorMonth(date){
  const target=new Date(date), day=target.getUTCDate()
  target.setUTCDate(1);target.setUTCMonth(target.getUTCMonth()-1)
  const last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate()
  target.setUTCDate(Math.min(day,last))
  return target.toISOString().slice(0,10)
}
const percent=(value,base)=> Number.isFinite(value) && positive(base) ? (value/base-1)*100 : null
function reference(bars,target){
  const row=bars.findLast(bar=>bar.date<=target)
  return row && gap(target,row.date)<=10 ? row.close : null
}
function fxAt(market,date) {
  const rates = new Map([['USD',{rate:1,sourceUrl:null}]])
  for(const [currency,history] of Object.entries(market.fxHistory||{})){
    if(history.baseCurrency!=='USD'||history.quoteConvention!=='currency-per-USD'||history.currency!==currency)continue
    const value=history.observations?.find(row=>row.date===date)?.unitsPerUSD
    if(positive(value))rates.set(currency,{rate:value,sourceUrl:history.sourceUrl})
  }
  return rates
}
function trailing(series,quarterly,date) {
  const totals=new Map((series||[]).filter(x=>x.date<=date).map(x=>[x.date,x]))
  const quarters=(quarterly||[]).filter(x=>x.date<=date)
  for(let end=3;end<quarters.length;end++){
    const window=quarters.slice(end-3,end+1), last=window.at(-1)
    if(totals.has(last.date)||!window.every((row,i)=>row.currency===last.currency&&(!i||
      gap(row.date,window[i-1].date)>=70&&gap(row.date,window[i-1].date)<=112)))continue
    totals.set(last.date,{date:last.date,value:window.reduce((sum,row)=>sum+row.value,0),currency:last.currency})
  }
  return [...totals.values()].sort((a,b)=>a.date.localeCompare(b.date))
}
const usd=(value,currency,rates)=>Number.isFinite(value)&&rates.has(currency)?value/rates.get(currency).rate:null
function currencyInfo(currency,rates){
  const fx=rates.get(currency)
  return fx?{currency,unitsPerUsd:fx.rate,sourceUrl:fx.sourceUrl}:null
}
function yearEarlier(values,latest){
  if(!latest)return null
  return values.filter(x=>x.currency===latest.currency&&Math.abs(gap(latest.date,x.date)-365)<=14)
    .sort((a,b)=>Math.abs(gap(latest.date,a.date)-365)-Math.abs(gap(latest.date,b.date)-365))[0]
}

export function buildCompanyMarket({market,companies,seriesById,valuations=[],previous,now=new Date()}){
  const ids=new Set(companies.map(row=>row.id))
  const quotes=selectIssuers(market.quotes,ids)
  const histories=new Map([...quotes].map(([id,q])=>[id,barDates(q)]))
  const asOf=commonSession([...histories.values()])
  const rates=fxAt(market,asOf)
  const valuationById=new Map(valuations.filter(v=>v.date<=asOf).map(v=>[v.companyId,v]))
  const rows={}
  for(const company of companies){
    const q=quotes.get(company.id), bars=(histories.get(company.id)||[]).filter(x=>x.date<=asOf)
    const exact=bars.at(-1)?.date===asOf?bars.at(-1):null
    const row={companyId:company.id,listed:company.listed,ticker:q?.symbol||null,exchange:q?.exchange||company.exchange||null,
      currency:q?.currency||null,asOf:exact?asOf:null,lastCloseDate:q?.closeDate||null,price:exact?.close??null,
      marketCapUsd:null,marketCapDate:null,marketCapSourceUrl:null,change1d:null,change1mo:null,changeYtd:null,
      high52w:null,fromHigh52w:null,revenueTtmUsd:null,revenueEnd:null,revenueGrowth:null,pe:null,loss:null,
      valuationUsd:null,valuationDate:null,valuationSourceUrl:null,valuationQualifier:null,fxDate:asOf,
      sourceUrl:q?.sourceUrl||null,fundamentalSourceUrl:null}
    rows[company.id]=row
    if(!company.listed){
      const value=valuationById.get(company.id)
      if(value)Object.assign(row,{valuationUsd:usd(value.value,value.currency,rates),valuationDate:value.date,
        valuationCurrency:value.currency,valuationNative:value.value,valuationQualifier:value.qualifier||null,
        valuationFx:currencyInfo(value.currency,rates),valuationSourceUrl:value.url,valuationKind:value.kind})
      continue
    }
    if(!q)continue
    if(exact){
      const previousBar=bars.at(-2)
      row.change1d=percent(exact.close,previousBar?.close)
      row.change1mo=percent(exact.close,reference(bars,priorMonth(asOf)))
      row.changeYtd=percent(exact.close,reference(bars,(Number(asOf.slice(0,4))-1)+'-12-31'))
      const window=bars.filter(bar=>gap(asOf,bar.date)<364)
      if(gap(asOf,bars[0].date)>=357&&window.length&&window.every(bar=>positive(bar.high))){
        row.high52w=Math.max(...window.map(bar=>bar.high))
        row.fromHigh52w=percent(exact.close,row.high52w)
      }
    }
    let info=seriesById.get(company.id)
    const old=previous?.rows?.[company.id]
    if(info?.ticker!==q.symbol)info=null
    const cap=info?.caps?.find(item=>item.date===asOf)||q.marketCapHistory?.find(item=>item.date===asOf)
    if(cap&&positive(cap.value)){
      Object.assign(row,{marketCapUsd:usd(cap.value,cap.currency,rates),marketCapDate:cap.date,
        marketCapSourceUrl:cap.sourceUrl,marketCapNative:cap.value,marketCapFx:currencyInfo(cap.currency,rates)})
    }else if(old?.ticker===q.symbol&&old.marketCapDate===asOf&&old.fxDate===asOf){
      for(const key of ['marketCapUsd','marketCapDate','marketCapSourceUrl','marketCapNative','marketCapFx'])row[key]=old[key]??null
    }
    const url='https://finance.yahoo.com/quote/'+encodeURIComponent(q.symbol)+'/financials/'
    const revenue=trailing(info?.trailingTotalRevenue,info?.quarterlyTotalRevenue,asOf)
    const income=trailing(info?.trailingNetIncomeCommonStockholders,info?.quarterlyNetIncomeCommonStockholders,asOf)
    const priorFacts=old?.ticker===q.symbol?old.fundamentals:null
    let totals=revenue.at(-1)??priorFacts?.revenue
    let earnings=income.at(-1)??priorFacts?.earnings
    if(totals && (totals.date>asOf || gap(asOf,totals.date)>270))totals=null
    if(earnings && (earnings.date>asOf || gap(asOf,earnings.date)>270))earnings=null
    const quarter=info?.quarterlyTotalRevenue?.findLast(x=>x.date<=asOf)??priorFacts?.quarter
    const comparable=yearEarlier(info?.quarterlyTotalRevenue||[],quarter)??(priorFacts?.quarter?.date===quarter?.date?priorFacts?.priorQuarter:null)
    const priorTtm=yearEarlier(revenue,totals)??(priorFacts?.revenue?.date===totals?.date?priorFacts?.priorTtm:null)
    if(totals||earnings||quarter){
      row.fundamentals={revenue:totals??null,earnings:earnings??null,priorTtm:priorTtm??null,quarter:quarter??null,priorQuarter:comparable??null}
      row.fundamentalSourceUrl=url
      row.fundamentalFetchedAt=info?.fetchedAt||old?.fundamentalFetchedAt||null
    }
    if(totals){
      row.revenueTtmUsd=usd(totals.value,totals.currency,rates);row.revenueEnd=totals.date
      row.revenueFx=currencyInfo(totals.currency,rates)
    }
    if(quarter&&comparable&&quarter.date<=asOf&&gap(asOf,quarter.date)<=200){
      row.revenueGrowth=percent(quarter.value,comparable.value)
      row.growthEnd=quarter.date;row.growthPriorEnd=comparable.date;row.revenueGrowthPeriod='quarter'
    }else if(totals&&priorTtm){
      row.revenueGrowth=percent(totals.value,priorTtm.value)
      row.growthEnd=totals.date;row.growthPriorEnd=priorTtm.date;row.revenueGrowthPeriod='ttm'
    }
    if(earnings)row.loss=earnings.value<0
    if(row.loss!==true && earnings?.value!==0 && exact){
      const observed=info?.trailingPeRatio?.find(x=>x.date===asOf)
      const incomeUsd=earnings?usd(earnings.value,earnings.currency,rates):null
      if(positive(observed?.value)){row.pe=observed.value;row.peBasis='reported-trailing'}
      else if(positive(incomeUsd)&&positive(row.marketCapUsd)){row.pe=row.marketCapUsd/incomeUsd;row.peBasis='cap-over-ttm-common-income'}
      else if(!info&&old?.ticker===q.symbol&&old.asOf===asOf){row.pe=old.pe;row.peBasis=old.peBasis}
    }
  }
  return {schemaVersion:1,generatedAt:new Date(now).toISOString(),asOf,fxDate:asOf,
    priceSnapshotAt:market.generatedAt,coverage:{companies:companies.length,listed:companies.filter(c=>c.listed).length,
      closes:Object.values(rows).filter(r=>r.price!==null).length,marketCaps:Object.values(rows).filter(r=>r.marketCapUsd!==null).length,
      revenues:Object.values(rows).filter(r=>r.revenueTtmUsd!==null).length,privateValuations:Object.values(rows).filter(r=>r.valuationUsd!==null).length},rows}
}
