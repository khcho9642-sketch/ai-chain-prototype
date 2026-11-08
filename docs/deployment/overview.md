# Cloudflare 정적 사이트·최신 소스 복구

## 현재 상태 — 2026-11-08 KST

Cloudflare 이전에 사용한 로컬 `4e0533e7a8262116b0b9df72d2c3eec2b752f7ed`는 최신 GitHub main보다 45커밋 오래된 상태였다. 최신 홈 지도·공동 움직임·오늘의 토론·섹터 이벤트·시나리오·기업정보 코드가 빠진 배포를 최신 소스로 복구하고 운영 검증을 완료했다.

복구 기준은 GitHub main **`8a0eea41ce08b43ef0e859916d0ce6f87cda3d85`**다. 마지막 정상 Vercel 운영본 `233d6fa1893c6a2be35068d70ff891ee3b866df2`의 후손이며 3커밋 앞인 것을 확인했다. 해당 Vercel 배포는 `dpl_A2yPkZdDdW5Y5m5Ke24PeQunFQ3B`, 배포 시각은 2026-11-07 00:56 KST다. 최신 소스에는 이후의 원천 시장 수집 중지와 핵심 49개·비교 586개 회사 개편도 포함된다.

현재 앱 소스는 `5878245c7efb5214a64f463707cbe3421b950f2a`, 브랜치는 `fix/cloudflare-latest-static-20261108`, 작업공간은 `C:/Users/khcho/Documents/개발프로젝트/ai-chain-prototype/.local/tmp/cloudflare-latest-8a0eea41`다. 45커밋 오래된 부모 루트 `4e0533e7`은 기존 작업 보존용이므로 그곳에서 재빌드·재배포하지 않는다. 기존 사용자 수정, 미승인 변경, 원본·DB·이전 배포본은 보존했고 GitHub 푸시·병합은 하지 않았다.

운영 주소는 [ai-chain-prototype.pages.dev](https://ai-chain-prototype.pages.dev/), 고정 배포 주소는 [d8a953fa.ai-chain-prototype.pages.dev](https://d8a953fa.ai-chain-prototype.pages.dev/)다. 사전 미리보기 배포 식별자는 `fdee60be`이며 최종 운영 배포는 `d8a953fa`다.

## 완료한 검증

- 테스트 **703/703개**가 통과했다.
- 운영 공개 **111개 파일 전체**의 SHA-256이 로컬 빌드와 같고 `X-Content-Type-Options: nosniff` 헤더를 확인했다. 공개 출력은 HTML 2개·assets 93개·스냅샷 14개·토론 발행물 2개다.
- `/api/chart`, `/api/community/events`, `/api/recommendation-comments`, `/api/debate-votes`의 4개 경로는 모두 404였다. 실시간 기능은 다시 켜지 않았다.
- 마지막 정상 Vercel 원본과 `home-focus.js`, `home-performance.js`, `scenario-profit-check.js`, `sector-event-pins.js` 4개 파일이 일치한다.
- 시장 저장본은 **555종목·11월 6일 자료 기준**으로 복원했다. 핵심 49개·전체 586개 회사와 승인된 PC 14열 스타일을 보존했고 미승인 네오클라우드 변경은 제외했다.

위 확인은 최신 정적 사이트의 운영 배포와 파일 무결성에 관한 것이다. 댓글·회원·투표 API와 AI 워커 운영 연결은 계속 중지·미완료 상태다.

## 실시간 중지와 자동 작업

- `assets/site-runtime.js`의 공통 정적 모드와 기존 `assets/market-data-policy.js`의 시세 수집·실시간 요청·자동 새로고침 중지 정책을 함께 유지한다.
- 시장 시세는 `data/market-display.json`의 경량 저장본을 최초 한 번 읽고 로컬에서 계산한다. 클릭·기간 전환·수동 새로고침으로 원천 시세를 다시 다운로드하지 않는다.
- 통계·공시·Epoch AI·기업 시세는 검증된 정적 JSON을 읽는다. Cloudflare에서 `/api/*`를 먼저 호출하던 호스트 판별은 공통 정적 모드로 바꿨다.
- 댓글·회원·투표 API·실시간 이벤트·AI 워커는 중지한다. 이미 발행된 Today·AI 교차 의견·토론 자료는 보존한다.
- 원격 `market-pages.yml` 워크플로(ID `396185253`)는 `disabled_manually` 상태를 유지한다. 이를 임의로 재개하지 않는다. 로컬 AIChain 워커 예약 작업과 실행 프로세스는 없는 것을 확인했다.

격리 사본의 `.github/workflows/market-pages.yml`은 원천 수집·원격 스냅샷 복원·커뮤니티 주소 환경 설정 없이 테스트·정적 빌드·GitHub Pages 보조 배포만 수행하도록 정리했다. `main` 푸시와 수동 실행 정의는 남지만 원격 워크플로의 중지 상태와 소스 변경 반영은 별개다. Cloudflare 자동 배포와 DNS 변경은 구성하지 않는다.

## Cloudflare 배포 절차

프로젝트는 `ai-chain-prototype`, 배포 대상은 검증된 `dist/`다. 이후 배포도 기존 Pages 프로젝트를 사용한다.

```sh
npm test
npm run build
npx wrangler pages deploy dist --project-name ai-chain-prototype
```

실제 배포 전 대상 계정·최신 고정 커밋·공개 파일과 실시간 중지 동작을 확인한다. 최신화본의 운영 배포와 검증은 위 완료 기록을 따르며, 이후 배포도 이 절차로 진행한다. 기존 Vercel 준비 명령 `scripts/deployment/prepare-deployment.mjs`는 외부 갱신 경로가 있으므로 이번 정적 복구 빌드에서 실행하지 않는다. Vercel 함수나 서버·DB를 Cloudflare로 자동 이전하지 않는다.

정적 출력에는 `X-Content-Type-Options: nosniff`용 `_headers`와 명시적인 `404.html`을 포함한다. 누락된 `/api/*`와 비공개 소스 경로가 첫 화면 HTML의 200 응답으로 바뀌지 않는지 확인한다. 화면 전환은 기존 해시 주소를 유지한다. [Cloudflare 정적 HTML 배포](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/), [헤더 설정](https://developers.cloudflare.com/pages/configuration/headers/), [404 처리](https://developers.cloudflare.com/pages/configuration/serving-pages/)를 따른다.

## 공개 자료와 저장본 보존

최신 소스의 공개 스냅샷 허용목록은 다음 14종이다. `market-display.json`과 `ripple.json` 등 파생 자료는 빌드에서 저장된 원본으로 계산하며 원천 시세를 수집하지 않는다. 검증된 토론 발행 파일은 별도 `data/debate/`에 포함한다. 최종 공개 파일 111개는 실제 빌드 결과와 운영 응답을 대조해 확인했다.

| 공개 JSON | 내용 |
| --- | --- |
| `market.json` | 저장된 시세·일봉·시총 근거 |
| `market-display.json` | 화면 최초 조회용 경량 종가 저장본 |
| `comparison-history.json` | 고리·종목 비교용 장기 일별 종가·수집 상태 |
| `company-market.json` | 기업 비교용 시세·시총·재무 자료와 기준일 |
| `ripple.json` | 동일 종가 자료에 대응하는 공동 움직임 계산 결과 |
| `industry.json` | 공식 산업통계 저장본 |
| `ai-statistics.json` | 검토한 AI 통계 |
| `ai-tokens.json` | OpenRouter 토큰 통계 저장본과 상태 |
| `epoch-ai.json` | Epoch AI 공개 데이터의 선택 열·출처·수집 상태 |
| `ai-disclosures.json` | 공식 문서 확인 상태와 검토 후보 |
| `company-disclosures.json` | 국내 기업의 DART 공시 메타데이터와 수집 상태 |
| `today-picks.json` | 검토한 실제 AI별 의견·추천·이전 원문 |
| `today-discussion.json` | 원본 추천과 연결된 검토한 AI 교차 의견 |
| `today-personas.json` | 검토한 분석 표현·AI 대화 원문과 출처 |

자료의 저장·수집·관측 시각은 원래 상태를 보존하고 현재 시세나 오늘 새 발행으로 바꾸지 않는다. 최신 저장본 확인은 원천 자료 수집과 구분한다. `research/`, `docs/`, 환경 파일, 원본 검토 자료, DB와 `.local/`은 공개 빌드에 통째로 복사하지 않는다.

## 보존하는 기존 주소와 서버 구현

- [GitHub 저장소](https://github.com/khcho9642-sketch/ai-chain-prototype)
- [GitHub Pages 보조 주소](https://khcho9642-sketch.github.io/ai-chain-prototype/)

기존 `vercel.json`, `api/`, 공용 서버·수집·커뮤니티 패키징 코드는 보존한다. 추천 댓글의 Vercel Blob와 별도 커뮤니티 SQLite 데이터를 삭제하거나 옮기지 않는다. 정적 화면 복구는 댓글·회원·AI 워커의 운영 연결과 실제 모델 작동 검증을 완료했다는 의미가 아니다. [커뮤니티 현황](../community/ai-community.md)을 따른다.
