import test from 'node:test'
import assert from 'node:assert/strict'
import { createDragInteraction, renderDragControls, syncDragControls } from '../../assets/scenario-drag.js'
import { SCENARIO_DEFINITIONS } from '../../assets/scenario-data.js'

function drive() {
  let handle = 0, active = true, commits = 0
  const updated = [], frames = new Map()
  const range = { min: '-2', max: '3', value: '1', dataset: { scenarioRange: 'rateChangePctPoints', dragStep: '0.25' } }
  const label = { textContent: '금리 변화' }
  const button = {
    isConnected: true, textContent: '자동으로 끌어보기', attrs: { 'aria-label': '금리 변화 자동으로 끌어보기' },
    getAttribute(key) { return this.attrs[key] },
    setAttribute(key, value) { this.attrs[key] = value },
    closest() { return { querySelector: selector => selector === 'label' ? label : range } },
  }
  const interaction = createDragInteraction({
    isActive: () => active,
    onInput(id, value) { updated.push([id, value]); range.value = String(value) },
    onCommit() { commits++ },
    requestFrame(callback) { frames.set(++handle, callback); return handle },
    cancelFrame(id) { frames.delete(id) },
  })
  return {
    ...interaction, range, button, updated, frames, hide() { active = false }, commits: () => commits,
    frame(time) {
      const batch = Array.from(frames.values())
      frames.clear()
      for (const render of batch) render(time)
    },
  }
}

test('manual range input calculates once per animation frame and persists the final value on release', () => {
  const d = drive()
  d.range.value = '1.5'; d.queueRange(d.range)
  d.range.value = '2'; d.queueRange(d.range)
  assert.equal(d.frames.size, 1)
  assert.equal(d.updated.length, 0)
  d.frame(100)
  assert.deepEqual(d.updated, [['rateChangePctPoints', 2]])
  assert.equal(d.commits(), 0)
  d.range.value = '2.25'; d.queueRange(d.range); d.finishRange(d.range)
  assert.equal(d.frames.size, 0)
  assert.deepEqual(d.updated.at(-1), ['rateChangePctPoints', 2.25])
  assert.equal(d.commits(), 1)
})

test('manual control and hidden page cancel an active sweep without overwriting the last value', () => {
  const d = drive()
  assert.equal(d.frames.size, 0)
  d.toggle(d.button); d.frame(0); d.frame(640)
  assert.deepEqual(d.updated.at(-1), ['rateChangePctPoints', -1])
  d.range.value = '1.5'; d.queueRange(d.range); d.finishRange(d.range)
  assert.equal(d.button.attrs['aria-pressed'], 'false')
  d.frame(1000)
  assert.equal(d.updated.at(-1)[1], 1.5)
  assert.equal(d.commits(), 2)
  d.toggle(d.button); d.frame(2000)
  d.hide(); d.frame(2320)
  assert.equal(d.updated.at(-1)[1], -2)
  assert.equal(d.frames.size, 0)
  assert.equal(d.commits(), 3)
})

test('playback sweeps through the true limits once and stays at maximum', () => {
  const d = drive()
  d.toggle(d.button)
  d.frame(100); d.frame(1700); d.frame(3300)
  assert.deepEqual(d.updated.map(pair => pair[1]), [-2, 0.5, 3])
  assert.equal(d.button.attrs['aria-pressed'], 'false')
  assert.equal(d.frames.size, 0)
  assert.equal(d.commits(), 1)
})

test('asymmetric range ticks and exact off-grid numeric input keep their own true position', () => {
  const d = SCENARIO_DEFINITIONS[0]
  const req = { inputs: { rateChangePctPoints: 1.13 }, durationMonths: 12 }
  const html = renderDragControls(d, req, { presetText: () => '' })
  assert.match(html, /data-tick="zero" style="--tick-pct:40%"/)
  assert.match(html, /step="any" value="1.13" data-scenario-range=/)
  const range = { value: '1', setAttribute() {} }, num = { value: '1.130' }, result = {}
  const field = { style: { setProperty: (key, value) => { result[key] = value } },
    querySelector: key => ({ '[data-scenario-range]': range, '[data-scenario-control]': num, '[data-drag-value]': result })[key] }
  syncDragControls({ querySelector: () => field, querySelectorAll: () => [] }, d, req, num)
  assert.equal(range.value, '1.13')
  assert.equal(num.value, '1.130')
  assert.equal(result.textContent, '+1.13%p')
  assert.equal(Number.parseFloat(result['--value-pct']).toFixed(1), '62.6')
})

test('preset selection repairs an invalid draft and updates the actual pressed buttons', () => {
  const definition = SCENARIO_DEFINITIONS[0]
  const request = { inputs: { rateChangePctPoints: 0.5 }, durationMonths: 6 }
  const range = { value: '1', setAttribute() {} }
  const number = { value: '999', invalid: true, message: '범위',
    hasAttribute() { return this.invalid }, removeAttribute() { this.invalid = false },
    setCustomValidity(value) { this.message = value } }
  const field = { style: { setProperty() {} },
    querySelector: selector => ({ '[data-scenario-range]': range, '[data-scenario-control]': number, '[data-drag-value]': {} })[selector] }
  const button = dataset => ({ dataset, setAttribute(key, value) { this[key] = value } })
  const current = button({ controlPresetId: 'rateChangePctPoints', controlPresetValue: '0.5' })
  const previous = button({ controlPresetId: 'rateChangePctPoints', controlPresetValue: '1' })
  const period = button({ duration: '6' })
  const root = { querySelector: () => field, querySelectorAll: selector => ({
    '[data-duration]': [period], '[data-control-preset-id]': [current, previous],
  })[selector] || [] }
  syncDragControls(root, definition, request, current)
  assert.deepEqual([number.value, number.message, number.invalid], ['0.5', '', false])
  assert.deepEqual([current, previous, period].map(b => b['aria-pressed']), ['true', 'false', 'true'])
})
