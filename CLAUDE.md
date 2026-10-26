# AI 체인 (가칭) — AI Value Chain 주주 플랫폼

Claude Code에 넘기는 작업 메모입니다. 이 폴더에서 이어서 작업하세요.

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
2. 실제 글쓰기·저장·목록·본문 구현 및 다른 기기·이용자에서 열람 검증. 현재 토론 화면의 예시와 비활성 입력은 미완료 상태다.
3. 고리별 기업 정보와 게시판을 연결하고 출처 있는 정보를 확충한다.
4. 즐겁게 이용하는지 실제 반응을 확인하고 기능을 개선한다. 재미 요소의 세부 형태는 아직 확정하지 않았다.

## 통합 구조
독립 stock-site 앱을 다시 만들지 않는다. assets/instruments.js의 93개 카탈로그와 server/market.mjs의 단일 API를 사용한다. 관심종목·직접 티커·모든 기간 차트·OHLCV·CSV는 assets/dashboard.js에 통합했다. 디자인 원본과 사용자 목표는 보존한다. 실행 방법·배포 차이는 README.md를 따른다.

## 고리별 주가 비교
assets/peer-comparison-core.js는 공통거래일·기준100·현지통화 종가등락률 동일비중 평균을 계산한다. assets/peer-comparison.js·css가 #compare 8개선·피어목록·CSV를 제공하며 dashboard의 market-snapshot 이벤트를 공유한다. 기존의 예시 산업신호와 비교 주가 지수를 혼동하지 않는다. 세부계산은 README와 scripts/peer-comparison.test.mjs 참고.

## 기업·산업통계 확장
AI 기업 75개(국내18·해외57), 고리 편입77건을 같은 시세 카탈로그로 제공한다. 기업 역할·국가·공식 출처는 assets/company-profiles.js에 있다. #industry의 공식 통계12개와 수집·오류 처리·단위는 README 및 docs/industry-sources.md 참고. 관세청 발표문 검증 수치는 자동 API 자료로 표현하지 않는다. 품목별 kg API는 미연결이다.
