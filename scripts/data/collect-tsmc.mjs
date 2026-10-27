export const TWSE_URL='https://openapi.twse.com.tw/v1/opendata/t187ap05_L'
export function parseTsmcRevenue(rows,{now=new Date()}={}){
  const row=Array.isArray(rows)&&rows.find(r=>r['公司代號']==='2330')
  if(!row)throw new Error('TWSE TSMC 기업코드가 없습니다.')
  const match=String(row['資料年月']).match(/^(\d{3})(0[1-9]|1[0-2])$/)
  if(!match)throw new Error('TWSE 기준월 형식이 바뀌었습니다.')
  const period=`${Number(match[1])+1911}-${match[2]}`
  if(period>now.toISOString().slice(0,7))throw new Error('미래월 매출은 사용할 수 없습니다.')
  const raw=row['營業收入-當月營收'],yoy=row['營業收入-去年同月增減(%)']
  if(typeof raw!=='string'||!/^\d+(?:\.\d+)?$/.test(raw)||Number(raw)<=0)throw new Error('TWSE 당월 매출이 없습니다.')
  // TWSE revenue is TWD thousands; the displayed series uses TWD millions, as TSMC IR does.
  const point={period,value:Number(raw)/1000,status:'unaudited',sourceUrl:TWSE_URL,checkedAt:now.toISOString()}
  if(typeof yoy==='string'&&yoy.trim()&&Number.isFinite(Number(yoy)))point.yoy=Number(yoy)
  return point
}
export async function collectTsmc(previous,{fetcher=fetch,now=new Date()}={}){
  const checkedAt=now.toISOString()
  try{
    const response=await fetcher(TWSE_URL,{signal:AbortSignal.timeout(25000),headers:{Accept:'application/json'}})
    if(!response.ok)throw new Error(`TWSE HTTP ${response.status}`)
    const point=parseTsmcRevenue(await response.json(),{now})
    const points=new Map((previous?.points||[]).map(p=>[p.period,p]));points.set(point.period,point)
    return {...previous,checkedAt,error:undefined,points:[...points.values()].sort((a,b)=>a.period.localeCompare(b.period))}
  }catch(error){if(!previous)throw error;return {...previous,error:`TWSE 월매출 갱신 실패 (${checkedAt.slice(0,10)}). ${error.message}`}}
}
