import { columnIds, defaultSort } from './company-table.js'
const compareNames = new Intl.Collator('ko', { numeric:true, sensitivity:'base' })
export const pageSize = 25
export const defaultList = Object.freeze({tab:'core',q:'',sector:'',country:'',listing:'',sort:defaultSort,dir:'desc',hidden:'',limit:pageSize})
export function listHref(state) {
  const params = new URLSearchParams()
  for (const key of Object.keys(defaultList)) {
    if (state[key] !== undefined && state[key] !== defaultList[key]) params.set(key,state[key])
  }
  return '#company-info'+(params.size?'?'+params:'')
}
export function readList(hash,catalog) {
  const params=new URLSearchParams(hash.split('?')[1])
  const sector=params.get('sector'),country=params.get('country'),listing=params.get('listing')
  const requested=Number(params.get('limit')), hidden=(params.get('hidden')||'').split(',')
  return {
    tab:params.get('tab')==='all'?'all':'core',q:params.get('q')||'',
    sector:catalog.sectors.some(item=>item.id===sector)?sector:'',
    country:catalog.companies.some(item=>item.country===country)?country:'',
    listing:['listed','private'].includes(listing)?listing:'',
    sort:columnIds.includes(params.get('sort'))?params.get('sort'):defaultSort,dir:params.get('dir')==='asc'?'asc':'desc',
    hidden:columnIds.filter(id=>id!=='name'&&hidden.includes(id)).join(','),
    limit:Number.isSafeInteger(requested)&&requested>=pageSize?Math.min(requested,Math.max(pageSize,catalog.companies.length)):pageSize,
  }
}
const normalized=text=>String(text??'').normalize('NFKC').toLowerCase().replace(/\s+/gu,'')
export function matchCompanies(companies,state) {
  const query=normalized(state.q)
  return companies.filter(c=>{
    if(state.tab==='core'&&!c.selection || state.sector&&state.sector!==c.sectorId || state.country&&state.country!==c.country || state.listing&&c.listed!==(state.listing==='listed'))return false
    return !query||[c.name,c.englishName,...c.aliases,c.product,c.selection?.role,...(c.tags??[]),...(c.listingCodes??[]),...c.listings.map(l=>l.ticker)].some(field=>normalized(field).includes(query))
  }).sort((a,b)=>(state.tab==='core'?a.selection.order-b.selection.order:0)||compareNames.compare(a.name,b.name)||a.id.localeCompare(b.id))
}
export function parseCompanyRoute(hash) {
  const [page,section,encoded,tab='overview',...extra]=hash.split('?')[0].split('/')
  if(page!=='#company-info')return null
  if(!section)return {kind:'list'}
  if(section!=='company'||!encoded||extra.length)return {kind:'missing'}
  try{return {kind:'detail',id:decodeURIComponent(encoded),tab}}catch{return {kind:'missing'}}
}
