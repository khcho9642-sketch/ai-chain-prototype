# 기간 시작일 시총 이력 확인 — 2026-11-06

현재 시총을 과거 시총으로 사용하지 않는다. 홈 시총가중 계산에는 **수익률 기준 거래일과 날짜가 정확히 같은 제공처 시총 관측값**만 제공한다. 분기·월말 시총을 임의의 거래일로 이월하거나, 현 주식 수와 과거 주가를 곱해 확정 시총처럼 표시하지 않는다.

확인한 원천:

- Yahoo Finance fundamentals-timeseries의 `trailingMarketCap`, `monthlyMarketCap`, `quarterlyMarketCap`, `annualMarketCap`을 한 번에 요청한다. `asOfDate`, `currencyCode`, `reportedValue.raw`를 보존한다.
- 실제 NVDA 조회에서 `dailyMarketCap`은 HTTP404를 반환했다. 월말·분기말 및 일부 비정기 날짜의 시총은 제공하지만, 매 거래일 이력이 있다는 의미는 아니다.
- `shares_out`은 역사적 주식 수를 반환하지만 날짜가 불규칙하다. ADR 교환 비율·복수 주식 종류와도 범위가 달라질 수 있어 일별 회사 시총의 대체 자료로 사용하지 않는다.
- `yahoo-finance2` 4.0.5의 `fundamentalsTimeSeries`는 재무제표 기간 자료를 대상으로 하므로 이 네 가지 시총 유형을 전용 조회기에서 요청한다. [기반 라이브러리 소스](https://github.com/gadicc/yahoo-finance2/blob/dev/src/modules/fundamentalsTimeSeries.ts), [yfinance의 가치평가 이력 원천](https://github.com/ranaroussi/yfinance/blob/main/yfinance/scrapers/quote.py).

수집기는 잘못된 종목 응답·명시 통화 누락·비양수·범위 밖 날짜를 제외한다. 같은 날짜의 제공처 시총 값이 충돌하면 그 날짜를 제외하고 `conflictingDates`에 남긴다. 인증 토큰이나 쿠키는 출력하지 않는다.

가격 통화와 시총 통화는 구분한다. 서로 다른 통화의 시총을 합산하기 전에는 같은 기준일의 환율로 공통 통화로 환산해야 한다. 환율이나 정확한 날짜의 시총이 없으면 해당 종목의 가중치는 결측이며, 현재 시총이나 추정값으로 채우지 않는다.
