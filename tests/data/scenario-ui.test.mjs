import test from 'node:test'
import assert from 'node:assert/strict'

const waitFor = async (predicate, timeoutMs = 2000) => {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('scenario UI render timeout')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

test('scenario chapter renders the engine catalog as an accessible five-scenario, nine-segment decision view', async t => {
  const listeners = new Map()
  const root = {
    hidden: false,
    innerHTML: '',
    addEventListener(type, listener) { listeners.set(type, listener) },
    querySelector() { return null },
    querySelectorAll() { return [] },
  }
  const prior = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
  }
  globalThis.document = { getElementById: id => id === 'v-scenario' ? root : null, activeElement: null }
  globalThis.localStorage = { getItem: () => null, setItem: () => {} }
  globalThis.window = {
    aiChainSnapshot: null,
    addEventListener(type, listener) { listeners.set(`window:${type}`, listener) },
  }
  t.after(() => {
    if (prior.window === undefined) delete globalThis.window; else globalThis.window = prior.window
    if (prior.document === undefined) delete globalThis.document; else globalThis.document = prior.document
    if (prior.localStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = prior.localStorage
  })

  await import(`../../assets/scenario.js?scenario-ui-test=${Date.now()}`)
  await waitFor(() => root.innerHTML.includes('scenario-shell') || root.innerHTML.includes('scenario-unavailable'))
  assert.doesNotMatch(root.innerHTML, /scenario-unavailable/, 'the UI and engine export contracts must integrate')
  assert.equal((root.innerHTML.match(/class="scenario-choice/g) || []).length, 5)
  assert.equal((root.innerHTML.match(/class="scenario-segment-card/g) || []).length, 9)
  assert.doesNotMatch(root.innerHTML, /role="listitem"/, 'scenario controls retain native button semantics')
  assert.match(root.innerHTML, /가정 기반 계산 · 기준 100/)
  assert.match(root.innerHTML, /표 머리글에 표시한 고정 참조 충격/)

  const big7 = root.innerHTML.match(/<section class="scenario-panel scenario-big7"[\s\S]*?<\/section>/)?.[0] || ''
  for (const symbol of ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA']) assert.match(big7, new RegExp(`>${symbol}<`))
  assert.equal(typeof listeners.get('input'), 'function')
  assert.equal(typeof listeners.get('change'), 'function')

  const selectedCompany = () => root.innerHTML.match(/class="scenario-company-card [^"]*selected[^"]*" data-company-id="([^"]+)"/)?.[1]
  assert.equal(selectedCompany(), 'AAPL')
  listeners.get('click')({ target: {
    closest(selector) {
      if (selector === '[data-company-id]') return { dataset: { companyId: 'TSLA' } }
      if (selector === 'button.scenario-company-card[data-company-id]') return null
      return null
    },
  } })
  window.renderScenario()
  assert.equal(selectedCompany(), 'AAPL', 'clicking a company assumption input must not act like a company-card selection')
})
