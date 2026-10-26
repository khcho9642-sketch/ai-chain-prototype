# AI 체인 (가칭) — AI Value Chain 주주 플랫폼

Claude Code에 넘기는 작업 메모입니다. 이 ai-chain-prototype 저장소에서 이어서 작업하세요. 파일 배치 기준은 AGENTS.md와 docs/project-structure.md를 따르며, 이전 교육 자료 폴더에 사이트 파일을 새로 만들지 않습니다.

## 이 프로젝트는
AI Value Chain 8단계를 한 화면에 보여주고, 그 사슬에 걸친 국내·해외 종목 주주에게 정보와 커뮤니티를 제공하는 웹 서비스의 프로토타입입니다.

## 최상위 목표
사용자 지정 목표와 첫 출시 기준은 PLAN.md의 '최상위 목표'를 따른다.
1. AI 밸류체인 정보를 제공한다.
2. 주주들에게 필요한 정보를 제공한다.
3. 주주들이 재미있게 머물고 소통하는 사이트를 만든다.
4. 실제 게시판 글쓰기를 제공한다. 게시판은 첫 출시 범위이며 공용 저장·다른 이용자의 열람이 필요하다. 현재 구현 완료를 뜻하지 않는다.

## 폴더 구성
- `index.html` — Claude 원본 UI를 유지한 통합 화면. Node.js 24에서 npm run dev로 실행하고 npm run build로 dist를 만든다.
- `PLAN.md` — 기획 요약
- `docs/project-structure.md` — 전체 폴더 트리·개발 명령·산출물 보관 기준
- `tests/` — 모든 테스트와 전용 helper·fixture
- `.local/` — Git에서 제외하는 캡처·가입 자료·임시 작업·보관본·준비된 릴리스
- `design/` — 디자인 캔버스 원본(.dc.html). 참고용이며 배포 대상 아님.

## 현재 배포
- 저장소: https://github.com/khcho9642-sketch/ai-chain-prototype
- 사이트: https://khcho9642-sketch.github.io/ai-chain-prototype/
- GitHub Actions로 실제 시세를 수집하고 GitHub Pages에 배포한다. 새 프로젝트 생성부터 다시 시작하지 않는다.

## 지켜야 할 원칙
- 매수·매도 추천, 목표주가, 날짜별 주가 예측 문구를 넣지 않는다. (유사투자자문 규제)
- 숫자는 반드시 출처와 기준일을 함께 표시한다. 확인 안 된 값은 `[값]`으로 둔다.
- stock-site와 합쳐 실제 시세는 대표 종목·시장지표 93개를 연결했다. 기존 산업지표와 강세·보통·약세 판정의 예시를 실제 주가와 혼동하지 않는다.

## 다음 할 일 (목표를 기준으로 구체화)
1. 게시판 구성·작성 정책·공용 저장 방식 확정. 보유 인증을 먼저 필수로 정하지 않는다.
2. 개발 코드의 종목별 공유 댓글·회원 인증·영속 SQLite API·AI 워커 초안/승인 흐름을 운영 서버에 연결하고 다른 기기·이용자의 공유 열람과 실제 모델 작동을 검증한다. 이 코드와 테스트는 구현됐지만 운영 연결은 완료하지 않았다. 자유게시판의 글 목록·본문 등 추가 출시 범위는 별도로 확인한다.
3. 고리별 기업 정보와 게시판을 연결하고 출처 있는 정보를 확충한다.
4. 즐겁게 이용하는지 실제 반응을 확인하고 기능을 개선한다. 재미 요소의 세부 형태는 아직 확정하지 않았다.

## 통합 구조
독립 stock-site 앱을 다시 만들지 않는다. assets/instruments.js의 93개 카탈로그와 server/market.mjs의 단일 API를 사용한다. 관심종목·직접 티커·모든 기간 차트·OHLCV·CSV는 assets/dashboard.js에 통합했다. 디자인 원본과 사용자 목표는 보존한다. 실행 방법·배포 차이는 README.md를 따른다.

## 고리별 주가 비교
assets/peer-comparison-core.js는 공통거래일·기준100·현지통화 종가등락률 동일비중 평균을 계산한다. assets/peer-comparison.js·css가 #compare 8개선·피어목록·CSV를 제공하며 dashboard의 market-snapshot 이벤트를 공유한다. 기존의 예시 산업신호와 비교 주가 지수를 혼동하지 않는다. 세부계산은 README와 tests/peer-comparison.test.mjs 참고.

## 기업·산업통계 확장
AI 기업 75개(국내18·해외57), 고리 편입77건을 같은 시세 카탈로그로 제공한다. 기업 역할·국가·공식 출처는 assets/company-profiles.js에 있다. #industry의 공식 통계12개와 수집·오류 처리·단위는 README 및 docs/industry-sources.md 참고. 관세청 발표문 검증 수치는 자동 API 자료로 표현하지 않는다. 품목별 kg API는 미연결이다.

## AI 수요·매출·토큰 통계

`#ai-stats`는 `assets/ai-statistics.js`·`ai-statistics.css`와 `ai-statistics-core.js`를 사용한다. 2026-10-26 검토본은 산업 50개, OpenAI 12개, Anthropic 11개, 외부 비교 8개로 총 81개 정의다. 외부 비교를 회사·제품별 15행으로 나누므로 화면은 총 88행이며, 중복 제거한 검증 관측은 145개, 미확인 지표는 11개다. 산업 지표 안에 중국 8개·일본 4개·한국 2개가 포함된다. 이 수를 기업 수나 기존 #industry 통계 12개와 혼동하지 않는다.

`research/ai-statistics-2026-10-26.json`은 공개 문서·보고서를 검토한 원본이다. `npm run build:statistics`가 이를 `data/ai-statistics.json`으로 변환·검증한다. 값·원래 단위·관측기간·발표일·출처·공식/보도/추정/연구 구분과 측정 범위를 유지한다. 과거 관측을 현재값으로 보간하지 않으며, 전체 이력은 수집하지 않았다. 회사·제품 매출, 실제 기간 매출·연환산 매출, WAU·앱 MAU·방문 횟수·좌석·기업 고객은 서로 구분한다. 손실액에는 손실 표기를 유지하고, 미확인은 `null`과 사유로 기록한다. 기간·모집단이 다른 통계로 전환율·ARPU를 자동 계산하지 않는다.

`npm run collect:disclosures`는 OpenAI·Anthropic 공식 문서·RSS·뉴스 목록의 변경을 한국 시간 날짜당 한 번 확인한다. `data/ai-disclosures.json`의 후보는 `needs-review`이며 수치 자동 추출·승인이나 검토 통계의 자동 갱신을 하지 않는다. 원문을 확인한 뒤 검토 원본과 공개 통계를 별도 변경으로 반영한다. 실패 시 이전 해시·성공 확인일을 유지한다. 세부 동작은 `docs/ai-disclosure-collection.md`를 따른다.

`npm run collect:tokens`는 OpenRouter 공식 `rankings-daily` API를 통해 기본 90개의 완료된 UTC 날짜를 조회한다. GitHub Actions Secret과 로컬 환경변수 이름은 `OPENROUTER_API_KEY`이며 브라우저·공개 JSON·코드·로그에 키를 넣지 않는다. 같은 UTC 날짜의 성공 수집 뒤에는 건너뛰고, `--force`·`--days 1~366`을 지원한다. 키가 없으면 이전 자료와 `missing-key` 상태를 남긴다. 초기 자료는 2026-10-25 상위 모델 10개의 반올림 스냅샷으로 플랫폼 전체 합계가 아니다. 성공한 API의 상위 50개+`other`에서만 공개 플랫폼 총량을 계산하며 개발사 합계는 식별된 모델만의 관측량이다. 비공개 트래픽이나 회사 전체 사용량으로 확대하지 않는다. 정수 문자열·`BigInt`를 유지하고, 이동평균은 연속 7일이 있을 때만 표시한다. 오류 시 이전 관측과 `lastSuccessAt`을 보존한다.

기존 Pages workflow가 이전 토큰·문서 감시·국내 기업 공시 상태를 복원하며, 토큰·AI 발표문 감시는 각각 일일 수집 기준을 따른다. DART 회사 RSS는 같은 약 30분 간격 workflow에서 수집하되 수집기 자체가 15분 재시도 간격을 관리한다. 승인된 사업·산업 통계는 Git의 검토 파일을 사용한다. 스냅샷 API `/api/ai-statistics`, `/api/ai-tokens`, `/api/ai-disclosures`, `/api/company-disclosures`는 로컬에서 로컬 파일을, Vercel에서 Pages의 검증된 JSON을 제공한다. API 경로 자체가 원천 데이터 수집을 실행하지 않는다. `scripts/build.mjs`의 공개 데이터 허용목록은 `market.json`, `industry.json`, `ai-statistics.json`, `ai-tokens.json`, `ai-disclosures.json`, `company-disclosures.json` 6개다. `research/` 원본·임의 JSON·환경 파일은 정적 빌드에 포함하지 않는다.


## 국내 기업 DART 공식 공시

국내 18개 종목은 `assets/company-disclosure-sources.js`의 검증된 종목코드·DART 고유번호·공시 회사명으로 공식 회사별 RSS에 연결한다. `npm run collect:company-disclosures`는 API 키 없이 공시 메타데이터만 수집하며, `assets/company-disclosures-core.js`로 공개 스냅샷을 검증한다. 회사 RSS의 최근 5영업일 범위에서 수집한 뒤 누적한 자료이고, 성공 수집 시 최근 90일·회사별 최대 500건을 보존한다. 전체 과거 공시 이력이 아니다.

공시 발행회사명을 정확히 대조해 다른 회사에 대신 제출한 항목을 제외하고, 접수번호로 중복 제거한다. 정정공시는 새 접수번호의 별도 문서다. 회사별 오류는 이전 공시·성공 시각을 보존하며 일부 성공은 `partial`로 표시한다. 기본 재수집 간격은 마지막 시도부터 15분이다. 403·429에서는 남은 회사 요청을 중단한다. 강제 재시도 `--force`는 운영자가 의도적으로 확인할 때만 사용한다.

기존 기업 카드의 공시 펼침은 보존 자료 중 최근 5건과 원문 링크를 보여준다. 전체 수집 상태와 회사별 마지막 성공 시각을 표시하고, 공시 자료 다시 읽기는 배포된 JSON을 읽는다. API 경로·기업 목록 로딩이 DART 원천 수집을 실행하지 않는다. OpenAI·Anthropic 발표문 감시용 `ai-disclosures.json`과 섞지 않는다. 작성자·공시 본문은 저장하지 않고 재무 수치를 자동 추출·승인하지 않는다. DART 재무제표 API는 인증키 연결이 필요하며 미연결 상태다. 자세한 구현·제한·상태 정의는 `docs/company-disclosures.md` 참고.
