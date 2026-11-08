# Cloudflare 정적 사이트와 공통 소스 기준

## 현재 개발·운영 기준

- 운영 주소: https://ai-chain-prototype.pages.dev/
- 공통 소스: https://github.com/khcho9642-sketch/ai-chain-prototype 의 최신 main을 반영한 작업 사본. 특정 컴퓨터의 절대 경로나 무시되는 임시 폴더를 공통 기준으로 삼지 않는다.
- 최신 화면 복구와 상단 저장 지수 띠를 함께 유지한다. 개발 채팅마다 현재 브랜치·HEAD·미커밋 변경을 확인하며, 기존 작업을 보존하고 최신 main에서 독립 worktree로 이어갈 수 있다.
- 2026-11-08 사용자 요청으로 Qualcomm(QCOM, C0371)을 AI 칩 핵심에 추가한다. 현재 선정 기준은 핵심 50개(상장 47·비상장 3), AI 칩 6개이며 전체 회사 원장은 586개로 유지한다. 원본 ‘핵심기업 49’ 시트·`research/market/home-map-selection.json`·원본 시트명·SHA-256은 보존하고, `research/market/home-map-additions.json`의 사용자 추가를 원본 뒤 순서 50으로 합성한다. 과거 배포 이력의 49개와 원장 비상장 49개는 이 변경으로 바꾸지 않는다.
- 실시간 시세·원천 수집·자동 폴링·댓글·회원·투표 API·SSE·AI 워커는 중지한다. GitHub 수집 워크플로는 disabled_manually 상태를 유지한다.

## 검증과 수동 배포

1. 저장소 루트에서 git fetch origin main 후 현재 브랜치와 원격 main의 차이를 확인한다. 미커밋 변경을 임의로 reset하거나 다른 채팅의 공유 브랜치를 바꾸지 않는다.
2. 관련 검사와 npm test, npm run build를 실행한다. 빌드는 저장 자료의 검증과 로컬 파생 계산만 수행한다. 외부 수집 명령이나 과거 Vercel 준비 스크립트를 실행하지 않는다.
3. 검증한 dist만 기존 Cloudflare Pages 프로젝트 ai-chain-prototype에 업로드한다. Git 커밋과 배포 메타데이터를 일치시키고 비공개 원본·DB·환경파일·.local은 올리지 않는다.
4. 공개 파일 해시·저장 자료의 기준일·필수 화면 모듈·실시간 API 차단을 확인한다. 코드·테스트·운영 배포와 실제 AI 모델 검증을 별도로 기록한다.

~~~sh
npm test
npm run build
npx wrangler pages deploy dist --project-name ai-chain-prototype --branch main
~~~

wrangler.jsonc는 Pages 프로젝트와 dist 출력 폴더를 지정한다. 빌드는 nosniff 헤더와 명시적 404.html을 생성하며 API가 없는 경로를 첫 화면 HTML 200으로 바꾸지 않는다. COMMUNITY_API_ORIGIN이 남아 있어도 정지 모드에서는 빈 주소를 출력한다.

## 공개 자료

공개 허용목록은 scripts/build.mjs가 관리한다. market, market-display, industry, ai-statistics, ai-tokens, ai-disclosures, company-disclosures, company-market, today-picks, today-discussion, today-personas, comparison-history, epoch-ai, ripple의 JSON 14종과 검토된 data/debate/index.json·발행일별 토론만 배포한다. market-display와 ripple은 같은 저장된 시세에서 로컬 계산한다. 상단 지수 띠는 이미 읽은 스냅샷을 재사용하며 별도 요청·타이머를 만들지 않는다.

## 2026-11-08 복구 이력

이전 로컬 작업 폴더가 main보다 45커밋 뒤처진 것을 확인했다. 마지막 정상 Vercel 운영 소스 233d6fa1의 후손인 main 8a0eea41에서 복구했고 앱 커밋 5878245c로 정적 배포했다. 당시 703개 검사와 공개 111개 파일 해시·헤더 대조, 시세·커뮤니티 이벤트·추천 댓글·토론 투표 API의 404를 확인했다. 당시 고정 배포 주소는 https://d8a953fa.ai-chain-prototype.pages.dev/ 이다.

저장 자료는 기존 GitHub Pages의 555종목 시세(2026-11-06 기준), 비교 이력, 산업통계를 검증해 복원했다. 새로운 원천 가격을 수집하지 않았다. 승인된 기업정보 PC 14열 패치는 고정 배포 47729716의 두 파일과 일치시켰으며 미승인 네오클라우드 변경은 제외했다.

그 뒤 main에 추가된 상단 지수 띠(38e62af까지)와 복구 변경을 통합한다. 이전의 미푸시·별도 로컬 경로 기록은 당시 이력이며 현재 개발 경로를 강제하는 지침이 아니다. 현재 기준은 최신 main과 해당 커밋에서 검증한 빌드다.

## 보존한 서버 코드

기존 vercel.json, api, 서버·수집·커뮤니티 패키징 코드는 보존한다. 추천 댓글 Blob나 별도 SQLite 데이터는 삭제하거나 이동하지 않는다. 정적 화면의 배포는 댓글·회원·AI 워커 운영 연결 또는 실제 모델 작동 완료를 의미하지 않는다.
