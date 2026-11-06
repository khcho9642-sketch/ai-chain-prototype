# 금리 시나리오의 CAPEX 예산 주체와 공급 경로

금리 +1%p가 12개월 지속되는 화면 기본 설정(`historical`, 회사별 재정의 없음)에서 41개 기업을 확인했다. 예산 주체는 4곳, 공급 경로만 받는 기업은 35곳, CAPEX 경로가 없는 기업은 2곳이다. 오라클과 코어위브는 자체 투자 규모를 공시하지만 현재 예산 주체에서 빠져 있다. 아래 수치는 2026-11-05 모형 버전 3의 [검토 기준 커밋](https://github.com/khcho9642-sketch/ai-chain-prototype/commit/822cd9c1c69d832516ab3581e00fdc9317a906f4)에서 재계산했다. 표의 금리 직접효과는 12개월로 고정되고, 사용자가 고르는 12개월은 CAPEX 전파 지속기간이다.

## 41개 기업의 역할

복수 섹터 기업은 주 섹터에 한 번씩 집계했다. `supply-chain`은 합산 CAPEX가 섹터를 거쳐 해당 기업의 매출 물량에 전달된다는 모형 분류다. 실제 거래 상대방을 확인한 등급으로 해석할 수 없다. [회사 목록과 섹터 비중](https://github.com/khcho9642-sketch/ai-chain-prototype/blob/822cd9c1c69d832516ab3581e00fdc9317a906f4/assets/scenario-data.js#L309-L360) · [회사별 경로 선택](https://github.com/khcho9642-sketch/ai-chain-prototype/blob/822cd9c1c69d832516ab3581e00fdc9317a906f4/assets/scenario-core.js#L589-L609)

| capexRole | 주 섹터 | 수 | 기업 (ID) |
|---|---|---:|---|
| `budget-owner` | SEG8·SEG9 | 4 | 마이크로소프트(MSFT), 아마존(AMZN), 알파벳(GOOGL), 메타(META) |
| `no-covered-customer-path` | SEG8 클라우드 | 2 | 오라클(ORCL), 코어위브(CRWV) |
| `supply-chain` | SEG1 반도체 소부장 | 5 | ASML, 어플라이드 머티어리얼즈(AMAT), 램리서치(LRCX), KLA(KLAC), 한미반도체(042700.KS) |
| `supply-chain` | SEG2 파운드리·패키징 | 5 | TSMC ADR(TSM), 삼성전자(005930.KS), 인텔(INTC), ASE 테크놀로지 ADR(ASX), 앰코테크놀로지(AMKR) |
| `supply-chain` | SEG3 메모리 | 3 | SK하이닉스(000660.KS), 마이크론(MU), 키옥시아 홀딩스(285A.T) |
| `supply-chain` | SEG4 AI 칩 | 4 | 엔비디아(NVDA), 애플(AAPL), AMD, 브로드컴(AVGO) |
| `supply-chain` | SEG5 서버·네트워크 장비 | 5 | 아리스타 네트웍스(ANET), 델 테크놀로지스(DELL), 슈퍼마이크로(SMCI), 퀀타 컴퓨터(2382.TW), 휴렛팩커드 엔터프라이즈(HPE) |
| `supply-chain` | SEG6 전력·냉각 | 5 | 버티브(VRT), 이튼(ETN), 슈나이더 일렉트릭(SU.PA), GE 버노바(GEV), HD현대일렉트릭(267260.KS) |
| `supply-chain` | SEG7 데이터센터 | 4 | 에퀴닉스(EQIX), 디지털 리얼티(DLR), 아이언마운틴(IRM), 케펠 DC 리츠(AJBU.SI) |
| `supply-chain` | SEG9 AI 모델 | 4 | 테슬라(TSLA), OpenAI(OPENAI), Anthropic(ANTHROPIC), DeepSeek(DEEPSEEK) |

## CAPEX 경로가 없는 두 회사

두 회사 모두 클라우드(SEG8) 비중이 100%다. 전체 사업 중 시나리오 노출 비중은 별도 계수다. SEG8에서 출발하는 자체 지출·서비스 경로는 예산 주체 4곳에만 적용하고, 합산 예산의 공급 경로는 다른 섹터에서 끝나므로 두 회사의 CAPEX 경로 수와 그 기여는 모두 0이다. 두 회사의 금리 할인율·직접 수요 효과는 계산된다. [원천 가정](https://github.com/khcho9642-sketch/ai-chain-prototype/blob/822cd9c1c69d832516ab3581e00fdc9317a906f4/assets/scenario-data.js#L205-L210) · [분기 로직과 주석](https://github.com/khcho9642-sketch/ai-chain-prototype/blob/822cd9c1c69d832516ab3581e00fdc9317a906f4/assets/scenario-core.js#L564-L609) · [설계 문서](https://github.com/khcho9642-sketch/ai-chain-prototype/blob/822cd9c1c69d832516ab3581e00fdc9317a906f4/docs/data/scenario.md#L41-L56)

| 기업 | 섹터 비중 | 시나리오 노출 | 직접효과 | CAPEX 전파효과 | 회사 공시로 대조한 연결 현금 지출 |
|---|---:|---:|---:|---:|---|
| 오라클 | SEG8 100% | 55% | −0.661634% | 0.000000% | 2026년 5월 결산 CAPEX 556.63억 달러. 회사는 AI 클라우드 인프라 투자 목적을 설명한다. [Oracle FY2026 현금흐름표 및 투자 설명](https://investor.oracle.com/investor-news/news-details/2026/Oracle-Announces-Record-Q4-and-FY-2026-Results-Driven-by-Cloud-Infrastructure--Cloud-Applications/) |
| 코어위브 | SEG8 100% | 95% | −0.850512% | 0.000000% | 2025년 12월 결산 유형자산 취득 현금 103.09억 달러(자본화한 내부사용 소프트웨어 포함). 회사는 AI 클라우드 데이터센터를 운영한다. [CoreWeave FY2025 현금흐름표 및 사업 설명](https://investors.coreweave.com/news/news-details/2026/CoreWeave-Reports-Strong-Fourth-Quarter-and-Fiscal-Year-2025-Results/) |

두 금액은 각각 재무 DB 최신 연간 연결 현금 CAPEX의 절댓값과 일치한다. 결산월이 서로 다르고, 양쪽 모두 AI 전용 투자액을 따로 식별하지 않는다. 기본 금리 회귀 스냅숏에는 두 회사의 계수가 없다. 현재의 0은 의도적으로 정한 네 회사 범위에서 발생한 계산 결과다. 자체 투자나 타사 발주가 금리와 무관하다고 판단할 근거는 없다. [회사별 회귀 스냅숏](https://github.com/khcho9642-sketch/ai-chain-prototype/blob/822cd9c1c69d832516ab3581e00fdc9317a906f4/assets/scenario-rate-fits.js) · [네 예산 주체의 명시적 목록](https://github.com/khcho9642-sketch/ai-chain-prototype/blob/822cd9c1c69d832516ab3581e00fdc9317a906f4/assets/scenario-data.js#L289)

## 예산 주체로 돌아오는 경로

네 회사 모두 SEG4(AI 칩) 비중은 0%다. 각 회사는 자기 투자 지출(SEG8, 시차 0개월), 서비스 물량(SEG8, 12개월), 합산 CAPEX에서 오는 물량 경로 한 개를 받는다. 아마존의 합산 경로는 SEG8→SEG7 데이터센터 용량(6개월), 다른 세 회사는 SEG8→SEG9 모델 공급 여력(12개월)이다. SEG9에는 운영 가능 용량을 통하는 경로도 포함되므로 네 회사의 합산 경로를 모두 외부 고객 매출로 단정할 수 없다. [섹터 가중치](https://github.com/khcho9642-sketch/ai-chain-prototype/blob/822cd9c1c69d832516ab3581e00fdc9317a906f4/assets/scenario-data.js#L349-L356) · [경로와 시차](https://github.com/khcho9642-sketch/ai-chain-prototype/blob/822cd9c1c69d832516ab3581e00fdc9317a906f4/assets/scenario-data.js#L250-L256)

아래 기여도는 각 회사가 보고한 `paths` 중 `driverId=hyperscalerCapex`, `mediatedBy=interestRate` 경로의 `impactPoints`다. 단위는 무충격 기준 EV 변화율에 대한 %p다. 경로를 계산 순서대로 더하면 마지막 열의 CAPEX 전파효과가 된다. 표시는 소수 여섯 자리로 반올림했다. [순차 재평가 방식](https://github.com/khcho9642-sketch/ai-chain-prototype/blob/822cd9c1c69d832516ab3581e00fdc9317a906f4/assets/scenario-core.js#L418-L464)

| 회사 | 섹터 비중 | 자체 지출 | 자체 서비스 | 자체 두 경로 합 | 합산 예산 공급 경로 | 전체 CAPEX 전파 |
|---|---|---:|---:|---:|---:|---:|
| 마이크로소프트 | SEG8 70% / SEG9 30% | −0.047356 | +0.016722 | −0.030634 | −0.016711 | −0.047345 |
| 아마존 | SEG8 80% / SEG7 20% | +0.308643 | −0.100711 | +0.207932 | −0.010917 | +0.197015 |
| 알파벳 | SEG8 60% / SEG9 40% | −0.026445 | +0.012886 | −0.013560 | −0.019082 | −0.032642 |
| 메타 | SEG9 80% / SEG8 20% | +0.022089 | −0.014044 | +0.008045 | −0.053385 | −0.045340 |

### 합산 예산 중 자기 몫을 분리한 재계산

공급 경로의 공통 입력은 −5.038054%다. 이 중 회사 i의 몫은 `i의 예산 변화율 × i의 현금 CAPEX ÷ 네 회사 현금 CAPEX 합계`다. 각 회사의 금리 직접효과, 자체 지출·서비스 경로, 전체 예산 분모를 고정한 채 공급 경로에 투입하는 충격만 바꿔 동일 DCF를 재평가했다. 아래 마지막 세 열은 공급 경로를 끈 DCF와의 EV 변화율 차이(%p)다. ‘자기 몫’은 다른 세 회사의 공급 입력을 0으로, ‘타사 몫’은 자기 공급 입력을 0으로 뒀다. 전체 모형 대비 자기 몫 제거 차이도 별도로 확인했다. 이 조건에서 마지막 두 부분 기여의 합은 합산 경로 기여와 반올림 오차 안에서 일치한다. [예산 가중 계산](https://github.com/khcho9642-sketch/ai-chain-prototype/blob/822cd9c1c69d832516ab3581e00fdc9317a906f4/assets/scenario-core.js#L163-L177) · [경로 조합](https://github.com/khcho9642-sketch/ai-chain-prototype/blob/822cd9c1c69d832516ab3581e00fdc9317a906f4/assets/scenario-core.js#L571-L585)

| 회사 | 자기 예산 변화 | 예산 가중치 | 합산 입력 중 자기 몫(%p) | 공급 EV 기여 전체 | 자기 몫만 | 타사 몫만 |
|---|---:|---:|---:|---:|---:|---:|
| 마이크로소프트 | +1.5432% | 22.0882% | +0.340872 | −0.016711 | +0.001131 | −0.017842 |
| 아마존 | −14.7467% | 34.9704% | −5.156973 | −0.010917 | −0.011174 | +0.000258 |
| 알파벳 | +1.6200% | 25.9694% | +0.420716 | −0.019082 | +0.001594 | −0.020676 |
| 메타 | −3.7866% | 16.9720% | −0.642669 | −0.053385 | −0.006810 | −0.046575 |

예를 들어 아마존에서는 자기 예산 감소가 합산 입력에 −5.156973%p를 보태고, 다른 세 회사를 합친 기여가 부분 상쇄한다. 아마존의 공급 경로 EV 기여 −0.010917%p 중 자기 예산 몫은 −0.011174%p, 타사 예산 몫은 +0.000258%p다. 마이크로소프트와 알파벳은 이 조건에서 자기 예산이 늘어나 자기 몫의 부호도 양수다.

따라서 자기 예산 신호가 자사 다른 사업 부문의 물량으로 다시 들어오는 현상은 네 곳 모두에서 재현된다. 실제 동일 내부거래나 동일 최종 매출이 두 번 인식됐는지는 판정할 수 없다. 경로에는 구매자·공급자 법인, 외부 고객 거래 비중, 서비스 매출과 모델 매출의 중복 비중이 없다. 자사 투자 지출과 향후 외부 고객 서비스 수입은 경제적으로 서로 다른 현금흐름일 수 있다.

## 예산 주체 확장 제안

1. 예산 주체를 회사별 데이터로 관리한다. 투자액·통화·기간·연결 범위, 현금 구매와 리스 구분, AI 귀속 비중, 금리 민감도와 표본 기간·출처·등급을 기록한다. 오라클·코어위브 추가 전 기존 네 회사와 같은 4개 분기의 연결 현금 CAPEX를 확보한다. AI 전용 현금 CAPEX가 확인되면 전사 대용치와 구분한다.
2. 회사 자체 지출·서비스와 타 고객 발주 수혜를 별도 역할로 둔다. 새 회사의 회귀가 없으면 ‘계수 없음’을 표시하고, 사용자가 C등급 수동 민감도 또는 명시적 동종사 가중평균을 선택한 확장 시나리오에서만 반영한다. 자체 지출을 셀 수 있어도 고객 구성과 주문 전가율은 별도로 근거를 확보한다.
3. 거래처 자료를 구할 수 있는 구간부터 구매자→공급자별 외부거래 비중과 출처를 넣는다. 연결 내부거래로 확인한 몫은 외부 공급 매출에서 제거하고, 같은 장비가 창출하는 최종 외부 서비스 매출을 경로별로 대조한다. 검증 전에는 위 두 반사실의 차이를 보여줄 수 있다. 자기 예산을 일괄 제외하거나 두 후보를 기본값에 추가하는 조치는 별도 판단으로 둔다.

가정 기반 조건부 계산값이며 목표주가·예측이 아님.
