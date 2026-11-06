const flowChartDisposers = new WeakMap();

export function renderFlowChart(container, { dates = [], lines = [], title = '주가 흐름', onFocus, onLayout, onPinGuideReady, showPeak = true } = {}) {
  flowChartDisposers.get(container)?.();
  container.replaceChildren();

  const valid = n => typeof n === 'number' && Number.isFinite(n);
  const plotted = lines.filter(line => Array.isArray(line.values) && line.values.some((n, i) => i < dates.length && valid(n)));
  if (dates.length < 2 || !plotted.length) {
    const msg = document.createElement('p');
    msg.className = 'sector-flow-chart-empty';
    msg.textContent = '이 기간에 함께 비교할 종가가 충분하지 않습니다.';
    container.append(msg);
    return () => {};
  }

  const svgNode = (name, attrs = {}, label) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (label !== undefined) node.textContent = label;
    return node;
  };
  const pct = v => (v > 0 ? '+' : '') + v.toLocaleString('ko-KR', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + '%';
  const highlight = plotted.filter(l => l.focused);
  const focused = new Set(highlight.map(l => l.id));
  const drawOrder = [...plotted.filter(l => !l.focused), ...highlight];
  const widget = document.createElement('div');
  widget.className = 'sector-flow-chart-widget';
  widget.tabIndex = 0;
  widget.setAttribute('role', 'slider');
  widget.setAttribute('aria-label', title + ' 날짜 탐색');
  widget.setAttribute('aria-valuemin', '1');
  widget.setAttribute('aria-valuemax', String(dates.length));
  const peakLine = showPeak && highlight[0];
  let peakIndex = -1;
  if (peakLine) {
    for (let index = 0; index < dates.length; index++) {
      const value = peakLine.values[index];
      if (valid(value) && (peakIndex < 0 || value > peakLine.values[peakIndex])) peakIndex = index;
    }
    const highDescription = peakLine.name + ' 기간 고점 ' + dates[peakIndex] + ', ' + pct(peakLine.values[peakIndex] - 100);
    widget.setAttribute('aria-description', highDescription);
  }
  const svg = svgNode('svg', { role: 'img', 'aria-label': title });
  const tip = document.createElement('div');
  tip.className = 'sector-flow-chart-tip';
  tip.hidden = true;
  tip.setAttribute('aria-hidden', 'true');
  widget.append(svg, tip);
  container.append(widget);

  const last = dates.length - 1;
  let cursor = last;
  let showing = false;
  let width, height, left, right, top, bottom;
  let y;
  let overlay;
  const x = i => left + i / last * (right - left);
  const pinLayer = onPinGuideReady && svgNode('g', {
    class: 'sector-flow-pin-guide', 'pointer-events': 'none', 'aria-hidden': 'true',
  });
  let pinFraction = null;

  function drawPinGuide() {
    pinLayer.replaceChildren();
    if (pinFraction === null) return;
    const index = pinFraction * last;
    const px = x(index);
    const line = highlight[0];
    const color = line?.color || '#b8c8d8';
    pinLayer.append(svgNode('line', {
      x1: px, x2: px, y1: top, y2: bottom, stroke: color,
      'stroke-width': 1, 'stroke-dasharray': '3 4', 'stroke-opacity': .85,
    }));
    if (!line) return;
    // Fractions computed from exact trading dates can pick up a rounding error.
    const rounded = Math.round(index);
    const position = Math.abs(index - rounded) <= Number.EPSILON * last * 2 ? rounded : index;
    const start = Math.floor(position);
    const a = line.values[start], b = line.values[Math.ceil(position)];
    if (!valid(a) || !valid(b)) return;
    const value = a + (b - a) * (position - start);
    pinLayer.append(svgNode('circle', {
      cx: px, cy: y(value - 100), r: 3.5, fill: color, stroke: '#101922', 'stroke-width': 1.25,
    }));
  }

  function describeCursor() {
    const rows = plotted.filter(l => valid(l.values[cursor]));
    widget.setAttribute('aria-valuenow', String(cursor + 1));
    widget.setAttribute('aria-valuetext', [dates[cursor], ...rows.map(l => l.name + ' ' + pct(l.values[cursor] - 100))].join(', '));
    overlay.replaceChildren();
    tip.hidden = !showing;
    if (!showing) return;

    const cx = x(cursor);
    overlay.append(svgNode('line', { x1: cx, x2: cx, y1: top, y2: bottom, stroke: '#a1b2bf', 'stroke-dasharray': '3 4', 'stroke-opacity': .8 }));
    for (const line of rows) overlay.append(svgNode('circle', {
      cx, cy: y(line.values[cursor] - 100), r: focused.has(line.id) ? 3.7 : 2.6,
      fill: line.color, stroke: '#101922', 'stroke-width': 1.3
    }));
    const time = document.createElement('time');
    time.dateTime = dates[cursor];
    time.textContent = dates[cursor].replaceAll('-', '. ');
    tip.replaceChildren(time);
    for (const line of [...rows].sort((a, b) => b.values[cursor] - a.values[cursor])) {
      const row = document.createElement('div');
      row.className = 'sector-flow-chart-tip-row';
      const dot = document.createElement('i');
      dot.style.backgroundColor = line.color;
      const label = document.createElement('span');
      label.textContent = line.name;
      const value = document.createElement('b');
      value.textContent = pct(line.values[cursor] - 100);
      row.append(dot, label, value);
      tip.append(row);
    }
    const roomRight = cx + 13 + tip.offsetWidth < width;
    tip.style.left = Math.max(0, Math.min(width - tip.offsetWidth, roomRight ? cx + 13 : cx - tip.offsetWidth - 13)) + 'px';
    tip.style.top = Math.max(2, Math.min(18, height - tip.offsetHeight)) + 'px';
  }

  function markPeak() {
    if (peakIndex < 0) return;
    const value = peakLine.values[peakIndex] - 100;
    const cx = x(peakIndex);
    const cy = y(value);
    const day = dates[peakIndex];
    const longPeriod = dates[0].slice(0, 4) !== dates[last].slice(0, 4);
    const dateLabel = day.slice(longPeriod ? 2 : 5).replaceAll('-', '.');
    const marker = svgNode('g', { 'class': 'sector-flow-chart-peak', 'pointer-events': 'none' });
    const label = svgNode('text', { 'text-anchor': 'middle', fill: '#f1f5fa', 'font-size': 11, 'font-weight': 650 },
      '고점 ' + dateLabel + '  ' + pct(value));
    marker.append(label);
    svg.append(marker);
    const labelWidth = Math.ceil(label.getComputedTextLength()) + 16;
    const labelHeight = 23;
    const labelX = Math.max(left, Math.min(right - labelWidth, cx - labelWidth / 2));
    const above = cy >= top + labelHeight + 11;
    const labelY = above ? cy - labelHeight - 10 : cy + 10;
    label.setAttribute('x', labelX + labelWidth / 2);
    label.setAttribute('y', labelY + 15.5);
    marker.prepend(
      svgNode('line', { x1: cx, x2: cx, y1: cy, y2: above ? labelY + labelHeight : labelY, stroke: peakLine.color }),
      svgNode('rect', { x: labelX, y: labelY, width: labelWidth, height: labelHeight, rx: 4,
        fill: '#1c2837', stroke: peakLine.color, 'stroke-opacity': .8 }),
      svgNode('circle', { cx, cy, r: 4, fill: peakLine.color, stroke: '#f4f7fb', 'stroke-width': 1.4 })
    );
  }

  const expandedStep = desired => {
    const power = 10 ** Math.floor(Math.log10(desired));
    return ([1, 2, 2.5, 5, 10].find(v => v * power >= desired) || 10) * power;
  };
  function draw() {
    width = Math.max(1, widget.getBoundingClientRect().width);
    if (width < 30) return;
    const compact = width < 540;
    height = compact ? 245 : Math.max(280, Math.min(365, width * .42));
    top = 15; bottom = height - 29; left = compact ? 39 : 49; right = width - (compact ? 12 : 21);
    onLayout?.({ left, right, width });
    const bounds = { min: 0, max: 0 };
    for (const line of plotted) {
      for (let i = 0; i <= last; i++) {
        const value = line.values[i];
        if (valid(value)) { bounds.min = Math.min(bounds.min, value - 100); bounds.max = Math.max(bounds.max, value - 100); }
      }
    }
    const span = Math.max(1, bounds.max - bounds.min);
    const step = expandedStep(span / 4.5);
    let low = Math.floor(bounds.min / step) * step;
    let high = Math.ceil(bounds.max / step) * step;
    if (low === high) { low -= step; high += step; }
    y = value => bottom - (value - low) / (high - low) * (bottom - top);
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('height', height);
    svg.replaceChildren(svgNode('title', {}, title));
    const axisStyle = { fill: '#9aaab8', 'font-size': compact ? 9 : 10, 'font-family': 'ui-monospace,monospace' };
    for (let tickIndex = 0; tickIndex <= Math.round((high - low) / step); tickIndex++) {
      const value = low + tickIndex * step;
      const zero = Math.abs(value) < step / 100;
      const py = y(value);
      svg.append(svgNode('line', { x1: left, x2: right, y1: py, y2: py, stroke: zero ? '#63727e' : '#2b3640', 'stroke-opacity': zero ? .95 : .65, 'stroke-dasharray': zero ? '5 4' : 'none' }));
      svg.append(svgNode('text', { ...axisStyle, x: left - 8, y: py + 3.5, 'text-anchor': 'end' }, (value > 0 ? '+' : '') + value.toLocaleString('ko-KR', { maximumFractionDigits: 3 }) + '%'));
    }
    const dateCount = Math.min(dates.length, compact ? 3 : 5);
    const multiYear = Number(dates[last].slice(0, 4)) - Number(dates[0].slice(0, 4)) > 0;
    for (let t = 0; t < dateCount; t++) {
      const index = Math.round(t * last / (dateCount - 1));
      const day = dates[index];
      const label = multiYear ? day.slice(2).replaceAll('-', '.') : day.slice(5).replace('-', '.');
      svg.append(svgNode('text', { ...axisStyle, x: x(index), y: bottom + 18, 'text-anchor': t === 0 ? 'start' : t === dateCount - 1 ? 'end' : 'middle' }, label));
    }
    for (const line of drawOrder) {
      let d = '';
      let continuous = false;
      for (let i = 0; i <= last; i++) {
        const value = line.values[i];
        if (!valid(value)) { continuous = false; continue; }
        d += (continuous ? 'L' : 'M') + x(i) + ' ' + y(value - 100);
        continuous = true;
      }
      const muted = focused.size && !line.focused;
      const path = svgNode('path', {
        d, fill: 'none', stroke: line.color, 'stroke-width': muted ? 1.45 : line.focused ? 2.9 : 2.1,
        'stroke-opacity': muted ? .42 : .98, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
      });
      if (onFocus) {
        path.style.cursor = 'pointer';
        path.addEventListener('click', () => onFocus(line.id));
      }
      svg.append(path);
      if (valid(line.values[last])) svg.append(svgNode('circle', { cx: x(last), cy: y(line.values[last] - 100), r: muted ? 1.8 : 3, fill: line.color, opacity: muted ? .55 : 1 }));
    }
    if (pinLayer) {
      svg.append(pinLayer);
      drawPinGuide();
    }
    markPeak();
    overlay = svgNode('g', { 'pointer-events': 'none' });
    svg.append(overlay);
    describeCursor();
  }

  function inspect(event) {
    if (!overlay) return;
    const px = event.clientX - svg.getBoundingClientRect().left;
    const index = Math.max(0, Math.min(last, Math.round((px - left) * last / (right - left))));
    if (showing && cursor === index) return;
    cursor = index;
    showing = true;
    describeCursor();
  }
  function hide() {
    showing = false;
    if (overlay) describeCursor();
  }
  widget.addEventListener('pointermove', inspect);
  widget.addEventListener('pointerdown', inspect);
  widget.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse' && document.activeElement !== widget) hide(); });
  widget.addEventListener('focus', () => { showing = true; if (overlay) describeCursor(); });
  widget.addEventListener('blur', hide);
  widget.addEventListener('keydown', event => {
    const moves = { ArrowLeft: cursor - 1, ArrowRight: cursor + 1, Home: 0, End: last };
    if (event.key === 'Escape') { hide(); return; }
    if (!(event.key in moves)) return;
    event.preventDefault();
    cursor = Math.max(0, Math.min(last, moves[event.key]));
    showing = true;
    if (overlay) describeCursor();
  });
  let lastWidth = 0;
  const observer = new ResizeObserver(entries => {
    if (!widget.isConnected) {
      dispose();
      return;
    }
    const current = entries[0].contentRect.width;
    if (Math.abs(current - lastWidth) > .1) { lastWidth = current; draw(); }
  });
  function dispose() {
    observer.disconnect();
    if (flowChartDisposers.get(container) === dispose) flowChartDisposers.delete(container);
  }
  observer.observe(widget);
  flowChartDisposers.set(container, dispose);
  draw();
  onPinGuideReady?.(guide => {
    const fraction = guide?.fraction;
    pinFraction = valid(fraction) && fraction >= 0 && fraction <= 1 ? fraction : null;
    if (pinLayer.parentNode === svg) drawPinGuide();
  });
  return dispose;
}
