import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8')
const router = html.match(/function route\(\)\{[\s\S]*?\n\}/)?.[0]
const routes = ['home','today','map','data','compare','industry','ai-stats','talk','ai','scenario']

function navigate(hash) {
  assert.ok(router, 'The existing hash router remains available')
  const views = new Map(routes.map(route => [`v-${route}`, { hidden: false }]))
  const note = { hidden: false }, classes = new Set(), active = new Set(), calls = []
  const context = {
    location: { hash },
    document: {
      body: { classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name) } } },
      getElementById(id) { return id === 'site-ai-note' ? note : views.get(id) },
      querySelectorAll() { return routes.map(route => ({ dataset: { r: route }, classList: { toggle(name, enabled) { if (enabled) active.add(route) } } })) },
    },
    window: { scrollTo() {}, ...Object.fromEntries(['Scenario','Today','Comparison','Industry','AiStatistics','Talk'].map(name => [`render${name}`, () => calls.push(name)])) },
    renderData() { calls.push('Data') }, renderAI() { calls.push('AI') },
  }
  runInNewContext(`${router}\nroute()`, context)
  return { visible: [...views].filter(([,view]) => !view.hidden).map(([id]) => id), active: [...active], classes, calls, note, title: context.document.title }
}

test('root and unknown hashes enter the heatmap home without showing legacy views', () => {
  for (const hash of ['', '#home', '#unknown']) {
    const result = navigate(hash)
    assert.deepEqual(result.visible, ['v-home'])
    assert.deepEqual(result.active, ['home'])
    assert.equal(result.classes.has('main-map-active'), true)
    assert.equal(result.note.hidden, true)
    assert.match(result.title, /시장 지도/)
  }
})

test('every existing direct hash still selects exactly its original view', () => {
  for (const route of routes.filter(route => route !== 'home')) {
    const result = navigate(`#${route}/NVDA`)
    assert.deepEqual(result.visible, [`v-${route}`])
    assert.deepEqual(result.active, [route])
    assert.equal(result.classes.has('main-map-active'), false)
  }
  assert.deepEqual(navigate('#today').calls, ['Today'])
  assert.deepEqual(navigate('#scenario').calls, ['Scenario'])
  assert.deepEqual(navigate('#talk/NVDA').calls, ['Talk'])
  assert.equal(navigate('#today').note.hidden, false)
})
