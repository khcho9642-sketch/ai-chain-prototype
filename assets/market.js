(() => {
  'use strict'
  let snapshot = null, fetchError = '', busy = false, selected = 'TSM', period = 90, filter = 0, search = ''
  const text = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  const fmt = value => Number.isFinite(value) ? value.toLocaleString('ko-KR',{maximumFractionDigits:2}) : '—'
  const date = value => value ? new Date(value * 1000).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}) : '—'
  const pct = q => Number.isFinite(q.changePercent) ? `${q.changePercent > 0 ? '+' : ''}${q.changePercent.toFixed(2)}%` : '—'
  const color = q => q.change > 0 ? 'price-up' : q.change < 0 ? 'price-down' : ''
  const source = q => `<a href="https://finance.yahoo.com/quote/${encodeURIComponent(q.symbol)}/" target="_blank" rel="noopener noreferrer">Yahoo Finance</a>`
  const quotes = () => snapshot?.quotes || []
  const pending = () => fetchError || (busy ? '실제 시세 파일 조회 중…' : '시세를 아직 불러오지 못했습니다.')
  const note = '실제 시세 스냅샷 · 약 30분마다 수집·배포(예약 실행은 지연될 수 있음). 거래소 실시간 시세가 아니며 제공처 지연이 가능합니다. 시세 기준시각은 종목별 한국 시간입니다. 고리의 강세·보통·약세는 기존 예시 판정이며 주가로 산출하지 않습니다.'
  function status() {
    if (!snapshot) return text(pending())
    const failed = quotes().filter(q => q.status !== 'ok').length
    const old = Date.now() - Date.parse(snapshot.generatedAt) > 90 * 60000
    return `${fetchError ? `<span class="market-error">${text(fetchError)} · 이전 조회값 표시</span><br>` : ''}수집 시각: ${text(new Date(snapshot.generatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))} KST · ${quotes().length - failed}/${quotes().length}개 조회 성공${failed ? ` · ${failed}개 조회 실패/이전값` : ''}${old ? ' · <span class="market-error">수집 지연: 최신 스냅샷 확인 필요</span>' : ''}`
  }
  function mini(q) {
    return `<span class="market-quote"><button data-market-symbol="${text(q.symbol)}">${text(q.name)}</button><b class="mono ${color(q)}">${fmt(q.price)} ${text(q.currency)}</b><span class="${color(q)}">${pct(q)}</span>${q.status !== 'ok' ? '<small>조회 실패</small>' : ''}</span>`
  }
  function preview() {
    const el = document.getElementById('market-preview')
    if (el) el.innerHTML = `<div class="market-top"><h2>실제 시장 시세</h2><a href="#data">전체 종목 · 차트 보기 →</a></div><p class="market-status" role="status">${status()}</p><div class="market-strip">${quotes().filter(q => ['^KS11','^IXIC','KRW=X','NVDA'].includes(q.symbol)).map(mini).join('')}</div><p class="note">${note}</p>`
  }
  function chainQuotes() {
    document.querySelector('#detail .chain-market')?.remove()
    const el = document.getElementById('detail')
    if (!el) return
    const list = quotes().filter(q => q.chains.includes(window.sel))
    const div = document.createElement('div'); div.className = 'chain-market'
    div.innerHTML = `<b style="font-size:14px">대표 종목 실제 시세</b><div class="market-strip" style="margin-top:10px">${list.length ? list.map(mini).join('') : text(pending())}</div><p class="market-note">${list.map(q => `${text(q.name)}: ${date(q.marketTime)} KST · ${source(q)}`).join('<br>')}</p>`
    el.querySelector('.chips')?.after(div)
  }
  const oldDetail = window.renderDetail
  window.renderDetail = function() { oldDetail(); chainQuotes() }
  function chart(q) {
    const cutoff = (q.bars?.at(-1)?.time || 0) - period * 86400
    const bars = (q.bars || []).filter(b => b.time >= cutoff)
    if (!bars.length) return '<p class="market-empty">차트 데이터가 없습니다.</p>'
    const w=800,h=260,l=82,r=20,t=20,b=40
    const values=bars.map(v=>v.close),lo=Math.min(...values),hi=Math.max(...values)
    const x=i=>l+i/Math.max(1,bars.length-1)*(w-l-r), y=v=>t+(hi-v)/(hi-lo||1)*(h-t-b)
    const path=bars.map((v,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(v.close).toFixed(1)}`).join(' ')
    const label=v=>new Date(v*1000).toLocaleDateString('ko-KR',{timeZone:q.timezone,year:'2-digit',month:'numeric',day:'numeric'})
    return `<svg class="market-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${text(q.name)} 실제 종가 차트, ${period}일 범위, 통화 ${text(q.currency)}">${[0,.5,1].map(n=>{const v=lo+(hi-lo)*n;return `<line x1="${l}" x2="${w-r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${l-8}" y="${y(v)+4}" text-anchor="end">${fmt(v)}</text>`}).join('')}<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2"/><text x="${l}" y="${h-10}">${label(bars[0].time)}</text><text x="${w-r}" y="${h-10}" text-anchor="end">${label(bars.at(-1).time)}</text></svg><p class="market-note">일봉 종가 · ${text(q.currency)} · 차트 날짜는 ${text(q.timezone)} 기준 · ${bars.length}개 관측값</p>`
  }
  function result() {
    const rows = quotes().filter(q => (!filter || q.chains.includes(filter)) && `${q.name} ${q.symbol}`.toLowerCase().includes(search.toLowerCase()))
    const q = quotes().find(q=>q.symbol===selected)
    return `<p class="market-status" role="status">${status()}</p><div class="market-scroll"><table class="tbl market-table"><thead><tr><th>종목</th><th>실제 가격</th><th>전일 대비</th><th>거래량</th><th>시세 기준·출처</th></tr></thead><tbody>${rows.map(q=>`<tr><td><button class="market-pick" data-market-symbol="${text(q.symbol)}"><b>${text(q.name)}</b><small>${text(q.symbol)} · ${text(q.exchange)}</small></button></td><td class="mono">${fmt(q.price)} <small>${text(q.currency)}</small></td><td class="mono ${color(q)}">${pct(q)}<small style="display:block">${fmt(q.change)}</small></td><td class="mono">${fmt(q.volume)}</td><td class="market-time">${date(q.marketTime)} KST<br>${source(q)}${q.status!=='ok'?`<br><span class="market-error">${text(q.error || '조회 실패')} · ${q.status==='stale'?'이전값':'값 없음'}</span>`:''}</td></tr>`).join('') || '<tr><td colspan="5" class="market-empty">검색 결과 또는 조회 가능한 데이터가 없습니다.</td></tr>'}</tbody></table></div>${q ? `<div class="market-detail"><div class="market-top"><h3>${text(q.name)} · ${text(q.symbol)}</h3><b class="mono ${color(q)}">${fmt(q.price)} ${text(q.currency)} (${pct(q)})</b></div><div class="market-ranges">${[[30,'1개월'],[90,'3개월'],[180,'6개월'],[366,'1년']].map(([days,label])=>`<button class="f${period===days?' on':''}" data-market-range="${days}" aria-pressed="${period===days}">${label}</button>`).join('')}<button class="f" data-market-csv>OHLCV CSV 저장</button></div>${chart(q)}<dl class="market-facts">${[['전일 종가',q.previousClose],['당일 고가',q.high],['당일 저가',q.low],['거래량',q.volume],['52주 고가',q.yearHigh],['52주 저가',q.yearLow]].map(([key,value])=>`<div><dt>${key}</dt><dd>${fmt(value)}</dd></div>`).join('')}</dl><p class="market-note">시세 기준: ${date(q.marketTime)} KST · 개별 조회: ${text(q.fetchedAt ? new Date(q.fetchedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}) : '—')} KST<br>${source(q)} · ${text(q.currency)} · 빈 값은 미제공 데이터입니다.${q.status!=='ok'?' · 조회에 실패하여 최신값이 아닐 수 있습니다.':''}</p></div>` : ''}`
  }
  function mount() {
    const parent=document.getElementById('v-data')
    if (!parent || parent.hidden) return
    document.getElementById('market-data')?.remove()
    const el=document.createElement('section'); el.id='market-data'; el.className='panel sec market-section'
    el.innerHTML=`<div class="market-top"><h2>대표 종목 실제 시세</h2><button class="f" data-market-refresh>최신 배포값 다시 읽기</button></div><p class="note">${note}</p><div class="market-controls"><input id="market-search" aria-label="실제 시세 종목 검색" placeholder="종목명 또는 티커 검색" value="${text(search)}"><select id="market-filter" aria-label="시세 고리 선택"><option value="0">전체 · 시장지표 포함</option>${window.S.map(s=>`<option value="${s.id}"${filter===s.id?' selected':''}>${text(s.name)}</option>`).join('')}</select></div><div id="market-results">${result()}</div>`
    parent.prepend(el)
  }
  const oldData=window.renderData
  window.renderData=function(){oldData();mount()}
  function update() { preview(); chainQuotes(); const el=document.getElementById('market-results'); if(el)el.innerHTML=result() }
  async function load() {
    if(busy)return
    busy=true; update()
    try {
      const r=await fetch(`./data/market.json?t=${Date.now()}`,{cache:'no-store',signal:AbortSignal.timeout(20000)})
      if(!r.ok)throw new Error(`시세 파일 HTTP ${r.status}`)
      const body=await r.json()
      if(body.schemaVersion!==1 || !Array.isArray(body.quotes))throw new Error('시세 데이터 형식 오류')
      snapshot=body;fetchError=''
    }catch(error){fetchError=`시세 파일 조회 실패: ${error.message}`}
    finally{busy=false;update()}
  }
  function csv() {
    const q=quotes().find(q=>q.symbol===selected); if(!q)return
    const cutoff=(q.bars?.at(-1)?.time||0)-period*86400
    const rows=[['time_utc','open','high','low','close','volume'],...(q.bars||[]).filter(b=>b.time>=cutoff).map(b=>[new Date(b.time*1000).toISOString(),b.open,b.high,b.low,b.close,b.volume])]
    const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.join(',')).join('\n')],{type:'text/csv;charset=utf-8'}))
    const a=document.createElement('a');a.href=url;a.download=`${q.symbol}-${period}d.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  document.addEventListener('click',e=>{
    const s=e.target.closest('[data-market-symbol]'); if(s){selected=s.dataset.marketSymbol;if(location.hash!=='#data')location.hash='data';else update();return}
    const r=e.target.closest('[data-market-range]');if(r){period=Number(r.dataset.marketRange);update();return}
    if(e.target.closest('[data-market-refresh]'))load()
    if(e.target.closest('[data-market-csv]'))csv()
  })
  document.addEventListener('input',e=>{if(e.target.id==='market-search'){search=e.target.value;document.getElementById('market-results').innerHTML=result()}})
  document.addEventListener('change',e=>{if(e.target.id==='market-filter'){filter=Number(e.target.value);update()}})
  mount();load();setInterval(load,60000)
})()
