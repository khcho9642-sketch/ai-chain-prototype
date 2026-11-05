import test from 'node:test'
import assert from 'node:assert/strict'
import './scenario-drag.test.mjs'

const waitFor = async (predicate, timeoutMs = 3000) => {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('scenario UI render timeout')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

test('scenario chapter renders compact controls and view-model tables without input click collisions', async t => {
  const listeners = new Map()
  const root = {
    hidden: false,
    innerHTML: '',
    addEventListener(type, listener) { listeners.set(type, listener) },
    querySelector() { return null },
    querySelectorAll() { return [] },
  }
  const prior = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage }
  globalThis.document = { getElementById: id => id === 'v-scenario' ? root : null, activeElement: null }
  globalThis.localStorage = { getItem: () => null, setItem: () => {} }
  globalThis.window = { aiChainSnapshot: null, addEventListener(type, listener) { listeners.set(`window:${type}`, listener) } }
  t.after(() => {
    if (prior.window === undefined) delete globalThis.window; else globalThis.window = prior.window
    if (prior.document === undefined) delete globalThis.document; else globalThis.document = prior.document
    if (prior.localStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = prior.localStorage
  })

  await import(`../../assets/scenario.js?scenario-ui-test=${Date.now()}`)
  await waitFor(() => root.innerHTML.includes('scenario-shell') || root.innerHTML.includes('scenario-unavailable'))
  assert.doesNotMatch(root.innerHTML, /scenario-unavailable/, 'UI, engine, and view-model contracts integrate')
  assert.equal((root.innerHTML.match(/class="scenario-choice/g) || []).length, 5)
  assert.match(root.innerHTML, /value="1" data-scenario-control="rateChangePctPoints"/)
  assert.match(root.innerHTML, /data-duration="12" aria-pressed="true"/)
  for (const label of ['가장 크게 빠지는 기업 · 전체 41개', '전파 효과가 가장 큰 기업 · 전체 41개', '9개 섹터 대표기업 단순평균']) assert.match(root.innerHTML, new RegExp(label))
  assert.match(root.innerHTML, /<th>직접효과<\/th><th>밸류체인 효과<\/th><th>총 EV 변화<\/th>/)
  assert.match(root.innerHTML, /scenario-impact-bar/)
  assert.equal((root.innerHTML.match(/data-explore-sector="/g) || []).length, 9)
  assert.match(root.innerHTML, /9개 섹터에 직접 적용/)
  assert.match(root.innerHTML, /공개 재무 없음 · 섹터 가정/)
  assert.match(root.innerHTML, /data-scenario-range="rateChangePctPoints"/)
  assert.match(root.innerHTML, /공시 직접 \/ B · 공시 기반 추정 \/ C · 가정/)
  assert.match(root.innerHTML, /금리 \+1%p → 빅테크 AI CAPEX −5%/)
  const focusRow = id => root.innerHTML.split(`data-rate-target="${id}"`)[1].split('</tr>')[0]
  assert.match(focusRow('NVDA'), /서버·장비 → AI 칩 · 시차 12개월/)
  assert.match(focusRow('000660.KS'), /메모리\(HBM 포함\) · 시차 18개월/)
  const values = id => Array.from(focusRow(id).matchAll(/<td [^>]*>([^<]+)<\/td>/g), m => m[1])
  assert.deepEqual(values('NVDA'), ['−0.59%', '−0.08%', '−0.67%'])
  assert.deepEqual(values('000660.KS'), ['−0.54%', '−0.03%', '−0.57%'])
  assert.match(root.innerHTML, /96개월 현금흐름 전망/)
  assert.match(root.innerHTML, /관측·환산주가 보기/)
  assert.doesNotMatch(root.innerHTML, /scenario-quote-observation/, 'quotes are hidden until requested')

  const big7 = root.innerHTML.split('id="scenario-big7-heading"')[1]?.split('id="scenario-representative-heading"')[0] || ''
  for (const symbol of ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA']) assert.match(big7, new RegExp(`>${symbol}<`))
  assert.equal((big7.match(/data-company-row/g) || []).length, 7)
  const reps = root.innerHTML.split('id="scenario-representative-heading"')[1]?.split('scenario-other-results')[0] || ''
  assert.equal((reps.match(/data-company-row/g) || []).length, 9)

  const selected = () => root.innerHTML.match(/scenario-company-row selected" data-company-row data-company-id="([^"]+)"/)?.[1]
  const selectedBefore = selected()
  assert.ok(selectedBefore)
  listeners.get('click')({ target: { closest(selector) {
    if (selector === '[data-company-id]') return { dataset: { companyId: 'TSLA' } }
    if (selector === 'tr[data-company-row][data-company-id]') return null
    return null
  } } })
  window.renderScenario()
  assert.equal(selected(), selectedBefore, 'an assumption input cannot be mistaken for a selectable company row')

  const selectCompany = id => {
    listeners.get('click')({ target: { closest: selector => selector === 'tr[data-company-row][data-company-id]' ? { dataset: { companyId: id } } : null } })
    window.renderScenario()
  }
  const details = () => root.innerHTML.split('aria-labelledby="scenario-company-detail-heading"')[1].split('class="scenario-methodology"')[0]
  assert.match(root.innerHTML, /참여 41개사 중 <strong>38개사<\/strong>/)
  assert.match(root.innerHTML, /3개 비상장사는 섹터 가정/)
  assert.match(root.innerHTML, /현금흐름 마진은 37개사/)
  listeners.get('click')({ target: { closest: selector => selector === '[data-explore-company]' ? { dataset: { companyId: 'NVDA' } } : null } })
  window.renderScenario()
  assert.match(details(), /금리 \+1%p → 빅테크 AI CAPEX −5% →/)
  assert.doesNotMatch(details(), /감소율 \+5% →/)
  assert.match(details(), /FY2026 · 2026-01-25 결산 · 연결 · 금액 단위 USD 백만/)
  assert.match(details(), /<dt>매출<\/dt><dd>215,938<\/dd>/)
  assert.match(details(), /<dt>FCF 대용치<\/dt><dd>96,676<\/dd>/)
  assert.match(details(), /네이버페이 증권<\/a> · 2차 출처 C/)
  assert.match(details(), /Yahoo Finance<\/a> · 2차 출처 C/)
  assert.match(details(), /현금흐름 마진<\/th><td>\+44.77%<\/td><td>\+44.77%<\/td><td>실적 기반/)
  assert.match(details(), /현금흐름 할인값\(EV\) · 기준 /)
  assert.doesNotMatch(details(), /정규화 단위/)
  selectCompany('DLR')
  assert.match(details(), /<dt>CAPEX \(원천 부호\)<\/dt><dd>—<\/dd><dd>자료 없음/)
  assert.match(details(), /현금흐름 마진<\/th><td>—<\/td><td>[^<]+<\/td><td>섹터 가정 C/)
  assert.match(details(), /금액 단위 USD 백만/)
  assert.match(details(), /<th>기준 모형 현금흐름<\/th>/)
  selectCompany('TSM')
  assert.match(details(), /현금흐름 비율 계산용 매출/)
  assert.match(details(), /T-IFRS/)
  assert.match(details(), /IFRS-IASB/)
  assert.match(details(), /현금흐름 마진<\/th><td>[^<]+<\/td><td>[^<]+<\/td><td>실적 기반/)
  selectCompany('OPENAI')
  assert.match(details(), /재무 미공개 · 가정\. 시작 매출 100/)
  assert.match(root.innerHTML, /비상장 · 재무 미공개 · 가정/)
  assert.match(details(), /정규화 단위/)
  assert.doesNotMatch(details(), /금액 단위 USD|2차 출처|<dt>매출/)
  selectCompany('CRWV')
  assert.match(details(), /<dt>FCF 대용치<\/dt><dd>-7,251<\/dd>/)
  const enterAssumption = (field, value, id) => {
    const input = { dataset: { companyId: id, companyAssumption: field }, value, removeAttribute() {} }
    listeners.get('input')({ target: { closest: selector => selector === '[data-company-assumption]' ? input : null } })
    window.renderScenario()
  }
  enterAssumption('discountRatePct', '25', 'CRWV')
  enterAssumption('terminalGrowthPct', '-1', 'CRWV')
  assert.match(details(), /기준 기업가치가 0 이하라 EV 변화율/)
  const missingRow = root.innerHTML.split('data-company-row data-company-id="CRWV"')[1].split('</tr>')[0]
  assert.match(missingRow, /<b>산정 불가<\/b>/)
  assert.doesNotMatch(missingRow, /scenario-total-marker|scenario-impact-bar/)
  assert.match(root.innerHTML, /산정 가능 40\/41개사/)
  selectCompany('NVDA')
  enterAssumption('fcffMarginPct', '20', 'NVDA')
  assert.match(details(), /현금흐름 마진<\/th><td>\+44.77%<\/td><td>\+20.00%<\/td><td>사용자 가정 C/)
  enterAssumption('fcffMarginPct', '', 'NVDA')
  assert.match(details(), /현금흐름 마진<\/th><td>\+44.77%<\/td><td>\+44.77%<\/td><td>실적 기반/)
  selectCompany(selectedBefore)

  // Editing a live field must update the quote without replacing the input or waiting for blur.
  const outlet = { innerHTML: '' }
  const detail = { innerHTML: '', querySelectorAll: () => [], querySelector: selector => selector === '[data-company-quote]' ? outlet : null }
  root.querySelector = selector => selector === '[data-scenario-detail]' ? detail : null
  listeners.get('window:market-snapshot')({ detail: { quotes: [{
    symbol: selectedBefore, status: 'ok', price: 100, currency: 'USD', marketTime: 1700000000, source: 'test',
  }] } })
  listeners.get('click')({ target: { closest: selector => selector === '[data-toggle-quotes]' ? {} : null } })
  assert.match(detail.innerHTML, /환산주가 미산정/)
  const originalDetail = detail.innerHTML
  const field = {
    dataset: { companyId: selectedBefore, companyAssumption: 'netDebtToEvPct' },
    value: '33', removeAttribute() {},
  }
  listeners.get('input')({ target: { closest: selector => selector === '[data-company-assumption]' ? field : null } })
  assert.equal(detail.innerHTML, originalDetail, 'the field remains mounted during input')
  assert.match(outlet.innerHTML, /관측시가 기준 환산주가/)
  field.value = ''
  listeners.get('input')({ target: { closest: selector => selector === '[data-company-assumption]' ? field : null } })
  assert.match(outlet.innerHTML, /환산주가 미산정/)

  const previous = {
    scenarioId: 'hyperscaler_capex', showObservedQuotes: true, sortRepresentativesByAbs: true,
    requests: {
      interest_rate: { scenarioId: 'interest_rate', durationMonths: 36, inputs: { rateChangePctPoints: -2 },
        companyOverrides: { EQIX: { assumptions: { netDebtToEvPct: 12 } } } },
      hyperscaler_capex: { scenarioId: 'hyperscaler_capex', durationMonths: 6, inputs: { capexChangePct: 0 } },
    },
  }
  for (const version of [1, 2, 3]) {
    let stored
    if (version === 3) previous.requests.interest_rate.inputs.rateCapexSensitivity = 7
    root.innerHTML = ''
    root.querySelector = () => null
    globalThis.localStorage = { getItem: () => JSON.stringify({ ...previous, version }), setItem: (_, value) => { stored = JSON.parse(value) } }
    await import(`../../assets/scenario.js?stored-launch=${version}-${Date.now()}`)
    await waitFor(() => root.innerHTML.includes('scenario-shell'))
    assert.equal(stored.scenarioId, 'interest_rate')
    assert.equal(stored.requests.interest_rate.durationMonths, 12)
    assert.equal(stored.requests.interest_rate.inputs.rateChangePctPoints, 1)
    assert.equal(stored.requests.interest_rate.inputs.rateCapexSensitivity, version === 3 ? 7 : 5)
    assert.equal(stored.requests.interest_rate.companyOverrides.EQIX.assumptions.netDebtToEvPct, 12)
    assert.equal(stored.requests.hyperscaler_capex.durationMonths, 6)
    assert.equal(stored.requests.hyperscaler_capex.inputs.capexChangePct, 0, 'restore an explicitly saved neutral shock')
    assert.equal(stored.requests.gpu_dc_rent.inputs.gpuRentChangePct, 20, 'unvisited scenario starts with a visible example')
    assert.match(root.innerHTML, /data-control-preset-value="1" aria-pressed="true"/)
    assert.match(root.innerHTML, /data-duration="12" aria-pressed="true"/)
    assert.match(root.innerHTML, /data-sort-representatives aria-pressed="true"/)
    assert.match(root.innerHTML, /data-toggle-quotes aria-pressed="false"/)
    assert.match(root.innerHTML, /<th>대표기업<\/th>/)

    const buttons = [0.5, 1, 2].map(value => ({
      dataset: { controlPresetId: 'rateChangePctPoints', controlPresetValue: String(value) },
      setAttribute(key, pressed) { if (key === 'aria-pressed') this.pressed = pressed },
    }))
    root.querySelectorAll = selector => selector === '[data-control-preset-id]' ? buttons : []
    const rate = { dataset: { scenarioControl: 'rateChangePctPoints' }, value: '0', removeAttribute() {} }
    const typeRate = () => listeners.get('input')({ target: { closest: selector => selector === '[data-scenario-control]' ? rate : null } })
    typeRate()
    assert.equal(stored.requests.interest_rate.inputs.rateChangePctPoints, 0)
    assert.deepEqual(buttons.map(button => button.pressed), ['false', 'false', 'false'])
    rate.value = '2'
    typeRate()
    assert.deepEqual(buttons.map(button => button.pressed), ['false', 'false', 'true'])
    const typeSensitivity = value => {
      const input = { dataset: { scenarioControl: 'rateCapexSensitivity' }, value, removeAttribute() {} }
      listeners.get('input')({ target: { closest: selector => selector === '[data-scenario-control]' ? input : null } })
      window.renderScenario()
    }
    const click = (selector, dataset = {}) => {
      listeners.get('click')({ target: { closest: candidate => candidate === selector ? { dataset } : null } })
      window.renderScenario()
    }
    typeSensitivity('0')
    assert.deepEqual(values('NVDA').slice(1), ['0.00%', values('NVDA')[0]])
    assert.match(root.innerHTML, /CAPEX 감소율 가정 0% · 전파 꺼짐/)
    typeSensitivity('8')
    click('[data-duration]', { duration: '6' })
    assert.equal(stored.requests.interest_rate.inputs.rateCapexSensitivity, 8)
    assert.match(root.innerHTML, /금리 \+2%p → 빅테크 AI CAPEX −16%/)
    click('[data-scenario-reset]')
    assert.equal(stored.requests.interest_rate.inputs.rateCapexSensitivity, 8)
    assert.deepEqual(values('000660.KS'), ['0.00%', '0.00%', '0.00%'])
    rate.value = '-1'
    typeRate()
    window.renderScenario()
    assert.match(root.innerHTML, /금리 −1%p → 빅테크 AI CAPEX \+8%/)
    click('[data-scenario-id]', { scenarioId: 'hyperscaler_capex' })
    assert.doesNotMatch(root.innerHTML, /data-rate-target=|data-scenario-control="rateCapexSensitivity"/)
  }
})
