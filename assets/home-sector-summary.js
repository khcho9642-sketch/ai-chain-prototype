import { COMPANIES, SECTORS } from './home-map-core.js';
import { buildHomeSectorReturns } from './home-sector-returns.js';

const percent = value => {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.abs(value) < 0.005 ? 0 : value;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(2)}%`;
};
const date = value => value ? String(value).replaceAll('-', '.') : '—';

const compactNames = new Map([
  ['AMAT', 'AMAT'],
  ['DELL', '델'],
  ['SMCI', '슈퍼마이크로'],
  ['GOOGL', '알파벳'],
  ['META', '메타'],
]);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function mountHomeSectorSummary(container, { onSelect }) {
  container.className = 'home-sector-summary';
  container.setAttribute('aria-label', 'AI 밸류체인 업종별 수익률');
  const heading = element('div', 'sector-summary-heading');
  const title = element('h2', '', 'AI 밸류체인 업종별 수익률');
  const period = element('p', '', '최근 90일 · 대표 종목 동일가중 평균 · 카드를 누르면 아래 지도에서 보기');
  heading.append(title, period);
  const meta = element('p', 'sector-summary-meta', '수집된 종가를 확인하고 있습니다.');
  const grid = element('div', 'sector-summary-grid');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', SECTORS.length + '개 섹터 선택');
  const status = element('p', 'sector-summary-status');
  status.setAttribute('role', 'status');
  status.hidden = true;
  const details = element('details', 'sector-summary-details');
  details.append(element('summary', '', '계산 기준·구성 종목 보기'));
  const methodology = element('p', 'sector-methodology', '각 종목의 현지통화 종가 수익률을 동일 비중으로 평균합니다. 배당 재투자와 환율 변동은 제외합니다. 모든 유효 종목의 공통 거래일을 사용하며, 결측 종목은 평균에서 제외합니다. 아래 히트맵·버블은 별도의 예시 데이터입니다.');
  const members = element('div', 'sector-member-groups');
  details.append(methodology, members);
  container.append(heading, meta, grid, status, details);

  let selectedSector = 'all';
  let snapshot = null;
  let model = null;
  let loadError = '';
  const cards = SECTORS.map((sector, index) => {
    const button = element('button', 'sector-return-card');
    button.type = 'button';
    button.style.setProperty('--sector-color', sector.color);
    button.setAttribute('aria-controls', 'chart-stage');
    button.setAttribute('aria-pressed', 'false');
    button.dataset.sector = sector.id;
    const step = String(index + 1).padStart(2, '0');
    const representatives = COMPANIES.filter(company => company.sector === sector.name)
      .slice(0, 2)
      .map(company => compactNames.get(company.ticker) || company.name)
      .join(' · ');
    const identity = element('span', 'sector-return-identity');
    const name = element('span', 'sector-return-name');
    name.append(element('small', 'sector-return-step', step), document.createTextNode(sector.name));
    identity.append(name, element('span', 'sector-return-representatives', representatives));
    const value = element('strong', 'sector-return-value', '—');
    const coverage = element('small', 'sector-return-coverage', '수집값 확인 중');
    button.append(identity, value, coverage);
    button.addEventListener('click', () => {
      onSelect(selectedSector === sector.name ? 'all' : sector.name);
    });
    grid.append(button);
    return { sector, step, representatives, button, value, coverage };
  });

  function setSector(name) {
    selectedSector = name;
    cards.forEach(card => card.button.setAttribute('aria-pressed', String(card.sector.name === name)));
  }

  function render() {
    const groups = model?.groups || [];
    cards.forEach((card, index) => {
      const group = groups[index];
      const result = group?.available ? group.returnPercent : null;
      card.value.textContent = percent(result);
      card.value.className = 'sector-return-value' + (result > 0 ? ' positive' : result < 0 ? ' negative' : '');
      if (group?.available) {
        card.coverage.textContent = `${group.includedCount}/${group.peerCount}개 종목 반영`;
      } else if (group) {
        card.coverage.textContent = `유효 이력 ${group.includedCount}/${group.peerCount}개`;
      } else {
        card.coverage.textContent = loadError ? '수집값 조회 실패' : '수집값 확인 중';
      }
      card.button.setAttribute('aria-label', `${card.step} ${card.sector.name}, 대표 기업 ${card.representatives}, ${percent(result)}, ${card.coverage.textContent}, 아래 지도에서 보기`);
      card.button.title = group?.available ? '누르면 아래 지도의 섹터를 선택합니다.' : group?.unavailableReason || '수집값을 확인하고 있습니다.';
    });
    if (model) {
      const observedPeriod = model.startDate && model.endDate ? `${date(model.startDate)} ~ ${date(model.endDate)}` : '공통 비교기간 미확보';
      meta.textContent = `${observedPeriod} · ${model.metadata.source || '수집 종가'} · 수집 ${model.metadata.generatedAt ? new Date(model.metadata.generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) + ' KST' : '시각 미제공'}`;
    } else {
      meta.textContent = loadError ? '비교 가능한 수집 종가가 필요합니다.' : '수집된 종가를 확인하고 있습니다.';
    }
    const warnings = [];
    if (loadError) warnings.push(loadError);
    if (model?.metadata.stale) warnings.push('이전 수집값 포함 · 종가 기준일과 수집 시각을 확인하세요.');
    if (model && !model.metadata.commonDatesAvailable) warnings.push('공통 거래일이 부족하여 수익률을 표시할 수 없습니다.');
    if (model?.startDate && model?.endDate) {
      const observedDays = Math.round((Date.parse(model.endDate) - Date.parse(model.startDate)) / 86400000);
      if (Math.abs(observedDays - model.days) > 7) warnings.push(`실제 공통 관측기간 ${observedDays}일 · 요청 ${model.days}일`);
    }
    status.textContent = warnings.join(' ');
    status.hidden = warnings.length === 0;
    const openGroups = new Set([...members.querySelectorAll('details[open]')].map(section => section.dataset.sector));
    members.replaceChildren();
    groups.forEach(group => {
      const section = element('details', 'sector-member-group');
      section.dataset.sector = String(group.id);
      section.open = openGroups.has(section.dataset.sector);
      const coverage = group.available ? `${group.includedCount}/${group.peerCount}개 반영` : `유효 이력 ${group.includedCount}/${group.peerCount}개`;
      section.append(element('summary', '', `${group.name} · ${coverage}`));
      const list = element('ul', 'sector-member-list');
      group.peers.forEach(peer => {
        const row = element('li');
        row.append(element('span', '', `${peer.name} (${peer.symbol})`));
        row.append(element('b', '', peer.included && group.available ? percent(peer.returnPercent) : `제외 · ${peer.reason || group.unavailableReason || '공통 거래일 부족'}`));
        list.append(row);
      });
      section.append(list);
      members.append(section);
    });
    details.hidden = !model;
    setSector(selectedSector);
  }

  function receive(next) {
    if (snapshot === next) {
      loadError = '';
      render();
      return;
    }
    try {
      model = buildHomeSectorReturns(next);
      snapshot = next;
      loadError = '';
    } catch {
      loadError = '업종별 수익률을 계산할 수 없습니다. 수집값을 다시 확인해 주세요.';
    }
    render();
  }

  window.addEventListener('market-snapshot', event => receive(event.detail));
  window.addEventListener('market-snapshot-error', event => {
    loadError = String(event.detail || '시세 수집값을 읽지 못했습니다.');
    render();
  });
  render();
  if (window.aiChainSnapshot) receive(window.aiChainSnapshot);
  return { setSector };
}
