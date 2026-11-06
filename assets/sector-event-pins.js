import { getSectorEventCandidates } from './sector-event-candidates.js';

const formatDate = date => date.replaceAll('-', '.');
const toggleKey = 'sector-compare.show-event-pins';
const kindLabels = { high: '기간 고점', low: '기간 저점', rise: '급등', fall: '급락' };
const formatRate = rate => (rate > 0 ? '+' : '') + rate.toFixed(2) + '%';
const priority = (a, b) => b.score - a.score || a.date.localeCompare(b.date);

// Group by the first date, so a run of nearby dates cannot swallow the entire rail.
// Extrema each get a marker. Nearby hit targets sit on separate rows.
export function groupPins(pins, left, right, recentStart, activeDate) {
  const groups = [];
  const x = pin => left + pin.fraction * (right - left);
  for (const pin of pins) {
    const gap = pin.date >= recentStart ? 16 : 40;
    const last = groups.at(-1);
    if (last && x(pin) - x(last.pins[0]) < gap && !pin.mandatory && !last.pins[0].mandatory) {
      last.pins.push(pin);
    } else {
      groups.push({ pins: [pin] });
    }
  }
  const rowEnds = [];
  for (const group of groups) {
    group.pins.sort(priority);
    group.pin = group.pins.find(pin => pin.date === activeDate) ?? group.pins[0];
    group.x = x(group.pin);
    let lane = rowEnds.findIndex(end => group.x - end >= 36);
    if (lane === -1) lane = rowEnds.length;
    group.lane = lane;
    rowEnds[lane] = group.x;
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
function candidateTitle(pin, sectorName) {
  if (!pin.kinds.length) return pin.events[0].title;
  const kinds = pin.kinds.map(kind => kindLabels[kind]).join(' · ');
  const move = pin.kinds.includes('rise') || pin.kinds.includes('fall') ? ' ' + formatRate(pin.changePct) : '';
  return sectorName + ' ' + kinds + move;
}

function appendAnnouncement(card, event, sectors) {
  const section = node('div', 'scv-announcement');
  const line = node('div', 'scv-event-meta');
  const announced = node('time', '', formatDate(event.date));
  announced.dateTime = event.date;
  line.append(announced, document.createTextNode(' · ' + (event.timing || '발표')));
  if (event.tradingDate !== event.date) line.append(' · ' + formatDate(event.tradingDate).slice(5) + ' 거래분');
  const link = node('a', 'scv-event-source', event.sourceName + ' 원문 ↗');
  link.href = event.sourceUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  section.append(line, node('h4', '', event.title), node('p', 'scv-event-summary', event.summary), link);
  const labels = sectors.filter(row => event.sectorIds.includes(row.id)).map(row => row.name);
  if (labels.length) section.append(node('span', 'scv-event-sectors', labels.join(' · ')));
  card.append(section);
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
    const value = node('dd', rate > 0 ? 'scv-gain' : rate < 0 ? 'scv-loss' : '',
      rate == null ? '—' : formatRate(rate));
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
  let model, sector, bounds, activeDate, setGuides, recentStart;
  let pins = [], guides = [];

  function renderDetail(group) {
    card.hidden = !group;
    card.replaceChildren();
    if (!group) return;
    const pin = group.pin;
    if (group.pins.length > 1) {
      const choices = node('div', 'scv-event-choices');
      choices.setAttribute('role', 'group');
      choices.setAttribute('aria-label', '인접한 핀 선택');
      for (const choice of group.pins) {
        const item = button(formatDate(choice.date).slice(5) + ' · ' + candidateTitle(choice, sector.name), 'scv-event-choice');
        item.setAttribute('aria-pressed', String(choice === pin));
        item.onclick = () => {
          activeDate = choice.date;
          draw();
          card.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
        };
        choices.append(item);
      }
      card.append(choices);
    }
    if (pin.kinds.length) {
      card.append(node('div', 'scv-event-anchor', formatDate(pin.date) + ' · ' + candidateTitle(pin, sector.name)));
      if (pin.mandatory && pin.events.length) {
        card.append(node('p', 'scv-event-window', '이 날짜 전후 3거래일의 발표'));
      }
    }
    if (!pin.events.length) card.append(node('h4', '', '사건 미확인'));
    for (const event of pin.events) appendAnnouncement(card, event, model.sectors);
    appendMoves(card, model, pin.date);
  }

  function draw() {
    track.replaceChildren();
    guides = [];
    const groups = visible && bounds ? groupPins(pins, bounds.left, bounds.right, recentStart, activeDate) : [];
    let selectedGroup, lanes = 1;
    for (const group of groups) {
      const pin = group.pin;
      const selected = pin.date === activeDate;
      if (selected) selectedGroup = group;
      const high = pin.kinds.includes('high'), low = pin.kinds.includes('low');
      const mark = high && low ? '고·저' : high ? '고점' : low ? '저점' : '';
      const related = pin.related;
      const eventSectors = [...new Set(pin.events.flatMap(event => event.sectorIds))];
      const color = related ? sector.color :
        (eventSectors.length === 1 ? model.sectors.find(row => row.id === eventSectors[0])?.color : null) || '#becdd9';
      const marker = button('', 'scv-event-pin');
      const label = group.pins.map(item => formatDate(item.date) + ' ' + candidateTitle(item, sector.name)
        + (item.events.length ? '' : ' · 사건 미확인')).join(' / ');
      marker.style.left = group.x + 'px';
      marker.style.top = (group.lane * 36) + 'px';
      marker.style.setProperty('--pin-color', color);
      marker.classList.toggle('is-related', related);
      marker.title = label;
      marker.setAttribute('aria-label', label);
      marker.setAttribute('aria-controls', card.id);
      marker.setAttribute('aria-expanded', String(selected));
      const text = mark || (group.pins.length > 1 ? String(group.pins.length) : '');
      const dot = node('span', 'scv-pin-dot', text);
      dot.setAttribute('aria-hidden', 'true');
      marker.append(dot);
      marker.onclick = () => {
        activeDate = selected ? undefined : pin.date;
        draw();
        [...track.children].find(el => el.dataset.dates.split(',').includes(pin.date))?.focus({ preventScroll: true });
      };
      marker.dataset.dates = group.pins.map(item => item.date).join(',');
      track.append(marker);
      guides.push({ fraction: pin.fraction, color, selected });
      lanes = Math.max(lanes, group.lane + 1);
    }
    track.style.height = lanes * 36 + 'px';
    setGuides?.(guides);
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
    draw();
  };
  return {
    update(nextModel, nextSectorId, days) {
      setGuides = undefined;
      if (sector?.id !== nextSectorId) activeDate = undefined;
      model = nextModel;
      sector = model?.sectors.find(row => row.id === nextSectorId);
      host.hidden = !sector || model.dates.length < 2;
      if (host.hidden) { activeDate = undefined; bounds = null; guides = []; return; }
      pins = getSectorEventCandidates(model, nextSectorId, undefined, { days });
      const end = Date.parse(model.dates.at(-1));
      recentStart = days <= 90 ? model.dates[0] : new Date(end - 90 * 86400000).toISOString().slice(0, 10);
      if (!pins.some(pin => pin.date === activeDate)) activeDate = undefined;
      updateControls();
      draw();
    },
    connectGuides(setter) {
      setGuides = setter;
      setter(guides);
    },
    layout(nextBounds) {
      if (bounds?.left === nextBounds.left && bounds?.right === nextBounds.right) return;
      bounds = nextBounds;
      track.style.setProperty('--pin-left', bounds.left + 'px');
      track.style.setProperty('--pin-span', (bounds.right - bounds.left) + 'px');
      if (!host.hidden) draw();
    },
  };
}
