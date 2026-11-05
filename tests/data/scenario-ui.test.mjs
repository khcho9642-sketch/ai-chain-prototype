import test from 'node:test'
import assert from 'node:assert/strict'

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
  assert.match(root.innerHTML, /공시 직접 \/ B · 공시 기반 추정 \/ C · 가정/)
  assert.match(root.innerHTML, /금리 \+1%p → 데이터센터 → 케펠 DC 리츠 수요·할인율에 즉시 반영/)
  assert.match(root.innerHTML, /96개월 FCFF 상세/)
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
    root.innerHTML = ''
    root.querySelector = () => null
    globalThis.localStorage = { getItem: () => JSON.stringify({ ...previous, version }), setItem: (_, value) => { stored = JSON.parse(value) } }
    await import(`../../assets/scenario.js?stored-launch=${version}-${Date.now()}`)
    await waitFor(() => root.innerHTML.includes('scenario-shell'))
    assert.equal(stored.scenarioId, 'interest_rate')
    assert.equal(stored.requests.interest_rate.companyOverrides.EQIX.assumptions.netDebtToEvPct, 12)
    assert.equal(stored.requests.hyperscaler_capex.durationMonths, 6)
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
  }
})
