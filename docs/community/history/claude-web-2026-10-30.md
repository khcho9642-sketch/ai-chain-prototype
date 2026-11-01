# Claude 실제 웹 의견 · 2026-10-30 KST

사용자는 Claude 공식 웹에 직접 질문하여 GPT의 NVDA·Gemini의 AVGO와 다른 종목을 고르고, 근거 있는 추정가격이 관측가격보다 높은 경우 실제 의견과 댓글을 기존 사이트에 반영하도록 요청했다. 기존 자동 승인 검토의 거부 기록을 보존하고 사용자가 요청한 앱의 **승인 요청** 방식에서 실제 웹 질문을 한 번 전송했다. Claude가 답하지 않았던 이전 상태와 이번 실제 응답을 구분한다.

## 실제 결과와 계산 검토

공식 Claude 웹에서 화면 선택 모델 **Opus 5.5 중간**으로 요청 1회 후 **VRT(버티브)**를 선택한 응답을 받았다. 서버가 실제 모델 식별자를 보고한 것은 아니므로 `reportedModel: null`이며 웹 앱 버전도 공개되지 않아 `cliVersion: null`이다. 다른 모델의 대필·추가 생성·재추첨은 없다.

| 항목 | 확인한 내용 |
| --- | --- |
| 비교 범위 | VRT·AMD 두 후보, NVDA·AVGO 제외 |
| 입력 관측 시세 | VRT 249.525 USD/주, 2026-10-29T14:28:25Z (KST 10월 29일 23:28:25), 지연 시세 |
| AI 추정 가격 | 270 USD/주 |
| 입력 시세 대비 차이 | +8.2055906%, 표시 +8.21% |
| 산식 | 회사 2026 Q4 조정 희석 EPS 전망 중간값 2.25 × 4 × 주관적 PER 30배 |
| 민감도 | Q4 EPS 전망 하단 2.22 × 4 × 25배 = 222 USD, 상단 2.28 × 4 × 35배 = 319.20 USD |
| 반대 계산 | 연간 조정 EPS 전망 7.15 × 30배 = 214.50 USD; Q4 GAAP EPS 전망 2.08 × 4 × 30배 = 249.60 USD |

270 USD는 미래 분기 전망을 단순 연율화하고 주관적 배수를 적용한 가정값이다. 확정 실적·연간 실적·TTM·회사 목표가·검증된 시장 컨센서스가 아니다. 분기 계절성과 EPS 기준에 따라 결과가 크게 달라지며 낮은 민감도 값은 관측 시가보다 낮다. 원문 손익분기 배수 27.7배는 정확한 계산 27.725배의 반올림이다. 추정이 관측가격보다 높다는 사실만으로 저평가가 입증됐다고 표시하지 않는다.

VRT 수치·EPS 전망은 [회사 Q3 공식 발표](https://investors.vertiv.com/news/news-details/2026/Vertiv-Reports-Strong-Third-Quarter-2026-with-Net-Sales-Growth-of-61-Organic-Orders-Growth-over-100-and-Diluted-EPS-Growth-of-91-Adjusted-Diluted-EPS-Growth-of-78-Raises-Full-Year-2026-Guidance-Across-All-Key-Metrics/default.aspx)와 대조했다. AMD 비교 문단에는 [Q2 공식 실적](https://ir.amd.com/news-events/press-releases/detail/1295/amd-reports-second-quarter-2026-financial-results)과 [11월 3일 실적 발표 일정](https://ir.amd.com/news-events/press-releases/detail/1300/amd-to-report-fiscal-third-quarter-2026-financial-results)을 검토 출처로 보충했다. 현재 시가는 기존 공통 스냅샷을 계속 사용하며 그 시가가 바뀌면 비교 상태도 다시 계산한다. 모델 입력 당시 관측값을 실시간 가격이나 장마감 가격으로 바꾸지 않는다.

## 댓글과 원문

원문의 `comment`를 고치지 않고 그대로 발행한다.

> AI 칩이 아무리 똑똑해도 전기와 냉각 없이는 뜨거운 벽돌일 뿐입니다. 4분기 전망 조정 EPS 2.25달러를 단순 연율화하고 30배를 적용하면 270달러가 나옵니다. 다만 손익분기 배수가 27.7배라 여유가 넉넉한 편은 아닙니다.

공식 답변 복사 버튼으로 받은 UTF-8 텍스트 전체와 바깥 JSON 코드 펜스를 보존했다. 화면은 펜스 안 JSON의 `opinion`을 읽기 쉽게 표시하고 전체 원문도 별도로 제공한다. 공용 스냅샷의 `fairValue.method`는 원문의 `formula`, 가격·기준시각·가정은 원래 필드의 투영이며 숫자를 수정하지 않았다. 민감도와 반대 계산은 원문과 검토 메모에 남긴다.

응답 SHA-256: `9abf7f895240a9d0cfa2eb5b075e93f818dcd35fc936e913e450208d23402e94`. 이는 복사한 화면 텍스트의 체크섬이며 제공사 전자서명·서버 응답 바이트 검증·서버 모델 식별의 증거가 아니다. 계정·개인 대화 URL·비공개 경로·로그는 공개 스냅샷에 넣지 않는다.

## 보존과 운영 범위

GPT NVDA·Gemini AVGO의 전체 기록과 기존 이력 4개·이전 GPT VRT 발행·기존 `providerStates`·답글 배열은 바꾸지 않았다. 과거 Claude NVDA 실적 검토도 그대로 남는다. 모델별 최근 보고서는 각자의 실제 KST 발행일로 검증하고, 예전 GPT·Gemini 카드는 이전 발행 표시와 원래 날짜를 보여준다. 오늘 새로 발행한 답변 수에 예전 기록을 넣지 않는다.

새 허용 경계는 정확한 `claude`/`claude-web` 제공사 조합의 소유자 검토 일회성 종목 의견이다. 기존 `claude-code`는 실적 검토만 허용하며 기존 CLI 버전·출처 검증을 유지한다. 웹 별도 대화체 댓글 생성 기록이나 다른 제공사 사칭을 허용하지 않는다.

Today와 VRT 종목 토론의 AI·AI+인간 탭은 같은 실제 댓글을 읽고 인간 전용 탭에는 숨긴다. 커뮤니티 DB·자동 댓글 워커·CLI 활성화·예약·유료 API 전환은 추가하지 않는다. 이번 웹 응답 성공은 기존 CLI의 금융 용도나 자동 운영 이용 조건·격리 검증을 통과했다는 뜻이 아니다. 비공개 원문·전송 기록·시세·발행 전 백업·보존 증명은 프로젝트 `.local/`에 유지한다.
