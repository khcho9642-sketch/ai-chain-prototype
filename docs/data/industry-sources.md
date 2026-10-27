# Official Korean export statistics

Collected and checked on 2026-10-26 KST. All numbers below are from primary sources.

## Integrated collection and source evidence

- `scripts/data/official-trade.mjs`: `collectOfficialTrade(previous, options)` returns `{sources, series, gaps}` without writing any files. No dependency. `ECOS_API_KEY` is optional; default is the officially exposed public `sample` service. Every request retrieves at most ten monthly rows. Initial history 36 months; subsequent requests refresh 13 months for revisions and YoY. Per-series success timestamps survive failed refreshes. API keys are omitted from public evidence links.
- `data/industry.json` contains the integrated public series, collected by `scripts/data/collect-industry.mjs`: eight ECOS series initially seeded with 36 monthly observations each, 2023-10 through 2026-09. These are semiconductor / transformer / electrical equipment / electronics / total export volume indices, and semiconductor / transformer / total export value indices. Automatic refreshes preserve each series definition and success time.
- Three reviewed Customs release series are also integrated in `data/industry.json`: semiconductor exports USD and total exports USD for the reviewed confirmed month, and the initially verified 13 months of total export net weight. These are reviewed release observations, not an automated Customs API feed. Keep the original source publication date and `automation: reviewed-release` visible.
- `tests/data/official-trade.test.mjs`: meaningful offline checks for ten-row windows, response identity/units, invalid or duplicate data, preliminary/final status, YoY, failure preservation, complete history and private-key exclusion.

Legacy raw seed files and source downloads from the former loose working folder are archived under `.local/archive/education-2026-10-27/industry-stats-work/export/`, including the original `trade-api-seed.json` and `customs-reviewed-seed.json` when retained. They are private working evidence, not runtime inputs or additional public snapshots. The current pipeline uses the integrated `data/industry.json` and collectors under `scripts/data/`; see [project structure](../project-structure.md).

## Primary sources and exact current figures

한국은행 2026년 9월 수출입물가지수 및 무역지수(잠정), 2026-10-16:

- Release: https://www.bok.or.kr/portal/bbs/B0000501/view.do?depth=201264&menuNo=201264&nttId=11065605&programType=newsData&relate=Y
- XLSX: https://www.bok.or.kr/fileSrc/portal/d482465472f845ae92550332b4947248/2/fc40b5224bb84157bbfccad20d7d98af.xlsx
- PDF: https://www.bok.or.kr/fileSrc/portal/d482465472f845ae92550332b4947248/3/c594ed35f7734569b0d59a9c59c11550.pdf
- ECOS service: https://ecos.bok.or.kr/
- Official series table metadata: https://ecos.bok.or.kr/api/StatisticTableList/sample/json/kr/1/10/403Y002/
- Actual semiconductor volume data: https://ecos.bok.or.kr/api/StatisticSearch/sample/json/kr/1/10/403Y002/M/202601/202609/3091AA
- Actual transformer volume data: https://ecos.bok.or.kr/api/StatisticSearch/sample/json/kr/1/10/403Y002/M/202601/202609/310121AA

September 2026, all units 2020=100: semiconductor export volume 292.59 (+30.5% YoY); transformer volume 405.82 (+34.8%); electrical equipment volume 130.94 (+7.0%); electronics volume 276.78 (+46.6%); total export volume 181.31 (+32.1%). Semiconductor value index 733.03 (+268.1%); transformer value index 602.00 (+37.3%); total value index 287.41 (+89.2%). These are indices, not dollar amounts or weights.

Official BOK release XLSX sheet 5 A24 and sheet 7 A56 say the current year's trade indices remain provisional until the following year's February release, confirmed during March. The collector conservatively keeps the previous year preliminary through March. The release's methodological section explains volume indices as value indices divided by dollar price indices with customs clearance lags, including quality changes. It also excludes ships, weapons, aircraft and artworks that cannot be price-surveyed. Consequently the BOK total value/volume series differ from Customs headline dollar totals and net weight.

관세청 2026년 9월 월간 수출입 현황 [확정치], 2026-10-15:

- Release: https://www.customs.go.kr/kcs/na/ntt/selectNttInfo.do?bbsId=1362&mi=2891&nttSn=10179763&nttSnUrl=94e483116f9b898190458b9bf79546a3
- PDF: https://www.customs.go.kr/common/nttFileDownload.do?fileKey=525c28fb98304bd4a171d639a41ed008
- PDF p11, customs acceptance date: September semiconductor exports 60,503 million USD (+260.3% YoY). Total exports 121,050 million USD (+83.7%). Do not use the departure-date supplementary figures on p17 (semiconductor 59,804 million) or the January–September cumulative values as monthly figures.
- PDF p4: September net export weight 2,302 만 톤 (+27.3%). This is **all Korean goods**, not semiconductor-only weight. Source rounded to ten thousand tonnes; preserve its precision. Prior monthly weights from 2025-09 through 2026-08 are included in the seed.
- The release calls this monthly confirmed data but says individual numbers may be revised before annual confirmation in February 2027. `status: final` here means the release's monthly confirmed status, not unrevisable data. License: 공공누리 제1유형, attribution required.

## Customs HS amount and net-weight API: service key required

Official catalog: https://www.data.go.kr/data/15101609/openapi.do

Official API: `https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList`

Parameters: required `serviceKey`, `strtYymm`, `endYymm`; optional `hsSgn`. Response XML fields: `year` (2016.01), `hsCode`, `statKor`, `expDlr` (USD FOB), `expWgt` (net kg), imports and balance. Free; development auto approval, production review approval, development daily traffic 10,000. Rows represent actual customs net weight, not units, chips or bit shipments. A service key must be approved for this dataset, not merely present for some other public API.

Country-by-item alternative: https://www.data.go.kr/data/15100475/openapi.do and `https://apis.data.go.kr/1220000/nitemtrade/getNitemtradeList`; additionally required `cntyCd`, period within one year. Its HS response field is `hsCd`, unlike the national API's `hsCode`.

Official catalog says export amounts are FOB USD and weights are net weight; updates incorporate correction/withdrawal around the 15th of each month. Do not relabel value as shipment volume and do not infer chip prices from USD/kg without product mix and quantity evidence. No approved Customs service key was available during this work, so the UI should show that HS-specific kg remains unconnected. Real BOK sector-volume indices and reviewed Customs overall net weight are available now.

## TSMC monthly revenue

- Official initial monthly history: https://investor.tsmc.com/english/monthly-revenue/2025 and https://investor.tsmc.com/english/monthly-revenue/2026 . Unit: millions of New Taiwan dollars; unaudited.
- Official current month update: https://openapi.twse.com.tw/v1/opendata/t187ap05_L , documented by https://openapi.twse.com.tw/ . Row company code2330, reference month 資料年月 converted from ROC calendar, monthly revenue 營業收入-當月營收 (TWD thousands) /1000 to TWD millions. Do not use 出表日期 as the revenue month or 累計營業收入 as monthly revenue.

## Integrated screen, units and refresh policy

- 산업통계(#industry): 한국은행 ECOS 수출물량지수 5개와 수출금액지수 3개(각 36개월), 관세청 반도체·전체 수출액 및 전체 수출 순중량, TSMC 월매출 등 총 12개다. 기준월·단위·출처·확정 여부·성공 확인일을 표시하며 달력 기준 12/24/36개월 차트와 원자료 CSV를 제공한다.
- 물량지수(2020=100), 실제 금액(백만 달러), 전체 중량(만 톤), 매출(백만 TWD)은 서로 구분한다. 가격·제품 구성·통계 조사범위가 달라 이들 수치가 직접 일치하지 않는다. 관세청 전체 중량은 반도체나 변압기만의 중량이 아니다.
- ECOS와 TWSE는 npm run collect:industry로 수집한다. GitHub Actions의 기존 예약 배포에서 하루 한 번 확인하고 실패 시 이전 성공값·시각을 유지한다. ECOS는 공식 sample의 요청당 10개 제한을 지킨다. 선택적으로 GitHub Actions Secret ECOS_API_KEY를 등록할 수 있으며 키는 공개 JSON에 넣지 않는다.
- 관세청 세 지표는 공식 발표문을 검증해 수록한 자료(automation: reviewed-release)다. 기준월을 자동으로 바꾸지 않는다. HS 품목별 kg·달러 API는 해당 데이터에 승인된 serviceKey가 없어 미연결로 표시한다.
- TSMC 이력은 공식 IR의 월별 연결 매출이며, 최신 월은 TWSE 공식 API의 당월 필드에서 갱신한다. 누적 매출을 월별 매출로 사용하지 않는다.
- Vercel의 /api/industry는 Pages의 검증된 산업 JSON을 읽는다. 정적 빌드가 공개하는 JSON 6종은 [공개 파일 허용목록](../deployment/overview.md)을 따른다. 산업통계의 소스 증거와 정의는 이 문서를 따른다.
