export const EPOCH_SOURCE = Object.freeze({
  name:'Epoch AI', url:'https://epoch.ai/data', license:'CC BY 4.0',
  licenseUrl:'https://creativecommons.org/licenses/by/4.0/',
  attribution:'Source: Epoch AI, CC BY 4.0. Selected fields and Korean labels by AI CHAIN.'
})
const col=(key,label,source,type='text',unit)=>({key,label,source,type,...(unit?{unit}:{})})
export const EPOCH_DATASETS = [
  {id:'models',title:'주요 AI 모델',sourceUrl:'https://epoch.ai/data/ai-models-documentation/downloads',downloadUrl:'https://epoch.ai/data/notable_ai_models.csv',
    description:'Epoch가 선정한 주요 모델입니다. 전체 출시 모델 목록이 아니며 학습 연산량·비용에는 추정치가 포함됩니다. 비용은 2023년 USD 기준입니다.',
    columns:[col('name','모델','Model'),col('organization','개발기관','Organization'),col('date','발표일','Publication date','date'),col('parameters','파라미터','Parameters','number','개'),col('trainingCompute','학습 연산량','Training compute (FLOP)','number','FLOP'),col('trainingCost','학습 비용 추정','Training compute cost (2023 USD)','number','2023 USD'),col('confidence','원자료 신뢰도 분류','Confidence'),col('country','개발기관 국가','Country (of organization)')]},
  {id:'hardware',title:'AI 반도체 사양',sourceUrl:'https://epoch.ai/data/machine-learning-hardware',downloadUrl:'https://epoch.ai/data/ml_hardware.csv',
    description:'GPU·가속기 제원입니다. FLOP/s는 해당 수치 정밀도의 성능이고 실제 서비스 처리량과 다릅니다. 메모리는 bytes, TDP는 칩의 설계 전력입니다.',
    columns:[col('name','칩·가속기','Hardware name'),col('organization','제조사','Manufacturer'),col('date','출시일','Release date','date'),col('type','유형','Type'),col('fp8','FP8 성능','FP8 performance (FLOP/s)','number','FLOP/s'),col('memory','메모리','Memory (bytes)','number','bytes'),col('tdp','TDP','TDP (W)','number','W'),col('price','출시 가격','Release price (USD)','number','USD')]},
  {id:'data-centers',title:'AI 데이터센터',sourceUrl:'https://epoch.ai/data/ai-data-centers',downloadUrl:'https://epoch.ai/data/data_centers/data_centers.csv',
    description:'Epoch가 추적하는 대형 AI 데이터센터의 현재 상태 추정입니다. 전체 시장을 포괄하지 않습니다. H100 환산량·전력·자본비용은 추정치이며 수집일은 관측일이 아닙니다.',
    columns:[col('name','데이터센터','Name'),col('organization','소유자','Owner'),col('country','국가','Country'),col('users','사용자','Users'),col('h100','H100 환산량 추정','Current H100 equivalents','number','H100e'),col('power','IT 전력용량 추정','Current power (MW)','number','MW'),col('capitalCost','자본비용 추정','Current total capital cost (2025 USD billions)','number','십억 2025 USD'),col('chips','현재 칩','Current chip types')]},
  {id:'chip-sales',title:'AI 칩 판매 추정',sourceUrl:'https://epoch.ai/data/ai-chip-sales',downloadUrl:'https://epoch.ai/data/ai_chip_sales_timelines_by_chip.csv',
    description:'칩·기간별 판매 추정입니다. 부분 집계는 기초자료가 표시된 기간 전체를 포함하지 않는 경우입니다. 5·95백분위는 원자료의 불확실성 구간입니다. 비용은 원자료의 칩 단가×수량 추정이며 제조사 매출이 아닙니다. 출하량도 공식 확정 실적이 아닙니다.',
    columns:[col('name','기간·칩','Name'),col('organization','제조사','Chip manufacturer'),col('chip','칩','Chip type'),col('startDate','기간 시작','Start date','date'),col('endDate','기간 종료','End date','date'),col('incomplete','기간 일부만 집계','Incomplete','boolean'),col('units','판매량 추정','Number of Units','number','개'),col('unitsLow','판매량 5백분위','Number of Units (5th percentile)','number','개'),col('unitsHigh','판매량 95백분위','Number of Units (95th percentile)','number','개'),col('h100','H100 환산량 중앙값','Compute estimate in H100e (median)','number','H100e'),col('cost','칩 비용 추정','Cost Estimate (USD)','number','USD')]}
]
export const MAX_EPOCH_BYTES=3_800_000
const states=new Set(['ok','error','not-connected'])
const timestamp=v=>v===null||typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v))
export function validEpochDate(v){
  if(typeof v!=='string'||!/^\d{4}(-\d{2})?(-\d{2})?$/.test(v))return false
  const full=v.length===4?v+'-01-01':v.length===7?v+'-01':v
  const d=new Date(full+'T00:00:00Z')
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===full
}
export function emptyEpochSnapshot(){
  return {schemaVersion:1,generatedAt:null,source:{...EPOCH_SOURCE},collection:{status:'not-connected',lastAttemptAt:null,lastSuccessAt:null,message:'아직 수집하지 않았습니다.'},
    datasets:EPOCH_DATASETS.map(d=>({id:d.id,status:'not-connected',lastAttemptAt:null,lastSuccessAt:null,error:null,rawRowCount:0,rows:[]}))}
}
export function validateEpochSnapshot(data){
  if(data?.schemaVersion!==1||data.source?.url!==EPOCH_SOURCE.url||data.source?.licenseUrl!==EPOCH_SOURCE.licenseUrl||data.source?.attribution!==EPOCH_SOURCE.attribution||
    !timestamp(data.generatedAt)||!data.collection||!['ok','partial','error','not-connected'].includes(data.collection.status)||
    !timestamp(data.collection.lastAttemptAt)||!timestamp(data.collection.lastSuccessAt)||!Array.isArray(data.datasets)||data.datasets.length!==EPOCH_DATASETS.length)throw new Error('Epoch 데이터 형식이 올바르지 않습니다.')
  const ids=new Set()
  for(const d of data.datasets){
    const definition=EPOCH_DATASETS.find(x=>x.id===d.id)
    if(!definition||ids.has(d.id)||!states.has(d.status)||!timestamp(d.lastAttemptAt)||!timestamp(d.lastSuccessAt)||!Array.isArray(d.rows)||
      d.rows.length>10000||!Number.isInteger(d.rawRowCount)||d.rawRowCount!==d.rows.length||(d.status==='ok'&&(!d.rows.length||!d.lastSuccessAt))||
      (d.rows.length&&!d.lastSuccessAt))throw new Error('Epoch 데이터셋 상태를 확인하세요.')
    ids.add(d.id)
    const rowIds=new Set()
    for(const r of d.rows){
      if(!r||typeof r.id!=='string'||!r.id||rowIds.has(r.id)||typeof r.name!=='string'||!r.name)throw new Error('Epoch 행 식별자를 확인하세요.')
      rowIds.add(r.id)
      const keys=new Set(['id',...definition.columns.map(c=>c.key)])
      if(Object.keys(r).some(k=>!keys.has(k)))throw new Error('공개 허용 필드가 아닙니다.')
      for(const c of definition.columns){
        const v=r[c.key]
        if(v===null)continue
        if(c.type==='number'&&!(typeof v==='number'&&Number.isFinite(v)&&v>=0)||
          c.type==='boolean'&&typeof v!=='boolean'||
          c.type==='date'&&!validEpochDate(v)||
          c.type==='text'&&(typeof v!=='string'||v.length>4000))throw new Error('Epoch 필드 형식 오류: '+d.id+'.'+c.key)
      }
      if(r.startDate&&r.endDate&&r.startDate>r.endDate)throw new Error('판매 기간을 확인하세요.')
      if(r.unitsLow!==undefined&&r.unitsLow!==null&&r.unitsHigh!==null&&r.unitsLow>r.unitsHigh)throw new Error('판매량 불확실성 구간을 확인하세요.')
    }
  }
  if(data.collection.status==='ok'&&data.datasets.some(d=>d.status!=='ok'))throw new Error('전체 수집 성공 상태가 맞지 않습니다.')
  if(new TextEncoder().encode(JSON.stringify(data)).length>MAX_EPOCH_BYTES)throw new Error('Epoch 공개 데이터 크기 제한 초과')
  return data
}
export function epochDatasetCsv(dataset,definition=EPOCH_DATASETS.find(d=>d.id===dataset.id)){
  const cell=v=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'}
  const headers=[...definition.columns.map(c=>c.label+(c.unit?' ('+c.unit+')':'')),'출처','라이선스','마지막 수집 성공']
  return '\uFEFF'+[headers,...dataset.rows.map(r=>[...definition.columns.map(c=>r[c.key]),definition.sourceUrl,EPOCH_SOURCE.licenseUrl,dataset.lastSuccessAt])].map(r=>r.map(cell).join(',')).join('\r\n')
}
