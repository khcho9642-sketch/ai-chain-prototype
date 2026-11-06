import { getSectorEventCandidates } from './sector-event-candidates.js';

const formatDate = date => date.replaceAll('-', '.');
const toggleKey = 'sector-compare.show-event-pins';
const kindNames = { high: '기간 고점', low: '기간 저점', rise: '급등', fall: '급락' };
const pct = value => (value > 0 ? '+' : '') + value.toFixed(2) + '%';

// Reserve the selected date and the two extrema first. Each of the remaining
// dates joins a marker within 40 px or receives its own spot on the same row.
export function groupPins(pins, left, right, activeDate) {
  const priority = pin => pin.date === activeDate ? 2 : pin.mandatory ? 1 : 0;
  const ordered = [...pins].sort((a, b) => priority(b) - priority(a) || a.fraction - b.fraction);
  const groups = [];
  for (const pin of ordered) {
    const x = left + pin.fraction * (right - left);
    let closest;
    let gap = 40;
    for (const group of groups) {
      const distance = Math.abs(group.x - x);
      if (distance < gap) { closest = group; gap = distance; }
    }
    if (closest) closest.pins.push(pin);
    else groups.push({ x, anchor: pin, pins: [pin] });
  }
  for (const group of groups) group.pins.sort((a, b) => a.date.localeCompare(b.date));
  return groups.sort((a, b) => a.x - b.x);
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

function titleFor(pin, sector) {
  if (!pin.kinds.length) return pin.events[0].title;
  const labels = pin.kinds.map(kind => kindNames[kind]);
  if (pin.kinds.includes('rise') || pin.kinds.includes('fall')) labels.push(pct(pin.changePct));
  return sector.name + ' ' + labels.join(' · ');
}

function appendAnnouncement(card, event, sectors) {
  const line = node('div', 'scv-event-meta');
  const announced = node('time', '', formatDate(event.date));
  announced.dateTime = event.date;
  line.append(announced, document.createTextNode(' · ' + (event.timing || '발표')));
  if (event.date !== event.tradingDate) line.append(' · ' + formatDate(event.tradingDate).slice(5) + ' 거래분');
  const link = node('a', 'scv-event-source', event.sourceName + ' 원문 ↗');
  link.href = event.sourceUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  card.append(line, node('h4', '', event.title), node('p', 'scv-event-summary', event.summary), link);
  const labels = sectors.filter(row => event.sectorIds.includes(row.id)).map(row => row.name);
  if (labels.length) card.append(node('span', 'scv-event-sectors', labels.join(' · ')));
}

function appendMoves(card, model, date) {
  const moves = node('dl', 'scv-event-moves');
  for (const row of model.eventMovesOn(date)) {
    const pair = node('div', 'scv-event-move');
    const name = node('dt', '', row.name);
    const dot = node('i', 'scv-dot');
    dot.style.background = row.color;
    name.prepend(dot);
    const rate = row.changePct;
    const value = node('dd', rate > 0 ? 'scv-gain' : rate < 0 ? 'scv-loss' : '', rate == null ? '—' : pct(rate));
    value.append(node('small', '', row.observedCount + '/' + row.totalCount + '종목'));
    pair.append(name, value);
    moves.append(pair);
  }
  card.append(node('h5', '', formatDate(date) + ' 거래일 · 섹터 등락률'), moves, node('p', 'scv-event-note',
    '각 종목의 현지 전 거래일 종가 대비 등락률을 동일 비중으로 평균했습니다. 종목 수는 집계/등록 기준이며, 두 종가를 확인할 수 없는 종목은 제외합니다.'));
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
  let model, sector, bounds, activeDate, hoverDate, focusDate, setGuide;
  let pins = [];

  function syncGuide() {
    const date = hoverDate ?? focusDate ?? activeDate;
    const pin = visible && !host.hidden && pins.find(item => item.date === date);
    setGuide?.(pin || null);
  }

  function renderDetail(group) {
    card.hidden = !group;
    card.replaceChildren();
    if (!group) return;
    const selected = group.anchor;
    if (group.pins.length > 1) {
      const choices = node('div', 'scv-event-choices');
      choices.setAttribute('role', 'group');
      choices.setAttribute('aria-label', '인접한 사건 선택');
      for (const choice of group.pins) {
        const item = button(formatDate(choice.date).slice(5) + ' · ' + titleFor(choice, sector), 'scv-event-choice');
        item.setAttribute('aria-pressed', String(choice === selected));
        item.onclick = () => {
          activeDate = choice.date;
          renderTrack();
          const target = card.querySelector('[aria-pressed="true"]') ?? track.querySelector('[aria-expanded="true"]');
          target?.focus({ preventScroll: true });
        };
        choices.append(item);
      }
      card.append(choices);
    }
    if (selected.kinds.length) {
      card.append(node('div', 'scv-event-meta', formatDate(selected.date) + ' · ' + titleFor(selected, sector)));
      if (selected.mandatory && selected.events.length) {
        card.append(node('p', 'scv-event-note', '이 날짜 전후 3거래일의 ' + sector.name + ' 관련 발표'));
      }
    }
    if (!selected.events.length) card.append(node('h4', '', '사건 미확인'));
    for (const event of selected.events) appendAnnouncement(card, event, model.sectors);
    appendMoves(card, model, selected.date);
  }

  function renderTrack() {
    hoverDate = focusDate = undefined;
    track.replaceChildren();
    const groups = bounds && visible ? groupPins(pins, bounds.left, bounds.right, activeDate) : [];
    let selectedGroup;
    for (const group of groups) {
      const pin = button('', 'scv-event-pin is-related');
      const date = group.anchor.date;
      const selected = date === activeDate;
      if (selected) selectedGroup = group;
      const label = group.pins.map(item => formatDate(item.date) + ' ' + titleFor(item, sector)
        + (item.events.length ? '' : ' · 사건 미확인')).join(' / ');
      pin.style.left = group.x + 'px';
      pin.style.setProperty('--pin-color', sector.color);
      pin.dataset.date = date;
      pin.title = label;
      pin.setAttribute('aria-label', label);
      pin.setAttribute('aria-controls', card.id);
      pin.setAttribute('aria-expanded', String(selected));
      const dot = node('span', 'scv-pin-dot', group.pins.length > 1 ? group.pins.length : '');
      dot.setAttribute('aria-hidden', 'true');
      pin.append(dot);
      pin.onpointerenter = e => { if (e.pointerType !== 'touch') { hoverDate = date; syncGuide(); } };
      pin.onpointerleave = () => { hoverDate = undefined; syncGuide(); };
      pin.onfocus = () => { if (pin.matches(':focus-visible')) { focusDate = date; syncGuide(); } };
      pin.onblur = () => { focusDate = undefined; syncGuide(); };
      pin.onclick = e => {
        activeDate = selected ? undefined : date;
        renderTrack();
        const same = [...track.children].find(el => el.dataset.date === date || el.title.includes(formatDate(date)));
        if (same) {
          if (e.detail && e.pointerType !== 'touch' && same.matches(':hover')) hoverDate = same.dataset.date;
          same.focus({ preventScroll: true });
          syncGuide();
        }
      };
      track.append(pin);
    }
    syncGuide();
    renderDetail(selectedGroup);
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
    activeDate = undefined;
    updateControls();
    renderTrack();
  };
  return {
    update(nextModel, nextSectorId, days) {
      setGuide?.(null);
      setGuide = undefined;
      if (model !== nextModel || sector?.id !== nextSectorId) activeDate = undefined;
      model = nextModel;
      sector = model?.sectors.find(row => row.id === nextSectorId);
      host.hidden = !sector || model.dates.length < 2;
      if (host.hidden) { pins = []; bounds = undefined; return; }
      pins = getSectorEventCandidates(model, sector.id, undefined, { days });
      updateControls();
      renderTrack();
    },
    guideReady(setter) {
      setGuide = setter;
      syncGuide();
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
