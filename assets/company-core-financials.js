// Comparative fiscal years transcribed from each issuer’s latest annual filing
// available at review. Original amounts below are expressed in millions.
export const supplementAsOf = '2026-11-07'

const annuals = {
  C0473: {
    issuer: 'Tokyo Electron IR', currency: 'JPY',
    url: 'https://www.tel.com/ir/library/report/pjuomj00000000tf-att/fy26q4tanshin-e.pdf',
    years: [['2026-03-31', 2443533, 624936, 539732], ['2025-03-31', 2431568, 697319, 582174]],
  },
  C0427: {
    issuer: 'HKEX', currency: 'USD',
    url: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2026/0408/2026040801181.pdf',
    years: [['2025-12-31', 9326.799, 1109.937, 3194.303], ['2024-12-31', 8029.921, 473.900, 3175.555]],
  },
  C0395: {
    issuer: 'SEC', currency: 'USD',
    url: 'https://www.sec.gov/Archives/edgar/data/2023554/000162828026057406/sndk-20260703.htm',
    note: 'FY2026은 53주이며, 분사 이전 비교기간은 연차보고서의 결합재무제표 기준을 따른다.',
    years: [['2026-07-03', 20248, 12389, 11671], ['2025-06-27', 7355, -1377, 84], ['2024-06-28', 6663, -468, -309]],
  },
  C0047: {
    issuer: 'SEC', currency: 'USD',
    url: 'https://www.sec.gov/Archives/edgar/data/1973239/000197323926000097/arm-20260331.htm',
    years: [['2026-03-31', 4920, 900, 1524], ['2025-03-31', 4007, 831, 397], ['2024-03-31', 3233, 111, 1090]],
  },
  C0104: {
    issuer: 'SEC', currency: 'USD',
    url: 'https://www.sec.gov/Archives/edgar/data/858877/000085887726000132/csco-20260725.htm',
    years: [['2026-07-25', 63325, 15368, 14177], ['2025-07-26', 56654, 11760, 14193]],
  },
  C0212: {
    issuer: 'Hon Hai IR', currency: 'TWD',
    url: 'https://image.honhai.com/upload/202603/law_talk/Hon_Hai_4Q25_Results_English_20260316_0435.pdf',
    years: [['2025-12-31', 8103105, 259223, 226852], ['2024-12-31', 6859615, 200607, 166029]],
  },
  C0416: {
    issuer: 'Siemens Energy IR', currency: 'EUR',
    url: 'https://assets.siemens-energy.com/dam/32b27e9a-af91-4915-8b51-b3af012d0d98/A-Siemens_Energy_Annual_Report_2025-pdf_Original%20file.pdf',
    years: [['2025-09-30', 39077, 2149, 5821], ['2024-09-30', 34465, 2125, 2889]],
  },
  C0182: {
    issuer: 'SEC', currency: 'CNY', scope: 'continuing',
    url: 'https://www.sec.gov/Archives/edgar/data/1526125/000110465926051006/gds-20251231x20f.htm',
    note: '해외 데이터센터 사업의 중단영업을 제외한 계속영업 비교 수치다.',
    years: [['2025-12-31', 11432.274, -55.750, 3365.254], ['2024-12-31', 10322.068, 1151.993, 2219.662], ['2023-12-31', 9782.448, -2207.221, 2359.276]],
  },
  C0022: {
    issuer: 'Alibaba IR · 20-F', currency: 'CNY',
    url: 'https://data.alibabagroup.com/ir_filings/SEC/BABA/000119312526231755/baba-20260331.htm',
    years: [['2026-03-31', 1023670, 50150, 76213], ['2025-03-31', 996347, 140905, 163509]],
  },
  C0330: {
    issuer: 'SEC', currency: 'USD', scope: 'continuing',
    url: 'https://www.sec.gov/Archives/edgar/data/1513845/000110465926052948/nbis-20251231x20f.htm',
    note: '매각·중단영업을 제외했다. 이전 발표와 비교할 때는 이 연차보고서에서 재표시한 계속영업 기준을 사용한다.',
    years: [['2025-12-31', 529.8, -611.7, 401.9], ['2024-12-31', 91.5, -399.6, -269.9]],
  },
}

export function supplementalFinancials(id) {
  const entry = annuals[id]
  if (!entry) return null
  const fact = value => ({ value: Math.round(value * 1e6), url: entry.url, provider: entry.issuer })
  const years = entry.years.map(([end, revenue, operatingIncome, operatingCash]) => ({
    end, fiscalYear: Number(end.slice(0, 4)), scope: entry.scope || 'consolidated', currency: entry.currency,
    facts: { revenue: fact(revenue), operating_income: fact(operatingIncome), operating_cash_flow: fact(operatingCash) },
  }))
  return { years, asOf: supplementAsOf, note: entry.note }
}
