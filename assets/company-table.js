// Public table definitions are also the whitelist for shareable URL preferences.
export const columns = [
  ['name','회사명'], ['sector','섹터'], ['role','역할'], ['country','국가·거래소'], ['ticker','티커'],
  ['price','주가','현지 통화'], ['marketCapUsd','시가총액','억 달러'], ['change1d','등락률 1일','%'],
  ['change1mo','등락률 1개월','%'], ['changeYtd','연초 대비','YTD · %'], ['fromHigh52w','52주 고점 대비','%'],
  ['revenueTtmUsd','매출(최근 4분기)','억 달러'], ['revenueGrowth','매출 성장률','전년 대비 · %'], ['pe','PER','배'],
].map(([id,label,unit]) => Object.freeze({id,label,unit}))
export const columnIds = columns.map(c => c.id)
export const defaultSort = 'marketCapUsd'
const collator = new Intl.Collator('ko', {numeric:true, sensitivity:'base'})
const num = new Intl.NumberFormat('ko', {maximumFractionDigits:2})
const compact = new Intl.NumberFormat('ko', {maximumFractionDigits:1})
const signed = new Intl.NumberFormat('ko', {maximumFractionDigits:2, signDisplay:'exceptZero'})
export const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c])
const flagCode = {'미국':'US','한국':'KR','대한민국':'KR','일본':'JP','중국':'CN','대만':'TW','홍콩':'HK','영국':'GB','프랑스':'FR','독일':'DE','네덜란드':'NL','캐나다':'CA','이스라엘':'IL','스위스':'CH','스웨덴':'SE','싱가포르':'SG','핀란드':'FI','인도':'IN','노르웨이':'NO','호주':'AU','아일랜드':'IE','이탈리아':'IT','덴마크':'DK','벨기에':'BE','말레이시아':'MY','오스트리아':'AT','스페인':'ES','바레인':'BH','베트남':'VN','아랍에미리트':'AE','사우디아라비아':'SA','필리핀':'PH','뉴질랜드':'NZ','브라질':'BR','러시아':'RU','카타르':'QA','남아프리카공화국':'ZA','튀르키예':'TR','룩셈부르크':'LU','인도네시아':'ID','태국':'TH'}
const flag = country => {const code=flagCode[country.split(/[·/]/)[0].trim()] ?? country; return /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...Array.from(code,x=>127397+x.charCodeAt(0))) : ''}
const missing = '<span class="ci-na" aria-label="자료 없음">—</span>'
const safeUrl = value => {try {const u=new URL(value);return u.protocol==='https:'?esc(u.href):''}catch{return ''}}
export const columnsFor = hidden => columns.filter(c=>!(hidden || '').split(',').includes(c.id) || c.id==='name')
export const defaultDirection = id => columns.find(c=>c.id===id)?.unit ? 'desc' : 'asc'
const primary = (c,row) => row?.ticker ? {...c.listings?.find(l=>l.ticker===row.ticker), ticker:row.ticker, exchange:row.exchange || c.listings?.find(l=>l.ticker===row.ticker)?.exchange} : c.listings?.[0]
function sortValue(c,row,field,sectors) {
  switch(field) {
    case 'name':return c.name
    case 'role':return c.selection?.role || c.product
    case 'country':return [c.country,primary(c,row)?.exchange].filter(Boolean).join(' · ')
    case 'sector':return sectors.get(c.sectorId)?.name
    case 'ticker':return primary(c,row)?.ticker ?? c.listingCodes?.[0]
    case 'marketCapUsd':return c.listed ? row?.marketCapUsd : null
    default:return row?.[field]
  }
}
export function sortCompanies(companies, state, sectors, marketFor) {
  const factor = state.dir === 'asc' ? 1 : -1
  const value = c => sortValue(c, marketFor(c.id), state.sort, sectors)
  const seen = new Map(companies.map(c=>[c.id,value(c)]))
  return [...companies].sort((a,b)=>{
    const x=seen.get(a.id), y=seen.get(b.id)
    const absent = v => v == null || v === '' || (typeof v === 'number' && !Number.isFinite(v))
    if (absent(x)!==absent(y)) return absent(x)?1:-1
    return (absent(x) ? 0 : factor*(typeof x==='number' && typeof y==='number' ? x-y : collator.compare(x,y))) || collator.compare(a.name,b.name) || a.id.localeCompare(b.id)
  })
}
const note = s => s ? '<small>'+esc(s)+'</small>' : ''
const unitAmount = n => n!==0 && Math.abs(n)<1e6 ? '&lt;0.01' : num.format(n/1e8)
export function renderCell(col,c,row,sectors) {
  const l=primary(c,row), val=row?.[col.id], title=(...bits)=>' title="'+esc(bits.filter(Boolean).join(' · '))+'"'
  const number=(v,format,fyi)=>Number.isFinite(v)?'<span'+title(fyi)+'>'+format(v)+'</span>':missing
  switch(col.id) {
    case 'name':return (c.selection?'<a class="ci-company-link" href="#company-info/company/'+encodeURIComponent(c.id)+'">'+esc(c.name)+'</a>':'<strong>'+esc(c.name)+'</strong>')+(c.selection?' <span class="ci-core-label">핵심</span>':'')+note(c.englishName!==c.name?c.englishName:'')
    case 'sector':{const s=sectors.get(c.sectorId);return s?'<span class="ci-sector-tag" style="--sector:'+esc(s.color)+'">'+esc(s.name)+'</span>':missing}
    case 'role':return esc(c.selection?.role || c.product)+(c.tags??[]).map(tag=>'<small class="ci-role-tag">'+esc(tag)+'</small>').join('')
    case 'country':return '<span aria-hidden="true">'+flag(c.country)+'</span> '+esc(c.country)+note(c.listed?l?.exchange:'비상장')
    case 'ticker':return esc(l?.ticker || c.listingCodes?.[0]) || missing
    case 'price':{const url=safeUrl(row?.sourceUrl), value=number(val,num.format,row?.asOf);return (url&&Number.isFinite(val)?'<a class="ci-value-source" href="'+url+'" title="종가 출처 · '+esc(row.asOf)+'" target="_blank" rel="noopener noreferrer">'+value+'</a>':value)+(Number.isFinite(val)?note(row.currency||l?.currency):'')}
    case 'marketCapUsd':{
      if (!c.listed) {
        if (!Number.isFinite(row?.valuationUsd)) return missing+note('비상장')
        const url=safeUrl(row.valuationSourceUrl)
        return unitAmount(row.valuationUsd)+(row.valuationQualifier==='above'?' 초과':'')+'<small>비상장·평가액</small>'+(url?'<a class="ci-asof-link" href="'+url+'" target="_blank" rel="noopener noreferrer">'+esc(row.valuationDate || '평가 출처')+' ↗</a>':note(row.valuationDate))
      }
      return number(val,unitAmount,row?.marketCapDate)
    }
    case 'revenueTtmUsd':{const url=safeUrl(row?.fundamentalSourceUrl),value=number(val,unitAmount,row?.revenueEnd);return url&&Number.isFinite(val)?'<a class="ci-value-source" href="'+url+'" title="재무 출처 · '+esc(row.revenueEnd)+'" target="_blank" rel="noopener noreferrer">'+value+'</a>':value}
    case 'pe':return row?.loss===true || (Number.isFinite(val) && val<0) ? '<span class="ci-loss">적자</span>' : number(val,compact.format,row?.revenueEnd)
    default:return Number.isFinite(val)?'<span class="'+(val>0?'ci-up':val<0?'ci-down':'')+'"'+title(col.id==='revenueGrowth'?[row?.growthPriorEnd,row?.growthEnd].filter(Boolean).join(' → '):row?.asOf)+'>'+signed.format(val)+'%</span>'+(col.id==='revenueGrowth'?note(row?.revenueGrowthPeriod==='ttm'?'최근 4분기':'최근 분기'):''):missing
  }
}
export function tableHtml(rows,state,sectors,marketFor) {
  const visible=columnsFor(state.hidden)
  const head=visible.map(c=>'<th scope="col" data-col="'+c.id+'"'+(c.id===state.sort?' aria-sort="'+(state.dir==='asc'?'ascending':'descending')+'"':'')+'><button data-ci-sort="'+c.id+'" aria-label="'+esc(c.label)+' 정렬">'+esc(c.label)+' <span aria-hidden="true">'+(c.id===state.sort?(state.dir==='asc'?'↑':'↓'):'↕')+'</span>'+note(c.unit)+'</button></th>').join('')
  const body=rows.slice(0,state.limit).map(c=>{const row=marketFor(c.id);return '<tr data-company-id="'+esc(c.id)+'">'+visible.map(col=>'<td data-col="'+col.id+'"'+(col.unit?' class="ci-number"':'')+'>'+renderCell(col,c,row,sectors)+'</td>').join('')+'</tr>'}).join('')
  return '<div class="ci-scroll-table" tabindex="0" role="region" aria-label="전체 기업 비교표, 가로로 스크롤"><table class="ci-market-table"><caption class="sr">전체 기업 비교 · 열 이름을 눌러 정렬</caption><thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody></table></div>'
}
