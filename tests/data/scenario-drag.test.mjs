import test from 'node:test'
import assert from 'node:assert/strict'
import { createDragInteraction, renderDragControls, syncDragControls } from '../../assets/scenario-drag.js'
import { SCENARIO_DEFINITIONS } from '../../assets/scenario-data.js'

function drive() {
  let handle = 0, commits = 0
  const updated = [], frames = new Map()
  const range = { min: '-60', max: '60', value: '20', dataset: { scenarioRange: 'rateChangePctPoints', keyStep: '0.1' },
    getAttribute: key => ({ 'aria-valuemin': '-2', 'aria-valuemax': '3' })[key] }
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

test('the rate track has an exact neutral midpoint and sends the displayed tenths to preview and commit', () => {
  const d = drive()
  d.range.value = '30'; d.queueRange(d.range)
  d.range.value = '0'; d.queueRange(d.range)
  assert.equal(d.frames.size, 1)
  d.frame()
  assert.deepEqual(d.updated, [['rateChangePctPoints', 0]])
  d.range.value = '-1'; d.queueRange(d.range); d.frame()
  assert.equal(d.range.value, '0', 'nearby neutral input snaps its thumb even when preview is already zero')
  assert.equal(d.updated.length, 1)
  for (const [ticks, pct] of [[-2, -0.1], [-30, -1], [-60, -2], [30, 1.5], [60, 3]]) {
    d.range.value = String(ticks); d.queueRange(d.range); d.frame()
    assert.deepEqual(d.updated.at(-1), ['rateChangePctPoints', pct])
  }
  assert.equal(d.commits(), 0)
  d.range.value = '0'; d.finishRange(d.range)
  d.stop()
  assert.equal(d.frames.size, 0)
  assert.deepEqual(d.updated.at(-1), ['rateChangePctPoints', 0])
  assert.equal(d.commits(), 1)
})

test('other scenarios retain continuous values when an interrupted drag flushes', () => {
  const d = drive()
  d.range.dataset.scenarioRange = 'hbmPriceChangePct'
  d.range.value = '0.813'; d.queueRange(d.range); d.stop(); d.frame()
  assert.deepEqual(d.updated, [['hbmPriceChangePct', 0.813]])
  assert.equal(d.commits(), 1)
})

test('keyboard moves from the current value and honors both limits', () => {
  const d = drive()
  d.range.value = '2'
  const move = key => {
    let prevented = false
    assert.equal(d.adjustWithKey(d.range, { key, preventDefault() { prevented = true } }), true)
    assert.ok(prevented)
    d.frame()
    return d.updated.at(-1)[1]
  }
  assert.equal(move('ArrowLeft'), 0)
  assert.equal(move('ArrowLeft'), -0.1)
  assert.equal(move('PageUp'), 0.4)
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
    assert.equal((html.match(/step="any" value="[^"]*" data-scenario-range=/g) || []).length, mainControls.filter(c => c.id !== 'rateChangePctPoints').length)
    assert.equal((html.match(/data-tick="min"/g) || []).length, mainControls.length)
    assert.equal((html.match(/data-tick="max"/g) || []).length, mainControls.length)
    assert.doesNotMatch(html, /직접 입력|자동으로 끌어보기|충격 0으로|data-duration/)
    assert.equal(html.includes('data-tick="zero" style="--tick-pct:50%">0.0%p'), definition.id === 'interest_rate')
    if (definition.id === 'interest_rate') {
      assert.match(html, /min="-60" max="60" step="1" value="0" aria-valuemin="-2" aria-valuemax="3" aria-valuenow="0"/)
      assert.match(html, /<details class="scenario-advanced-assumptions"><summary>가정 설정<\/summary>.*?data-scenario-control="rateCapexSensitivity"/s)
    } else assert.doesNotMatch(html, /scenario-advanced-assumptions/)
  }
})

test('rate thumb, ARIA values, caption and presets all synchronize to the corresponding economic rate', () => {
  const definition = SCENARIO_DEFINITIONS[0]
  const request = { inputs: { rateChangePctPoints: 1.1 } }
  const range = { value: '0', setAttribute(k, v) { this[k] = v } }, result = {}
  const field = { style: { setProperty: (k, v) => { result[k] = v } },
    querySelector: key => ({ '[data-scenario-range]': range, '[data-drag-value]': result })[key] }
  const preset = { dataset: { controlPresetId: 'rateChangePctPoints', controlPresetValue: '0.5' }, setAttribute(k,v) { this[k] = v } }
  const root = { querySelector: key => key.includes('rateChangePctPoints') ? field : null,
    querySelectorAll: key => key === '[data-control-preset-id]' ? [preset] : [] }
  syncDragControls(root, definition, request)
  assert.equal(range.value, '22')
  assert.equal(range['aria-valuenow'], '1.1')
  assert.equal(result.textContent, '+1.1%p')
  assert.equal(preset['aria-pressed'], 'false')
  request.inputs.rateChangePctPoints = 0.5
  syncDragControls(root, definition, request)
  assert.equal(range.value, '10')
  assert.ok(Math.abs(Number.parseFloat(result['--value-pct']) - 58.3333333) < 0.00001)
  assert.equal(preset['aria-pressed'], 'true')
})
