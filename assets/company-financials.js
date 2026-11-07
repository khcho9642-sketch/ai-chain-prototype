import { safeSourceUrl } from './ai-statistics-core.js'

const metrics = new Map([['revenue','매출액'], ['operating_income','영업이익'], ['operating_cash_flow','영업현금흐름']])
const number = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 })
const scopes = {consolidated:'연결', continuing:'연결·계속영업', separate:'별도', unknown:'범위 미확인'}
function element(tag, text) {
  const node = document.createElement(tag)
  node.textContent = text
  return node
}

export function annualTrend(years) {
  const [latest, prior] = years || []
  if (!latest || !prior || latest.fiscalYear !== prior.fiscalYear + 1 ||
      latest.currency !== prior.currency || latest.scope !== prior.scope) return ''
  const revenue = latest.facts.revenue?.value
  const priorRevenue = prior.facts.revenue?.value
  if (!Number.isFinite(revenue) || !Number.isFinite(priorRevenue) || priorRevenue <= 0 || revenue <= 0) return ''
  const change = 100 * (revenue / priorRevenue - 1)
  let summary = `FY${latest.fiscalYear} 매출은 전년 대비 ${number.format(Math.abs(change))}% ${change < 0 ? '감소' : '증가'}했다.`
  if (!change) summary = `FY${latest.fiscalYear} 매출은 전년과 같았다.`
  const profit = latest.facts.operating_income?.value
  const priorProfit = prior.facts.operating_income?.value
  if (Number.isFinite(profit) && Number.isFinite(priorProfit)) {
    summary += ` 영업이익률은 ${number.format(100 * priorProfit / priorRevenue)}%에서 ${number.format(100 * profit / revenue)}%로 변했다.`
  }
  return summary
}

function renderSnapshot(host, company, years, asOf, note) {
  host.replaceChildren(element('h2', '연간 실적 추이'))
  if (!years?.length) {
    host.append(element('p', company.listed ? '확인된 연간 재무제표가 없습니다.' : '공개 자료로 확인된 연간 재무제표가 없습니다.'))
    return
  }
  const trend = annualTrend(years)
  if (trend) host.append(element('p', trend))
  const meta = element('p', '금액 단위 백만 · ' + (scopes[years[0].scope] || scopes.unknown) + ' 기준 · 자료 확인 ' + asOf)
  meta.className = 'ci-fin-note'
  const frame = document.createElement('div')
  frame.className = 'ci-fin-table'
  frame.tabIndex = 0
  frame.setAttribute('role','region')
  frame.setAttribute('aria-label', '연도별 재무 실적과 원문')
  const table = document.createElement('table')
  const headings = table.createTHead().insertRow()
  for (const label of ['회계연도', ...metrics.values()]) {
    const th = element('th', label)
    th.scope = 'col'
    headings.append(th)
  }
  const tbody = table.createTBody()
  for (const year of years) {
    const row = tbody.insertRow()
    const th = element('th', String(year.fiscalYear))
    th.scope = 'row'
    th.append(element('small', year.end + ' · ' + (scopes[year.scope] || scopes.unknown) + ' · ' + year.currency))
    row.append(th)
    for (const [key,label] of metrics) {
      const fact = year.facts[key]
      const cell = row.insertCell()
      const url = safeSourceUrl(fact?.url)
      if (url && Number.isFinite(fact.value)) {
        const link = element('a', number.format(fact.value / 1e6))
        link.href = url
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        link.setAttribute('aria-label', year.fiscalYear + '년 ' + label + ' ' + link.textContent + '백만 ' + year.currency + ', ' + fact.provider + ' 원문 (새 창)')
        cell.append(link, element('small', fact.provider + ' ↗'))
      } else cell.textContent = fact?.pending ? '검토 중' : '자료 미확인'
    }
  }
  frame.append(table)
  host.append(meta, frame)
  if (note) {
    const limits = element('p', note)
    limits.className = 'ci-fin-note'
    host.append(limits)
  }
}

export function mountCompanyFinancials(host, company) {
  let active = true
  host.textContent = '연간 재무 실적을 불러오고 있습니다.'
  const load = company.financialId
    ? import('./company-financial-snapshot.js').then(({yearsById, asOf}) => ({years:yearsById[company.financialId], asOf}))
    : import('./company-core-financials.js').then(({supplementalFinancials}) => supplementalFinancials(company.id))
  load.then(report => {
    if (active) renderSnapshot(host, company, report?.years, report?.asOf, report?.note)
  }).catch(() => {
    if (active) host.textContent = '연간 재무 실적을 불러오지 못했습니다. 다시 열어 주세요.'
  })
  return () => { active = false }
}
