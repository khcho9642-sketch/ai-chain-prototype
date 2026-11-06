import { signedValue } from './scenario-format.js'

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

const position = (value, control) => 100 * (value - control.min) / (control.max - control.min)

export function renderScenarioChoices(definitions, selectedId) {
  return `<div class="scenario-picker scenario-questions" role="group" aria-label="시나리오 선택">${definitions.map(definition => {
    const pressed = definition.id === selectedId
    return `<button type="button" class="scenario-choice${pressed ? ' selected' : ''}" data-scenario-id="${escapeHtml(definition.id)}" aria-pressed="${pressed}"><strong>${escapeHtml(definition.name)}</strong><span class="scenario-question">${escapeHtml(questions[definition.id] || definition.description)}</span></button>`
  }).join('')}</div>`
}

function sliderField(control, value, panelTitle) {
  const id = escapeHtml(control.id), label = escapeHtml(control.label), unit = escapeHtml(control.unit)
  const text = signedValue(value, unit)
  const rangeId = 'scenario-range-' + id
  return `<div class="scenario-slider-field" data-drag-field="${id}" style="--value-pct:${position(value, control)}%">
    ${control.label === panelTitle ? '' : `<div class="scenario-slider-heading"><label for="${rangeId}">${label}</label></div>`}
    <div class="scenario-range-wrap"><strong class="scenario-slider-value" data-drag-value aria-hidden="true">${text}</strong><input class="scenario-range" id="${rangeId}" type="range" ${control.label === panelTitle ? 'aria-labelledby="scenario-input-heading"' : ''} min="${control.min}" max="${control.max}" step="any" value="${value}" data-scenario-range="${id}" data-key-step="${control.step}" aria-valuetext="${text}"></div>
    <div class="scenario-range-ticks" aria-hidden="true"><span data-tick="min" style="--tick-pct:0%">${signedValue(control.min, unit)}</span><span data-tick="max" style="--tick-pct:100%">${signedValue(control.max, unit)}</span></div>
  </div>`
}

function presetButtons(definition, request, presetText) {
  if (definition.id === 'interest_rate') {
    return [0.5, 1, 2].map(value => `<button type="button" data-control-preset-id="rateChangePctPoints" data-control-preset-value="${value}" aria-pressed="${request.inputs.rateChangePctPoints === value}">${signedValue(value, '%p')}</button>`).join('')
  }
  return Object.entries(definition.presets).map(([id, preset]) => {
    const pressed = Object.entries(preset.inputs).every(([key, val]) => request.inputs[key] === val)
    const values = definition.controls.map(control => signedValue(preset.inputs[control.id], control.unit)).join(' / ')
    return `<button type="button" data-scenario-preset="${escapeHtml(id)}" aria-pressed="${pressed}" aria-label="${escapeHtml(presetText(definition, preset))}">${escapeHtml(preset.label)} <span class="scenario-preset-values">${escapeHtml(values)}</span></button>`
  }).join('')
}

export function renderDragControls(definition, request, { presetText, modelGrowthHtml = '', rateFitHtml = '' }) {
  const assumptions = definition.controls.filter(control => control.role === 'assumption')
  const inputs = definition.controls.filter(control => control.role !== 'assumption')
  return `<section class="scenario-panel scenario-inputs scenario-drive" aria-labelledby="scenario-input-heading">
    <div class="scenario-drive-header"><h2 id="scenario-input-heading">${escapeHtml(definition.name)}</h2></div>
    <div class="scenario-drag-fields">${inputs.map(control => sliderField(control, request.inputs[control.id], definition.name)).join('')}</div>
    <div class="scenario-drive-options"><div class="scenario-presets" role="group" aria-label="수치 프리셋">${presetButtons(definition, request, presetText)}</div>
    </div>
    ${assumptions.length ? `<details class="scenario-advanced-assumptions"><summary>가정 설정</summary><label class="scenario-rate-setting">금리·투자 관계<select data-rate-capex-mode>${Object.entries(definition.rateCapexModes).map(([mode, label]) => `<option value="${mode}" ${mode === request.rateCapexMode ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></label>${assumptions.map(control => `<div class="scenario-rate-setting" data-drag-field="${escapeHtml(control.id)}"><label for="scenario-${escapeHtml(control.id)}">금리 1.0%p 상승 시 빅테크 AI CAPEX 감소율</label><span class="scenario-signed-input"><input type="number" ${request.rateCapexMode !== 'manual' ? 'disabled' : ''} inputmode="decimal" id="scenario-${escapeHtml(control.id)}" min="${control.min}" max="${control.max}" step="any" value="${Number(request.inputs[control.id] ?? control.defaultValue).toFixed(1)}" data-edit-value="${request.inputs[control.id] ?? control.defaultValue}" data-scenario-control="${escapeHtml(control.id)}" aria-describedby="rate-setting-note"><small>%</small></span><small id="rate-setting-note">공통 감소율은 직접 설정 시 적용됩니다. 0.0%면 CAPEX 전파가 꺼집니다.</small></div>`).join('')}${rateFitHtml}</details>` : ''}
    ${definition.id === 'model_growth' ? `<div class="scenario-derived-input" data-model-growth-helper>${modelGrowthHtml}</div>` : ''}
  </section>`
}

export function syncDragControls(root, definition, request, activeElement) {
  for (const control of definition.controls) {
    const field = root.querySelector(`[data-drag-field="${control.id}"]`)
    if (!field) continue
    const value = request.inputs[control.id] ?? control.defaultValue
    if (control.role !== 'assumption') {
      const range = field.querySelector('[data-scenario-range]')
      const text = signedValue(value, control.unit)
      if (range !== activeElement && Number(range.value) !== value) range.value = String(value)
      range.setAttribute('aria-valuetext', text)
      field.querySelector('[data-drag-value]').textContent = text
      field.style.setProperty('--value-pct', position(value, control) + '%')
      continue
    }
    const number = field.querySelector('[data-scenario-control]')
    number.disabled = request.rateCapexMode !== 'manual'
    if (activeElement !== number || number.value.trim() && Number(number.value) === value) {
      number.dataset.editValue = String(value)
      if (activeElement !== number) number.value = Number(value).toFixed(1)
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
  for (const button of root.querySelectorAll('[data-scenario-preset]')) {
    const preset = definition.presets[button.dataset.scenarioPreset]
    const selected = preset && Object.entries(preset.inputs).every(([key, val]) => request.inputs[key] === val)
    button.setAttribute('aria-pressed', String(Boolean(selected)))
  }
}

export function createDragInteraction({
  onInput, onCommit,
  requestFrame = callback => window.requestAnimationFrame(callback),
  cancelFrame = handle => window.cancelAnimationFrame(handle),
}) {
  let renderFrame = null
  const pending = new Map()
  const applied = new Map()

  function flush() {
    if (renderFrame !== null) cancelFrame(renderFrame)
    renderFrame = null
    for (const [range, value] of pending) {
      if (applied.get(range) === value) continue
      applied.set(range, value)
      onInput(range.dataset.scenarioRange, value, range)
    }
    pending.clear()
  }

  function stop() {
    flush()
    if (applied.size) {
      applied.clear()
      onCommit()
    }
  }

  function queueRange(range) {
    pending.set(range, Number(range.value))
    if (renderFrame === null) renderFrame = requestFrame(flush)
  }

  function finishRange(range) {
    pending.set(range, Number(range.value))
    stop()
  }

  function adjustWithKey(range, event) {
    const value = Number(range.value), min = Number(range.min), max = Number(range.max)
    const step = Number(range.dataset.keyStep)
    const movements = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step, PageDown: -5 * step, PageUp: 5 * step }
    let next
    if (event.key === 'Home') next = min
    else if (event.key === 'End') next = max
    else if (Object.hasOwn(movements, event.key)) next = value + movements[event.key]
    else return false
    event.preventDefault()
    range.value = String(Math.min(max, Math.max(min, Number(next.toFixed(8)))))
    queueRange(range)
    return true
  }

  return { queueRange, finishRange, stop, adjustWithKey }
}
