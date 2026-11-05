const questions = {
  interest_rate: '금리가 바뀌면?',
  hyperscaler_capex: '빅테크가 투자를 늘리거나 줄이면?',
  hbm_market: 'HBM 가격과 공급량이 바뀌면?',
  gpu_dc_rent: 'GPU와 데이터센터 임대료가 바뀌면?',
  model_growth: 'AI 모델 매출이 더 빨리 늘면?',
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c])
}

const formatNumber = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 8 })
const signedValue = (value, unit) => (value > 0 ? '+' : value < 0 ? '−' : '') + formatNumber.format(Math.abs(value)) + unit
const position = (value, control) => 100 * (value - control.min) / (control.max - control.min)
const onGrid = (value, control) => Math.abs((value - control.min) / control.step - Math.round((value - control.min) / control.step)) < 1e-8

export function renderScenarioChoices(definitions, selectedId) {
  return `<div class="scenario-picker scenario-questions" role="group" aria-label="시나리오 선택">${definitions.map(definition => {
    const pressed = definition.id === selectedId
    return `<button type="button" class="scenario-choice${pressed ? ' selected' : ''}" data-scenario-id="${escapeHtml(definition.id)}" aria-pressed="${pressed}"><strong>${escapeHtml(definition.name)}</strong><span class="scenario-question">${escapeHtml(questions[definition.id] || definition.description)}</span></button>`
  }).join('')}</div>`
}

function sliderField(control, value) {
  const id = escapeHtml(control.id), label = escapeHtml(control.label), unit = escapeHtml(control.unit)
  const text = signedValue(value, unit)
  const zero = position(0, control)
  const tick = (value, name) => `<span data-tick="${name}" style="--tick-pct:${position(value, control)}%">${signedValue(value, unit)}</span>`
  const rangeId = 'scenario-range-' + id
  return `<div class="scenario-slider-field" data-drag-field="${id}" style="--zero-pct:${zero}%;--value-pct:${position(value, control)}%">
    <div class="scenario-slider-heading"><label for="${rangeId}">${label}</label><strong class="scenario-slider-value" data-drag-value>${text}</strong></div>
    <div class="scenario-range-wrap"><input class="scenario-range" id="${rangeId}" type="range" min="${control.min}" max="${control.max}" step="${onGrid(value, control) ? control.step : 'any'}" value="${value}" data-scenario-range="${id}" data-drag-step="${control.step}" aria-valuetext="${text}"></div>
    <div class="scenario-range-ticks" aria-hidden="true">${tick(control.min, 'min')}${zero > 0 && zero < 100 ? tick(0, 'zero') : ''}${tick(control.max, 'max')}</div>
    <div class="scenario-field-actions"><label class="scenario-exact"><span>직접 입력</span><span class="scenario-signed-input"><input type="number" inputmode="decimal" aria-label="${label} 직접 입력 (${unit})" min="${control.min}" max="${control.max}" step="any" value="${value}" data-scenario-control="${id}"><small>${unit}</small></span></label>
      <button type="button" class="scenario-play" data-drag-play="${id}" aria-label="${label} 자동으로 끌어보기" aria-pressed="false">자동으로 끌어보기</button></div>
  </div>`
}

function presetButtons(definition, request, presetText) {
  if (definition.id === 'interest_rate') {
    return [0.5, 1, 2].map(value => `<button type="button" data-control-preset-id="rateChangePctPoints" data-control-preset-value="${value}" aria-pressed="${request.inputs.rateChangePctPoints === value}">+${value}%p</button>`).join('')
  }
  return Object.entries(definition.presets).map(([id, preset]) => {
    const pressed = Object.entries(preset.inputs).every(([key, val]) => request.inputs[key] === val)
    const values = definition.controls.map(control => signedValue(preset.inputs[control.id], control.unit)).join(' / ')
    return `<button type="button" data-scenario-preset="${escapeHtml(id)}" aria-pressed="${pressed}" aria-label="${escapeHtml(presetText(definition, preset))}">${escapeHtml(preset.label)} <span class="scenario-preset-values">${escapeHtml(values)}</span></button>`
  }).join('')
}

export function renderDragControls(definition, request, { presetText, modelGrowthHtml = '', conclusionHtml = '' }) {
  return `<section class="scenario-panel scenario-inputs scenario-drive" aria-labelledby="scenario-input-heading">
    <div class="scenario-drive-header"><h2 id="scenario-input-heading">${escapeHtml(definition.name)}</h2><button type="button" class="scenario-reset" data-scenario-reset>충격 0으로</button></div>
    <div class="scenario-drag-fields">${definition.controls.map(control => sliderField(control, request.inputs[control.id])).join('')}</div>
    <div class="scenario-drive-options"><div class="scenario-presets" role="group" aria-label="수치 프리셋">${presetButtons(definition, request, presetText)}</div>
      <div class="scenario-duration-shortcuts"><span>지속기간</span><div role="group" aria-label="충격 지속기간">${[6, 12, 24, 36].map(months => `<button type="button" data-duration="${months}" aria-pressed="${request.durationMonths === months}">${months}개월</button>`).join('')}</div></div></div>
    ${definition.id === 'model_growth' ? `<div class="scenario-derived-input" data-model-growth-helper>${modelGrowthHtml}</div>` : ''}
    <div class="scenario-drag-conclusion" data-drag-conclusion>${conclusionHtml}</div>
  </section>`
}

export function syncDragControls(root, definition, request, activeElement) {
  for (const control of definition.controls) {
    const field = root.querySelector(`[data-drag-field="${control.id}"]`)
    if (!field) continue
    const value = request.inputs[control.id]
    const range = field.querySelector('[data-scenario-range]')
    const number = field.querySelector('[data-scenario-control]')
    const text = signedValue(value, control.unit)
    // Exact numeric entry can legitimately fall between native slider steps.
    range.step = onGrid(value, control) ? String(control.step) : 'any'
    if (Number(range.value) !== value) range.value = String(value)
    range.setAttribute('aria-valuetext', text)
    field.querySelector('[data-drag-value]').textContent = text
    field.style.setProperty('--value-pct', position(value, control) + '%')
    if (activeElement !== number || number.value.trim() && Number(number.value) === value) {
      if (activeElement !== number && number.value !== String(value)) number.value = String(value)
      if (number.hasAttribute?.('aria-invalid')) {
        number.removeAttribute('aria-invalid')
        number.setCustomValidity?.('')
      }
    }
  }
  for (const button of root.querySelectorAll('[data-control-preset-id]')) {
    const selected = request.inputs[button.dataset.controlPresetId] === Number(button.dataset.controlPresetValue)
    button.setAttribute('aria-pressed', String(selected))
  }
  for (const button of root.querySelectorAll('[data-duration]')) {
    button.setAttribute('aria-pressed', String(request.durationMonths === Number(button.dataset.duration)))
  }
  for (const button of root.querySelectorAll('[data-scenario-preset]')) {
    const preset = definition.presets[button.dataset.scenarioPreset]
    const selected = preset && Object.entries(preset.inputs).every(([key, val]) => request.inputs[key] === val)
    button.setAttribute('aria-pressed', String(Boolean(selected)))
  }
}

function quantizeRange(range) {
  const min = Number(range.min), max = Number(range.max), step = Number(range.dataset.dragStep)
  return Math.max(min, Math.min(max, Number((min + Math.round((Number(range.value) - min) / step) * step).toFixed(8))))
}

export function createDragInteraction({
  onInput, onCommit, isActive,
  requestFrame = callback => window.requestAnimationFrame(callback),
  cancelFrame = handle => window.cancelAnimationFrame(handle),
}) {
  let renderFrame = null
  let demoFrame = null
  let playback = null
  let dirty = false
  const pending = new Map()

  function emit(range, value) {
    onInput(range.dataset.scenarioRange, value, range)
    dirty = true
  }

  function flush() {
    if (renderFrame !== null) cancelFrame(renderFrame)
    renderFrame = null
    for (const [range, value] of pending) emit(range, value)
    pending.clear()
  }

  function commit() {
    if (!dirty) return
    dirty = false
    onCommit()
  }

  function stop() {
    if (demoFrame !== null) cancelFrame(demoFrame)
    demoFrame = null
    if (playback) {
      playback.button.textContent = '자동으로 끌어보기'
      playback.button.setAttribute('aria-pressed', 'false')
      playback.button.setAttribute('aria-label', playback.originalLabel)
      playback = null
    }
    flush()
    commit()
  }

  function queueRange(range) {
    if (playback) stop()
    pending.set(range, quantizeRange(range))
    if (renderFrame === null) renderFrame = requestFrame(flush)
  }

  function finishRange(range) {
    if (playback) stop()
    if (!dirty && !pending.has(range)) pending.set(range, quantizeRange(range))
    flush()
    commit()
  }

  function toggle(button) {
    const alreadyPlaying = playback?.button === button
    stop()
    if (alreadyPlaying || !isActive()) return
    const field = button.closest('[data-drag-field]')
    const range = field.querySelector('[data-scenario-range]')
    const min = Number(range.min), max = Number(range.max), step = Number(range.dataset.dragStep)
    const steps = Math.round((max - min) / step)
    const duration = Math.max(2800, 160 * steps)
    playback = { button, originalLabel: button.getAttribute('aria-label') }
    button.textContent = '멈춤'
    button.setAttribute('aria-pressed', 'true')
    button.setAttribute('aria-label', field.querySelector('label').textContent + ' 자동 재생 멈춤')
    let startTime = null, lastIndex = -1
    function advance(now) {
      demoFrame = null
      if (!isActive() || !button.isConnected) { stop(); return }
      if (startTime === null) startTime = now
      const index = Math.min(steps, Math.floor((now - startTime) / duration * steps))
      if (index !== lastIndex) {
        lastIndex = index
        emit(range, Number((min + step * index).toFixed(8)))
      }
      if (index === steps) stop()
      else demoFrame = requestFrame(advance)
    }
    demoFrame = requestFrame(advance)
  }

  return { queueRange, finishRange, stop, toggle }
}
