import { renderFlowChart } from './sector-compare-chart.js';
import { companyHrefForTicker } from './company-links.js';

const periods = new Map([
  [30, '1개월'], [90, '3개월'], [180, '6개월'], [365, '1년'], [730, '2년'], [1095, '3년'],
]);
const stockColors = ['#78d6fe', '#edbe76', '#c0a4ff', '#6edeb1', '#fb9dbe', '#9dafff', '#c2d46b', '#f3986f', '#6ccaaf'];
const collectedDate = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
});
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const date = value => String(value).replaceAll('-', '.');
const pct = value => value == null ? '—' : (value > 0 ? '+' : '') + value.toFixed(2) + '%';
const tone = value => value > 0 ? 'scv-gain' : value < 0 ? 'scv-loss' : '';
const swatch = color => '<i aria-hidden="true" class="scv-dot" style="background:' +
  (/^#[0-9a-f]{6}$/i.test(color) ? color : '#a7bacb') + '"></i>';

function measurements(series, dates) {
  if (!Array.isArray(series) || dates.length < 2 || series.length !== dates.length ||
      !series.every(value => Number.isFinite(value) && value > 0)) {
    return { rate: null, belowPeak: null, highDate: null };
  }
  const end = series.at(-1);
  const high = Math.max(...series);
  return {
    rate: end - 100,
    belowPeak: (end / high - 1) * 100,
    highDate: dates[series.indexOf(high)],
  };
}

function withReturns(model) {
  const sectors = model.sectors.map(sector => ({
    ...sector, ...measurements(sector.series, model.dates),
    members: sector.members.map(member => ({
      ...member, ...measurements(member.series, model.dates), sectorName: sector.name,
    })),
  }));
  return { ...model, sectors };
}

function byPerformance(a, b) {
  if (a.rate == null) return b.rate == null ? 0 : 1;
  if (b.rate == null) return -1;
  return b.rate - a.rate;
}

export function getStockRows(sectors, scope, customSymbols = []) {
  if (scope === 'all') {
    return sectors.flatMap(sector => {
      const member = sector.members.find(stock => stock.rate != null);
      return member ? [{ ...member, id: member.symbol, color: sector.color }] : [];
    });
  }
  let members;
  if (scope === 'custom') {
    const bySymbol = new Map(sectors.flatMap(sector => sector.members.map(stock => [stock.symbol, stock])));
    members = customSymbols.map(symbol => bySymbol.get(symbol)).filter(Boolean);
  } else {
    members = sectors.find(sector => sector.id === scope)?.members ?? [];
  }
  return members.map((stock, index) => ({ ...stock, id: stock.symbol, color: stockColors[index % stockColors.length] }));
}

function renderDetailTable(rows, sectorMode) {
  const maxChange = Math.max(0.01, ...rows.map(row => Math.abs(row.rate ?? 0)));
  const body = rows.map(row => {
    const status = sectorMode ? (row.reason || '집계 제외') : row.sectorName + ' · ' + (row.reason || '이력 부족');
    const width = Math.abs(row.rate) / maxChange * 100;
    const bar = row.rate == null ? '' : '<span class="scv-track"><i class="' + tone(row.rate) +
      '" style="width:' + width + '%"></i></span>';
    const href = companyHrefForTicker(row.symbol);
    const name = href ? '<a class="scv-company-link" href="' + escape(href) + '" aria-label="' +
      escape(row.name) + ' 신기업정보">' + escape(row.name) + '</a>' : escape(row.name);
    return '<tr><th scope="row">' + name + '<small>' + escape(row.symbol) +
      '</small></th><td>' + escape(row.rate == null ? status : sectorMode ? '포함' : row.sectorName) +
      '</td><td class="scv-width-cell">' + bar + '</td><td class="' + tone(row.rate) + '">' + pct(row.rate) + '</td></tr>';
  }).join('');
  return '<table class="scv-table"><thead><tr><th>종목</th><th>' + (sectorMode ? '집계 상태' : '소속 섹터') +
    '</th><th class="scv-width-cell">변동 폭</th><th>기간 등락률</th></tr></thead><tbody>' + body + '</tbody></table>';
}

export function mountSectorCompare(host, { onPeriodChange, onRetry }) {
  host.innerHTML = `<div class="scv">
    <header class="scv-intro">
      <div><h1>섹터 비교</h1><p>AI 밸류체인 9개 섹터와 구성 종목의 기간별 주가 흐름</p></div>
      <span data-field="stamp" class="scv-caption"></span>
    </header>
    <div class="scv-controls">
      <div class="scv-modes" role="group" aria-label="비교 대상">
        <button type="button" data-mode="sector">섹터별 비교</button>
        <button type="button" data-mode="stock">종목별 비교</button>
      </div>
      <div class="scv-periods" role="group" aria-label="조회 기간">${[...periods].map(([days, label]) =>
        '<button type="button" data-days="' + days + '">' + label + '</button>').join('')}</div>
    </div>
    <div data-field="status" class="scv-status" role="status" hidden></div>
    <div data-field="result" hidden>
      <section class="scv-stock-scopes" data-field="stockScopes" aria-label="종목 비교 범위" hidden>
        <div class="scv-scope-head">
          <h2>섹터 선택 <small data-field="catalogCount"></small></h2>
          <div class="scv-scope-actions">
            <button type="button" class="scv-outline" data-stock-scope="all">전체 섹터 대표 종목</button>
            <button type="button" class="scv-outline" data-action="choose">종목 직접 선택</button>
          </div>
        </div>
        <div data-field="scopeList" class="scv-scope-list" role="group" aria-label="9개 섹터"></div>
      </section>
      <div class="scv-insight" aria-live="polite"><strong>한 줄 요약</strong><span data-field="insight"></span></div>
      <div class="scv-work">
        <section class="scv-panel scv-chart">
          <div class="scv-panel-head"><div><h2 data-field="chartTitle"></h2>
            <p data-field="range" class="scv-caption"></p></div>
          </div>
          <div data-field="metric" class="scv-readout"></div>
          <div class="scv-plot" data-field="plot"></div>
          <div class="scv-chart-foot"><span>시작일 0% · 현지 통화 종가 기준</span><span>날짜 탐색 ← →</span></div>
        </section>
        <section class="scv-panel scv-rail">
          <div class="scv-panel-head"><h2 data-field="rankTitle"></h2><span data-field="rankPeriod" class="scv-caption"></span></div>
          <div class="scv-rank-labels"><span data-field="rankLabel"></span><span>기간 등락률</span><span>고점 대비</span></div>
          <div data-field="rankList"></div>
        </section>
      </div>
      <section class="scv-panel scv-detail">
        <div class="scv-panel-head"><div><h2 data-field="detailTitle"></h2><p class="scv-caption" data-field="coverage"></p></div>
          <span class="scv-counts" data-field="breadth"></span></div>
        <div data-field="detailBody"></div>
        <div class="scv-actions" data-field="actionRow"><button type="button" class="scv-outline" data-action="drill">이 섹터 종목 비교 →</button></div>
      </section>
      <details class="scv-method"><summary>계산 기준 · 데이터 출처</summary>
        <ul><li>각 종목의 첫 공통 거래일 종가를 100으로 두고 기간 등락률을 계산합니다. 차트의 0%가 시작점입니다.</li>
        <li>각 기업을 메인 시장 지도의 주력 섹터 한 곳에 포함하고, 해당 기간의 종가 이력이 충분한 종목을 동일 비중으로 평균합니다.</li>
        <li>집계 종목에 공통으로 종가가 있는 날짜를 사용합니다. 현지 통화 기준이며 환율·배당·수수료는 제외합니다.</li>
        <li>고점 대비 등락률 = (마지막 지수 ÷ 선택 기간 중 최고 지수 − 1) × 100</li>
        <li data-field="source"></li></ul><ul data-field="warnings" hidden></ul>
      </details>
    </div>
    <dialog class="scv-dialog" aria-label="비교할 종목 선택">
      <div class="scv-panel-head"><h2>비교할 종목 선택</h2><button type="button" data-action="close" class="scv-outline">닫기</button></div>
      <p class="scv-caption">9개 섹터에서 함께 볼 종목을 최대 9개 선택하세요.</p>
      <input type="search" data-field="query" aria-label="종목 검색" placeholder="종목명, 티커 또는 섹터 검색">
      <div data-field="options" class="scv-options"></div>
      <div class="scv-picker-foot"><span data-field="pickCount" aria-live="polite"></span>
      <button type="button" data-action="apply" class="scv-apply">선택 적용</button></div>
    </dialog></div>`;

  const ui = Object.fromEntries([...host.querySelectorAll('[data-field]')].map(el => [el.dataset.field, el]));
  const drawer = host.querySelector('dialog');
  const choose = host.querySelector('[data-action="choose"]');
  const apply = host.querySelector('[data-action="apply"]');
  let days = 90;
  let model = null;
  let mode = 'sector';
  let sectorId = null;
  let stockId = null;
  let stockScope = 'all';
  let customSymbols = [];
  let draft = new Set();
  let stocks = [];

  function updateControls() {
    for (const button of host.querySelectorAll('[data-days]'))
      button.setAttribute('aria-pressed', String(Number(button.dataset.days) === days));
    for (const button of host.querySelectorAll('[data-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
      button.disabled = !model;
    }
  }

  function showState(nextDays, message, retry) {
    days = nextDays;
    model = null;
    stocks = [];
    if (drawer.open) drawer.close();
    renderFlowChart(ui.plot, { dates: [], lines: [] });
    updateControls();
    ui.result.hidden = true;
    ui.stamp.textContent = '';
    ui.status.hidden = false;
    ui.status.textContent = message;
    if (retry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'scv-outline';
      button.dataset.action = 'retry';
      button.textContent = '다시 불러오기';
      ui.status.append(button);
    }
  }

  function enterStockScope(scope) {
    mode = 'stock';
    stockScope = scope;
    stockId = null;
    paint();
  }

  function focusRow(id) {
    if (mode === 'sector') sectorId = id;
    else stockId = id;
    paint();
  }

  function paint() {
    if (!model) return;
    updateControls();
    const sectorMode = mode === 'sector';
    const stockCatalog = sectorMode ? [] : getStockRows(model.sectors, stockScope, customSymbols).sort(byPerformance);
    const rows = sectorMode ? [...model.sectors].sort(byPerformance) : stockCatalog.filter(row => row.rate != null);
    const singleSector = !sectorMode && stockScope !== 'all' && stockScope !== 'custom';
    let focused = rows.find(row => row.id === (sectorMode ? sectorId : stockId));
    if (!focused && sectorMode) {
      focused = rows.filter(row => row.belowPeak != null)
        .reduce((lowest, row) => !lowest || row.belowPeak < lowest.belowPeak ? row : lowest, null);
    }
    focused ??= rows[0];
    if (focused && sectorMode) sectorId = focused.id;
    else if (focused) stockId = focused.id;
    const label = periods.get(days);
    const scopeName = stockScope === 'all' ? '섹터별 대표 종목'
      : stockScope === 'custom' ? '직접 선택한 종목' : model.sectors.find(sector => sector.id === stockScope)?.name + ' 종목';
    ui.chartTitle.textContent = sectorMode ? '섹터별 누적 등락률' : scopeName + ' 누적 등락률';
    ui.rankTitle.textContent = sectorMode ? '섹터 등락률 순위' : scopeName + ' 순위';
    ui.rankLabel.textContent = sectorMode ? '순위 · 섹터' : '순위 · 종목';
    ui.rankPeriod.textContent = label + ' 기준';
    ui.stockScopes.hidden = sectorMode;
    if (!sectorMode) {
      for (const button of ui.stockScopes.querySelectorAll('[data-stock-scope]')) {
        button.setAttribute('aria-pressed', String(button.dataset.stockScope === stockScope));
      }
      choose.setAttribute('aria-pressed', String(stockScope === 'custom'));
    }
    const { dates } = model;
    ui.range.textContent = dates.length > 1
      ? date(dates[0]) + ' — ' + date(dates.at(-1)) + ' · 공통 거래일 ' + dates.length + '일'
      : '공통 거래일 부족';
    const asOf = new Date(model.generatedAt);
    ui.stamp.textContent = model.generatedAt && Number.isFinite(asOf.getTime()) ? '자료 수집 ' + collectedDate.format(asOf) + ' KST' : '';
    ui.source.textContent = '출처 · ' + (model.source || '저장된 종가') + ' · 장기(2년·3년)는 별도로 수집한 일봉을 사용합니다.';
    const warnings = model.warnings ?? [];
    ui.warnings.hidden = !warnings.length;
    ui.warnings.innerHTML = warnings.map(warning => '<li>' + escape(warning) + '</li>').join('');
    const name = focused?.name ?? '';
    if (focused?.rate != null) {
      const highDate = dates[0].slice(0, 4) === dates.at(-1).slice(0, 4)
        ? date(focused.highDate).slice(5) : date(focused.highDate);
      const change = Math.abs(focused.belowPeak).toFixed(2);
      ui.insight.textContent = name + ' · ' + (focused.belowPeak === 0
        ? '마지막 종가가 선택 기간의 고점과 같습니다.'
        : highDate + ' 고점에서 마지막 거래일까지 ' + change + '% 하락했습니다.');
      ui.metric.innerHTML = '<span>' + swatch(focused.color) + escape(name) + '</span><strong class="' +
        tone(focused.rate) + '">' + pct(focused.rate) + '</strong><small>' + label + ' · ' +
        rows.filter(r => r.rate != null).length + (sectorMode ? '개 섹터 중 ' : '개 종목 중 ') + (rows.indexOf(focused) + 1) + '위</small>';
    } else {
      ui.insight.textContent = name ? name + ' · 선택 기간의 등락률을 계산할 종가가 부족합니다.' : '이 범위에서 선택 기간의 종가 이력이 충분한 종목이 없습니다.';
      ui.metric.textContent = name;
    }
    ui.rankList.innerHTML = rows.map((row, index) =>
      '<button type="button" class="scv-rank" data-focus="' + escape(row.id) + '" aria-pressed="' + (row === focused) + '">' +
      '<span class="scv-rank-name"><small>' + (row.rate == null ? '—' : String(index + 1).padStart(2, '0')) + '</small>' +
      swatch(row.color) + '<span>' + escape(row.name) +
      (!sectorMode && (stockScope === 'all' || stockScope === 'custom') ? '<small class="scv-stock-sector">' + escape(row.sectorName) + '</small>' : '') +
      '</span></span><b class="' + tone(row.rate) + '">' + pct(row.rate) +
      '</b><span class="scv-drawdown">' + pct(row.belowPeak) + '</span></button>').join('');
    renderFlowChart(ui.plot, {
      dates, title: ui.chartTitle.textContent, onFocus: focusRow, showPeak: true,
      lines: rows.map(row => ({ id: row.id, name: row.name, color: row.color, values: row.series, focused: row === focused })),
    });

    const detail = sectorMode ? [...(focused?.members ?? [])].sort(byPerformance) : stockCatalog;
    const eligible = detail.filter(row => row.rate != null);
    const up = eligible.filter(row => row.rate > 0).length;
    const down = eligible.filter(row => row.rate < 0).length;
    const flat = eligible.length - up - down;
    ui.detailTitle.textContent = sectorMode ? name + ' 구성 종목' : singleSector ? scopeName + ' 전체 목록' : scopeName;
    ui.coverage.textContent = sectorMode ? '계산에 포함된 종목 ' + eligible.length + '개 / 등록 ' + detail.length + '개'
      : stockScope === 'all' ? '종가 이력이 있는 ' + detail.length + '개 섹터 · 섹터별 구성 종목 순서에서 첫 번째 비교 가능 종목'
      : (singleSector ? '등록 ' : '선택 ') + detail.length + '종목 · ' + label + ' 비교 가능 ' + eligible.length + '종목';
    ui.breadth.textContent = eligible.length ? '상승 ' + up + ' · 하락 ' + down + (flat ? ' · 보합 ' + flat : '') : '집계 종목 없음';
    ui.detailBody.innerHTML = detail.length ? renderDetailTable(detail, sectorMode || singleSector) : '';
    ui.actionRow.hidden = !sectorMode || !detail.length;
  }

  function fillOptions() {
    const query = ui.query.value.trim().toLowerCase();
    const options = stocks.filter(row => [row.name, row.symbol, row.sectorName].join(' ').toLowerCase().includes(query));
    ui.options.innerHTML = options.map(row => {
      const checked = draft.has(row.symbol);
      const disabled = !checked && (row.rate == null || draft.size >= stockColors.length);
      return '<label><input type="checkbox" value="' + escape(row.symbol) + '"' + (checked ? ' checked' : '') +
        (disabled ? ' disabled' : '') + '><span>' + escape(row.name) + '<small>' + escape(row.symbol) + '</small></span><em>' +
        escape(row.rate == null ? row.reason || '이력 부족' : row.sectorName) + '</em></label>';
    }).join('') || '<p>검색 결과가 없습니다.</p>';
    ui.pickCount.textContent = draft.size + ' / ' + stockColors.length + '개 선택';
    apply.disabled = !draft.size;
  }

  function drill() {
    enterStockScope(sectorId);
    ui.scopeList.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
    host.querySelector('.scv-controls').scrollIntoView({ block: 'start' });
  }

  host.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !host.contains(button)) return;
    if (button.dataset.days) {
      const nextDays = Number(button.dataset.days);
      if (nextDays !== days) onPeriodChange(nextDays);
    } else if (button.dataset.action === 'retry') {
      onRetry(days);
    } else if (model) {
      if (button.dataset.mode === 'stock') {
        enterStockScope('all');
      } else if (button.dataset.mode === 'sector') {
        mode = 'sector';
        paint();
      } else if (button.dataset.stockScope) {
        enterStockScope(button.dataset.stockScope);
      } else if (button.dataset.focus) {
        const id = button.dataset.focus;
        focusRow(id);
        Array.from(ui.rankList.children).find(item => item.dataset.focus === id)?.focus({ preventScroll: true });
      } else if (button.dataset.action === 'drill') {
        drill();
      } else if (button.dataset.action === 'choose') {
        draft = new Set(customSymbols);
        ui.query.value = '';
        fillOptions();
        drawer.showModal();
        ui.query.focus();
      } else if (button.dataset.action === 'close') {
        drawer.close();
      } else if (button.dataset.action === 'apply') {
        customSymbols = [...draft];
        drawer.close();
        enterStockScope('custom');
      }
    }
  });
  ui.query.addEventListener('input', fillOptions);
  ui.options.addEventListener('change', event => {
    const input = event.target;
    if (!input.matches('input[type="checkbox"]')) return;
    if (input.checked) draft.add(input.value);
    else draft.delete(input.value);
    const symbol = input.value;
    fillOptions();
    Array.from(ui.options.querySelectorAll('input')).find(el => el.value === symbol)?.focus({ preventScroll: true });
  });
  window.addEventListener('hashchange', () => {
    if (drawer.open) drawer.close();
  });

  updateControls();
  return {
    showLoading(nextDays) {
      showState(nextDays, periods.get(nextDays) + ' 종가를 불러오고 있습니다.', false);
    },
    showError(nextDays, message) {
      showState(nextDays, message || '종가 데이터를 불러올 수 없습니다.', true);
    },
    showPeriod(nextModel, nextDays, { sectorId: requestedId, openStocks = false } = {}) {
      days = nextDays;
      model = withReturns(nextModel);
      stocks = model.sectors.flatMap(row => row.members);
      ui.catalogCount.textContent = model.sectors.length + '개 섹터 · 등록 ' + stocks.length + '종목';
      ui.scopeList.innerHTML = model.sectors.map((sector, index) =>
        '<button type="button" data-stock-scope="' + escape(sector.id) + '"><span class="scv-scope-count">' +
        swatch(sector.color) + String(index + 1).padStart(2, '0') + '</span><strong>' + escape(sector.name) +
        '</strong><small>' + sector.members.length + '종목</small></button>'
      ).join('');
      if (drawer.open) fillOptions();
      if (openStocks) {
        mode = 'stock';
        stockScope = 'all';
        stockId = null;
      } else if (requestedId && model.sectors.some(row => row.id === requestedId)) {
        sectorId = requestedId;
        mode = 'sector';
      }
      ui.status.hidden = true;
      ui.result.hidden = false;
      paint();
    },
    selectSector(id) {
      if (id && (!model || model.sectors.some(row => row.id === id))) {
        sectorId = id;
        mode = 'sector';
        paint();
      }
    },
  };
}
