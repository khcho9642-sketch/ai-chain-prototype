import { sectorEvents } from './sector-event-catalog.js';

const formatDate = date => date.replaceAll('-', '.');
const toggleKey = 'sector-compare.show-event-pins';

// The chart spaces common trading sessions evenly. A local trading date missing
// from that axis belongs between its neighbours, while the card keeps its true date.
export function eventsOnAxis(dates, events = sectorEvents) {
  if (dates.length < 2) return [];
  const last = dates.length - 1;
  return events.filter(event => event.tradingDate >= dates[0] && event.tradingDate <= dates[last])
    .map(event => {
      const day = event.tradingDate;
      const next = dates.findIndex(date => date >= day);
      if (dates[next] === day) return { event, fraction: next / last };
      const before = Date.parse(dates[next - 1]);
      const offset = (Date.parse(day) - before) / (Date.parse(dates[next]) - before);
      return { event, fraction: (next - 1 + offset) / last };
    }).sort((a, b) => a.fraction - b.fraction);
}

export function groupPins(pins, left, right) {
  const groups = [];
  for (const { event, fraction } of pins) {
    const x = left + fraction * (right - left);
    const last = groups.at(-1);
    // Keep groups anchored to their first date and separated by a full hit target.
    if (last && x - last.x < 40) {
      last.events.push(event);
    } else {
      groups.push({ x, events: [event] });
    }
  }
  return groups;
}

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function button(label, className) {
  const el = node('button', className, label);
  el.type = 'button';
  return el;
}

export function mountEventPins(host) {
  const head = node('div', 'scv-events-head');
  const heading = node('h3', '', '주요 사건');
  const count = node('span', 'scv-events-count');
  heading.append(count);
  const toggle = button('', 'scv-events-toggle');
  head.append(heading, toggle);
  const track = node('div', 'scv-pin-track');
  track.setAttribute('role', 'group');
  track.setAttribute('aria-label', '날짜별 사건 핀');
  const card = node('section', 'scv-event-card');
  card.id = 'sector-event-detail';
  card.setAttribute('aria-label', '선택한 사건 상세');
  card.hidden = true;
  host.append(track, head, card);

  let visible = true;
  try { visible = localStorage.getItem(toggleKey) !== 'off'; } catch { /* Storage is optional. */ }
  let model, sectorId, bounds, activeId;
  let pins = [];
  let groups = [];

  function renderDetail() {
    const group = groups.find(group => group.events.some(event => event.id === activeId));
    card.hidden = !visible || !group;
    card.replaceChildren();
    if (card.hidden) return;
    const event = group.events.find(event => event.id === activeId);
    if (group.events.length > 1) {
      const choices = node('div', 'scv-event-choices');
      choices.setAttribute('role', 'group');
      choices.setAttribute('aria-label', '인접한 사건 선택');
      for (const choice of group.events) {
        const item = button(formatDate(choice.tradingDate).slice(5) + ' · ' + choice.title, 'scv-event-choice');
        item.setAttribute('aria-pressed', String(choice.id === event.id));
        item.onclick = () => {
          activeId = choice.id;
          renderDetail();
          card.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
        };
        choices.append(item);
      }
      card.append(choices);
    }
    const line = node('div', 'scv-event-meta');
    const announced = node('time', '', formatDate(event.date));
    announced.dateTime = event.date;
    line.append(announced, document.createTextNode(' · ' + (event.timing || '발표')));
    const link = node('a', 'scv-event-source', event.sourceName + ' 원문 ↗');
    link.href = event.sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const labels = model.sectors.filter(row => event.sectorIds.includes(row.id)).map(row => row.name);
    const title = node('h4', '', event.title);
    const summary = node('p', 'scv-event-summary', event.summary);
    card.append(line, title, summary, link);
    if (labels.length) card.append(node('span', 'scv-event-sectors', labels.join(' · ')));
    const movesHead = node('h5', '', formatDate(event.tradingDate) + ' 거래일 · 섹터 등락률');
    const moves = node('dl', 'scv-event-moves');
    for (const row of model.eventMovesOn(event.tradingDate)) {
      const pair = node('div', 'scv-event-move');
      const name = node('dt', '', row.name);
      const dot = node('i', 'scv-dot');
      dot.style.background = row.color;
      name.prepend(dot);
      const rate = row.changePct;
      const rateText = rate == null ? '—' : (rate > 0 ? '+' : '') + rate.toFixed(2) + '%';
      const value = node('dd', rate > 0 ? 'scv-gain' : rate < 0 ? 'scv-loss' : '', rateText);
      value.append(node('small', '', row.observedCount + '/' + row.totalCount + '종목'));
      pair.append(name, value);
      moves.append(pair);
    }
    card.append(movesHead, moves, node('p', 'scv-event-note',
      '각 종목의 현지 전 거래일 종가 대비 등락률을 동일 비중으로 평균했습니다. 종목 수는 집계/등록 기준이며, 두 종가를 확인할 수 없는 종목은 제외합니다.'));
  }

  function renderTrack(focusSelected = false) {
    track.replaceChildren();
    groups = bounds ? groupPins(pins, bounds.left, bounds.right) : [];
    for (const group of groups) {
      const first = group.events[0];
      const multiple = group.events.length > 1;
      const related = group.events.some(event => event.sectorIds.includes(sectorId));
      const selected = group.events.some(event => event.id === activeId);
      const pin = button('', 'scv-event-pin');
      const label = group.events.map(event => formatDate(event.tradingDate) + ' ' + event.title).join(' / ');
      pin.style.left = group.x + 'px';
      const singleSectorId = new Set(group.events.flatMap(event => event.sectorIds));
      const colorId = related ? sectorId : singleSectorId.size === 1 ? first.sectorIds[0] : null;
      const color = model.sectors.find(row => row.id === colorId)?.color;
      pin.style.setProperty('--pin-color', color || '#becdd9');
      pin.classList.toggle('is-related', related);
      pin.title = label;
      pin.setAttribute('aria-label', label);
      pin.setAttribute('aria-controls', card.id);
      pin.setAttribute('aria-expanded', String(selected));
      const dot = node('span', 'scv-pin-dot', multiple ? group.events.length : '');
      dot.setAttribute('aria-hidden', 'true');
      pin.append(dot);
      pin.onclick = () => {
        activeId = selected ? undefined : first.id;
        renderTrack(true);
        if (selected) [...track.children].find(item => item.title === label)?.focus({ preventScroll: true });
      };
      track.append(pin);
      if (focusSelected && selected) pin.focus({ preventScroll: true });
    }
    renderDetail();
  }

  function updateControls() {
    count.textContent = pins.length ? String(pins.length) : '이 기간에 표시할 사건 없음';
    toggle.textContent = visible ? '핀 숨기기' : '핀 표시';
    toggle.hidden = !pins.length;
    toggle.setAttribute('aria-expanded', String(visible));
    track.hidden = !visible || !pins.length;
  }
  toggle.onclick = () => {
    visible = !visible;
    try { localStorage.setItem(toggleKey, visible ? 'on' : 'off'); } catch { /* Storage is optional. */ }
    activeId = undefined;
    updateControls();
    renderTrack();
  };
  return {
    update(nextModel, nextSectorId) {
      model = nextModel;
      host.hidden = !model || model.dates.length < 2;
      if (host.hidden) { activeId = undefined; bounds = null; return; }
      sectorId = nextSectorId;
      pins = eventsOnAxis(model.dates);
      if (!pins.some(pin => pin.event.id === activeId)) activeId = undefined;
      updateControls();
      renderTrack();
    },
    layout(nextBounds) {
      if (bounds?.left === nextBounds.left && bounds?.right === nextBounds.right) return;
      bounds = nextBounds;
      track.style.setProperty('--pin-left', bounds.left + 'px');
      track.style.setProperty('--pin-span', (bounds.right - bounds.left) + 'px');
      if (!host.hidden) renderTrack();
    },
  };
}
