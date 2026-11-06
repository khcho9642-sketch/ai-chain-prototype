import test from 'node:test'
import assert from 'node:assert/strict'
import { createDragInteraction, renderDragControls, syncDragControls } from '../../assets/scenario-drag.js'
import { SCENARIO_DEFINITIONS } from '../../assets/scenario-data.js'

function drive() {
  let handle = 0, commits = 0
  const updated = [], frames = new Map()
  const range = { min: '-2', max: '3', value: '1', dataset: { scenarioRange: 'rateChangePctPoints', keyStep: '0.25' } }
  const interaction = createDragInteraction({
    onInput(id, value) { updated.push([id, value]) },
    onCommit() { commits++ },
    requestFrame(callback) { frames.set(++handle, callback); return handle },
    cancelFrame(id) { frames.delete(id) },
  })
  return {
    ...interaction, range, updated, frames, commits: () => commits,
    frame() {
      const batch = Array.from(frames.values())
      frames.clear()
      for (const render of batch) render()
    },
  }
}

test('pointer previews cross zero without snapping and commit the exact final value', () => {
  const d = drive()
  d.range.value = '0.83'; d.queueRange(d.range)
  d.range.value = '0.02351'; d.queueRange(d.range)
  assert.equal(d.frames.size, 1)
  d.frame()
  assert.deepEqual(d.updated, [['rateChangePctPoints', 0.02351]])
  d.range.value = '-0.0189'; d.queueRange(d.range); d.frame()
  assert.deepEqual(d.updated.at(-1), ['rateChangePctPoints', -0.0189])
  assert.equal(d.commits(), 0)
  d.range.value = '-0.83123'; d.finishRange(d.range)
  d.stop()
  assert.equal(d.frames.size, 0)
  assert.deepEqual(d.updated.at(-1), ['rateChangePctPoints', -0.83123])
  assert.equal(d.commits(), 1)
})

test('interrupted drags flush the last pointer event before persistence', () => {
  const d = drive()
  d.range.value = '0.813'; d.queueRange(d.range); d.stop(); d.frame()
  assert.deepEqual(d.updated, [['rateChangePctPoints', 0.813]])
  assert.equal(d.commits(), 1)
})

test('keyboard moves from the current value and honors both limits', () => {
  const d = drive()
  d.range.value = '0.83'
  const move = key => {
    let prevented = false
    assert.equal(d.adjustWithKey(d.range, { key, preventDefault() { prevented = true } }), true)
    assert.ok(prevented)
    d.frame()
    return Number(d.range.value)
  }
  assert.equal(move('ArrowLeft'), 0.58)
  assert.equal(move('PageDown'), -0.67)
  assert.equal(move('Home'), -2)
  assert.equal(move('ArrowDown'), -2)
  assert.equal(move('End'), 3)
  assert.equal(d.adjustWithKey(d.range, { key: 'Tab' }), false)
  d.stop()
  assert.equal(d.commits(), 1)
})

test('all five scenarios expose free sliders with endpoint ticks; only rate has a folded assumption', () => {
  for (const definition of SCENARIO_DEFINITIONS) {
    const request = { inputs: Object.fromEntries(definition.controls.map(c => [c.id, c.defaultValue])) }
    const html = renderDragControls(definition, request, { presetText: () => '' })
    const mainControls = definition.controls.filter(c => c.role !== 'assumption')
    for (const c of mainControls) {
      assert.ok(html.includes(`data-scenario-range="${c.id}"`))
      assert.ok(!html.includes(`data-scenario-control="${c.id}"`))
    }
    assert.equal((html.match(/step="any" value="[^"]*" data-scenario-range=/g) || []).length, mainControls.length)
    assert.equal((html.match(/data-tick="min"/g) || []).length, mainControls.length)
    assert.equal((html.match(/data-tick="max"/g) || []).length, mainControls.length)
    assert.doesNotMatch(html, /직접 입력|자동으로 끌어보기|충격 0으로|data-tick="zero"|--zero-pct|data-duration/)
    if (definition.id === 'interest_rate') {
      assert.match(html, /<details class="scenario-advanced-assumptions"><summary>가정 설정<\/summary>.*?data-scenario-control="rateCapexSensitivity"/s)
    } else assert.doesNotMatch(html, /scenario-advanced-assumptions/)
  }
})

test('restored fractional value and preset selection sync the thumb without needing a text field', () => {
  const definition = SCENARIO_DEFINITIONS[0]
  const request = { inputs: { rateChangePctPoints: 1.13426 } }
  const range = { value: '1', setAttribute() {} }, result = {}
  const field = { style: { setProperty: (k, v) => { result[k] = v } },
    querySelector: key => ({ '[data-scenario-range]': range, '[data-drag-value]': result })[key] }
  const preset = { dataset: { controlPresetId: 'rateChangePctPoints', controlPresetValue: '0.5' }, setAttribute(k,v) { this[k] = v } }
  const root = { querySelector: key => key.includes('rateChangePctPoints') ? field : null,
    querySelectorAll: key => key === '[data-control-preset-id]' ? [preset] : [] }
  syncDragControls(root, definition, request)
  assert.equal(range.value, '1.13426')
  assert.equal(result.textContent, '+1.1%p')
  assert.equal(preset['aria-pressed'], 'false')
  request.inputs.rateChangePctPoints = 0.5
  syncDragControls(root, definition, request)
  assert.equal(range.value, '0.5')
  assert.equal(result['--value-pct'], '50%')
  assert.equal(preset['aria-pressed'], 'true')
})
