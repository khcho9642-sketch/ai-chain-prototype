import { buildCompanyMarket } from '../../scripts/data/company-market-table.mjs'

export function companyMarketFixture(){
  const day='2026-01-05'
  return buildCompanyMarket({
    market:{generatedAt:day+'T22:00:00Z',quotes:[{companyId:'C0001',symbol:'EXAMPLE',currency:'USD',
      timezone:'UTC',sourceUrl:'https://example.org/quote',priceBasis:'previous-completed-session',
      closeDate:day,bars:[{time:Date.parse(day)/1000,close:10,high:12}]}]},
    companies:[{id:'C0001',listed:true}],seriesById:new Map(),now:day+'T23:00:00Z'
  })
}
