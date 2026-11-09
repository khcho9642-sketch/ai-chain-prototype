# Cloudflare 정적 사이트와 공통 소스 기준

## 현재 개발·운영 기준

- 운영 주소: https://ai-chain-prototype.pages.dev/
- 공통 소스: https://github.com/khcho9642-sketch/ai-chain-prototype 의 최신 main을 반영한 작업 사본. 특정 컴퓨터의 절대 경로나 무시되는 임시 폴더를 공통 기준으로 삼지 않는다.
- 공통 헤더는 나스닥·S&P 500·코스피·CXMT(688825.SS)·코스닥 순으로 저장 시세를 표시한다. CXMT는 중국 상하이 상장 개별 종목이다. 2026-11-09 사용자 확인 기준으로 헤더 시세는 맨 상단 헤더 로고 **AI Value Chain 시장 지도** 바로 오른쪽에 작게 표시한다. 모든 챕터에서 같은 공통 헤더에 계속 표시한다. 모바일도 동일한 최상단 로고 옆 영역에서 가로로 넘겨 본다. 헤더의 “실시간 갱신 중지 · 저장된 종가” 문구는 표시하지 않고 각 **ⓘ 자료** 버튼의 기본 `<details>`에서 원래 날짜·출처·저장 상태를 확인한다. 실제 실시간·수집·API·폴링 중지는 유지한다. 개발 채팅마다 현재 브랜치·HEAD·미커밋 변경을 확인하며, 기존 작업을 보존하고 최신 main에서 독립 worktree로 이어갈 수 있다.
- 2026-11-08 사용자 요청으로 Qualcomm(QCOM, C0371)을 AI 칩 핵심에 추가한다. 후속 CXMT와 Nscale 추가를 반영한 현재 선정 기준은 핵심 52개(상장 48·비상장 4), AI 칩 6개·메모리 6개다. 원본 회사 원장 586개는 보존하며 사용자 신규 Nscale 1개를 합친 효과적 전체는 587개다. 클라우드·GPU는 7개(상장 6·비상장 1), AI 모델은 기존 5개(상장 2·비상장 3)를 유지한다. 원본 ‘핵심기업 49’ 시트·`research/market/home-map-selection.json`·원본 시트명·SHA-256은 보존하고, `research/market/home-map-additions.json`의 사용자 선정을 원본 뒤 QCOM 순서 50·CXMT 순서 51·Nscale 순서 52로 합성한다. 신규 회사는 `research/market/company-additions.json`에 분리하며 원본 49개·586개 JSON/CSV와 출처 날짜·해시는 수정하지 않는다. 원본 `sourceAsOf`는 원래 날짜를 보존한다. 과거 배포 이력의 49개와 원장 비상장 49개는 이 변경으로 바꾸지 않는다.
- 2026-11-08 사용자 후속 요청으로 CXMT(C0119)를 메모리 핵심에 추가한다. QCOM의 기존 사용자 추가 기록은 보존한다. CXMT의 상장 코드 `688825`는 [회사 공식 소개](https://www.cxmt.com/en/about.html)와 [상하이거래소 상장 공고](https://www.sse.com.cn/disclosure/announcement/listing/ipo/c/c_20260724_10826610.shtml)로 확인하며, 제공처 연결 티커는 `688825.SS`다. 이 연결 변경은 새 가격 수집이나 운영 검증 완료를 의미하지 않는다. 저장 자료에 없는 값은 결측으로 보존한다.
- 2026-11-08 사용자 요청으로 Nscale(C0587)을 영국 비상장 클라우드·GPU 컴퓨팅 핵심에 포함한다. [공식 서비스 소개](https://www.nscale.com/service-overview)를 근거로 클라우드·GPU 컴퓨팅에 분류한다. [IPO 신청 발표](https://www.nscale.com/press-releases/nscale-files-initial-public-offering)의 `NSCL`은 제안 티커이며, 작업 시점 [SEC 제출 메타데이터](https://data.sec.gov/submissions/CIK0002110365.json)의 `tickers`·`exchanges`가 빈 배열인 상태를 기준으로 비상장으로 둔다. `NSCL`을 상장 티커나 시세 조회 대상으로 연결하지 않는다. 원본 수집 스냅샷의 586개·555종목과 실제 날짜·결측 상태를 유지한다. 사용자 추가와 생성한 공용 원장 587개는 원천 자료 재수집이나 비상장 가격 생성의 근거가 아니다.
- 실시간 시세·원천 수집·자동 폴링·댓글·기존 커뮤니티 회원·투표 API·SSE·AI 워커는 중지한다. GitHub 수집 워크플로는 disabled_manually 상태를 유지한다.
- 사용자 승인으로 추가하는 Google 로그인은 별도 `/api/auth/*`만 Pages Functions에서 실행한다. 회원 전용 D1 스키마와 운영 바인딩을 준비했으며 Google client ID 설정을 준비했으며 운영 배포·실제 계정 검증은 대기 상태다. [Google 로그인 연결 현황](../community/google-login.md)을 따른다.

## 검증과 수동 배포

1. 저장소 루트에서 git fetch origin main 후 현재 브랜치와 원격 main의 차이를 확인한다. 미커밋 변경을 임의로 reset하거나 다른 채팅의 공유 브랜치를 바꾸지 않는다.
2. 관련 검사와 npm test, npm run build를 실행한다. 빌드는 저장 자료의 검증과 로컬 파생 계산만 수행한다. 외부 수집 명령이나 과거 Vercel 준비 스크립트를 실행하지 않는다.
3. 검증한 `dist`를 기존 Cloudflare Pages 프로젝트 `ai-chain-prototype`에 업로드한다. Google 로그인 연결 시에는 같은 작업 사본의 `functions/api/auth/[[path]].js`와 참조하는 서버 모듈이 Functions로 묶이도록 저장소 루트에서 배포한다. Git 커밋과 배포 메타데이터를 일치시키고 비공개 원본·DB·환경파일·.local은 올리지 않는다.
4. 공개 파일 해시·저장 자료의 기준일·필수 화면 모듈·실시간 API 차단을 확인한다. 코드·테스트·운영 배포와 실제 AI 모델 검증을 별도로 기록한다.

~~~sh
npm test
npm run build
npx wrangler pages deploy dist --project-name ai-chain-prototype --branch main
~~~

`wrangler.jsonc`는 Pages 프로젝트와 `dist` 출력 폴더를 지정한다. 로그인용 `MEMBER_DB`, `GOOGLE_CLIENT_ID`, `AUTH_ORIGIN`은 `env.production`에만 준비하며 preview는 별도 개발 프로젝트·원본·DB를 구성하기 전까지 비활성으로 둔다. 빌드의 `_routes.json`은 `/api/auth/*`만 Functions로 보내므로 저장 화면·데이터·정적 자산에는 인증 함수를 실행하지 않는다. Google client ID가 없으면 인증은 비활성으로 응답한다. 빌드는 nosniff 헤더와 명시적 404.html을 생성하며 API가 없는 경로를 첫 화면 HTML 200으로 바꾸지 않는다. COMMUNITY_API_ORIGIN이 남아 있어도 정지 모드에서는 빈 주소를 출력한다.

## 공개 자료

공개 허용목록은 scripts/build.mjs가 관리한다. market, market-display, industry, ai-statistics, ai-tokens, ai-disclosures, company-disclosures, company-market, today-picks, today-discussion, today-personas, comparison-history, epoch-ai, ripple의 JSON 14종과 검토된 data/debate/index.json·발행일별 토론만 배포한다. market-display와 ripple은 같은 저장된 시세에서 로컬 계산한다. 맨 상단 헤더 로고 오른쪽의 공통 지수는 모든 챕터에서 이미 읽은 스냅샷을 재사용하며 별도 요청·타이머를 만들지 않는다. 챕터를 전환해도 계속 표시하고 같은 저장값을 재사용한다. 자료 펼치기도 추가 수집이나 API 조회를 실행하지 않는다.

## 2026-11-08 복구 이력

이전 로컬 작업 폴더가 main보다 45커밋 뒤처진 것을 확인했다. 마지막 정상 Vercel 운영 소스 233d6fa1의 후손인 main 8a0eea41에서 복구했고 앱 커밋 5878245c로 정적 배포했다. 당시 703개 검사와 공개 111개 파일 해시·헤더 대조, 시세·커뮤니티 이벤트·추천 댓글·토론 투표 API의 404를 확인했다. 당시 고정 배포 주소는 https://d8a953fa.ai-chain-prototype.pages.dev/ 이다.

저장 자료는 기존 GitHub Pages의 555종목 시세(2026-11-06 기준), 비교 이력, 산업통계를 검증해 복원했다. 새로운 원천 가격을 수집하지 않았다. 승인된 기업정보 PC 14열 패치는 고정 배포 47729716의 두 파일과 일치시켰으며 미승인 네오클라우드 변경은 제외했다.

그 뒤 main에 추가된 상단 지수 띠(38e62af까지)와 복구 변경을 통합했다. 당시의 지수 위치는 챕터 메뉴 위 공통 영역이었다. 2026-11-08에는 지수를 홈 본문의 큰 **AI 시장 지도** H1 오른쪽의 소형 홈 전용 영역으로 옮겼다. 2026-11-09 사용자가 스크린샷으로 위치를 다시 확인해 맨 상단 헤더 로고 **AI Value Chain 시장 지도** 바로 오른쪽으로 옮겼으며, 이때는 홈 전용으로 표시했다. 같은 날 후속 요청으로 표시 범위를 모든 챕터의 공통 헤더로 넓히고 헤더 상태문구를 제거한다. 5개 저장 지수와 ⓘ 자료의 원래 날짜·출처는 유지하며 실제 실시간·수집 중지는 계속 적용한다. 과거 위치와 배포 파일·해시 기록은 당시 이력으로 보존한다. 이전의 미푸시·별도 로컬 경로 기록은 현재 개발 경로를 강제하는 지침이 아니다. 현재 기준은 최신 main과 해당 커밋에서 검증한 빌드다.

## 보존한 서버 코드

기존 vercel.json, api, 서버·수집·커뮤니티 패키징 코드는 보존한다. 추천 댓글 Blob나 별도 SQLite 데이터는 삭제하거나 이동하지 않는다. 정적 화면의 배포는 댓글·회원·AI 워커 운영 연결 또는 실제 모델 작동 완료를 의미하지 않는다.
