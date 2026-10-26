const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/
const KINDS=new Set(['value','value-index','volume-index','weight','revenue'])
export function validateIndustry(data,{now=new Date()}={}){
  if(data?.schemaVersion!==1||!Array.isArray(data.series)||!Array.isArray(data.sources))throw new Error('산업 통계 형식이 올바르지 않습니다.')
  const sourceIds=new Set(data.sources.map(s=>s.id)),ids=new Set(),currentMonth=now.toISOString().slice(0,7)
  for(const s of data.series){
    if(!s.id||ids.has(s.id)||!s.name||!KINDS.has(s.kind)||!s.unit||!sourceIds.has(s.sourceId)||!s.definition||s.frequency!=='monthly'||!Array.isArray(s.points))throw new Error(`통계 정의를 확인하세요: ${s.id||'ID 없음'}`)
    ids.add(s.id)
    if(['volume-index','value-index'].includes(s.kind)&&!s.unit.includes('=100'))throw new Error('지수에는 기준연도가 필요합니다.')
    if(s.kind==='weight'&&!['kg','톤','만 톤'].includes(s.unit))throw new Error('중량 통계 단위를 확인하세요.')
    if(!Array.isArray(s.chains)||s.chains.some(c=>!Number.isInteger(c)||c<1||c>8))throw new Error('고리 분류가 올바르지 않습니다.')
    const periods=new Set()
    for(const p of s.points){
      if(!MONTH.test(p.period)||p.period>currentMonth||periods.has(p.period)||typeof p.value!=='number'||!Number.isFinite(p.value)||p.value<0)throw new Error(`중복·미래월·결측·음수 통계: ${s.id} ${p.period}`)
      if(p.yoy!==undefined&&(typeof p.yoy!=='number'||!Number.isFinite(p.yoy)))throw new Error('증감률 형식이 올바르지 않습니다.')
      if(!['provisional','final','unaudited','published'].includes(p.status))throw new Error('통계 확정 여부가 필요합니다.')
      periods.add(p.period)
    }
  }
  for(const source of data.sources){if(!source.id||!source.name||!/^https:\/\//.test(source.url))throw new Error('공식 출처 링크가 필요합니다.')}
  return data
}
export function orderedPoints(series){return [...(series?.points||[])].sort((a,b)=>a.period.localeCompare(b.period))}
export function monthNumber(period){return Number(period.slice(0,4))*12+Number(period.slice(5,7))-1}
export function windowPoints(series,months){
  const points=orderedPoints(series),last=points.at(-1)
  return last?points.filter(p=>monthNumber(p.period)>monthNumber(last.period)-months):[]
}
export function yearOnYear(series,point){
  if(!point)return null
  if(Number.isFinite(point.yoy))return point.yoy
  const previous=series.points.find(p=>p.period===`${Number(point.period.slice(0,4))-1}${point.period.slice(4)}`)
  return previous?.value>0?(point.value/previous.value-1)*100:null
}
export function latestPoint(series){return orderedPoints(series).at(-1)||null}
export function staleSeries(series,now=new Date()){
  const point=latestPoint(series);if(!point)return true
  const [year,month]=point.period.split('-').map(Number)
  return (now.getUTCFullYear()-year)*12+now.getUTCMonth()+1-month>3
}
export function seriesCsv(series,source){
  const cell=v=>`"${String(v??'').replaceAll('"','""')}"`
  const rows=[['series','period','value','unit','yoy_percent','status','source','source_url','published_at','checked_at'],...orderedPoints(series).map(p=>[series.name,p.period,p.value,series.unit,yearOnYear(series,p),p.status,source.name,p.sourceUrl||source.url,p.publishedAt||source.publishedAt,p.checkedAt||series.checkedAt||source.checkedAt])]
  return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')
}
