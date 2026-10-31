# 정적 사이트·스냅샷·API 배포

## 기존 배포와 시세 제공

- [GitHub 저장소](https://github.com/khcho9642-sketch/ai-chain-prototype)

- [GitHub Pages](https://khcho9642-sketch.github.io/ai-chain-prototype/)

- GitHub Actions가 약 30분마다 같은 시세 모듈로 수집해 Pages에 배포한다. 예약 실행은 지연될 수 있다. 브라우저의 다시 조회는 배포된 최신 파일을 읽는다.

- Vercel 설정은 API와 dist를 함께 배포한다. prepare-deployment.mjs가 Pages의 최신 93종목 스냅샷을 가져온 뒤 빌드한다. 저장소에 넣은 JSON은 초기 스냅샷이고 이후 예약 수집 결과는 배포 아티팩트에 담긴다.

- Vercel의 /api/snapshot은 Pages에서 갱신된 최신 파일을 프록시하므로 재배포 없이 목록의 예약 갱신도 반영된다. Vercel GitHub 앱 권한이 없어 최초 API 배포는 검증한 소스 파일을 직접 업로드한다.

- API 키·토큰·환경 파일은 코드나 배포 파일에 포함하지 않는다.

시세의 출처·수집시각·정적 호스팅과 임의 티커 API의 차이는 [시세 안내](../data/market.md)를 따른다. Vercel 준비 명령의 현재 경로는 `scripts/deployment/prepare-deployment.mjs`다. 기존 프로젝트·도메인·인증 보호를 유지한다.

## 공개 파일과 예약 갱신

`scripts/build.mjs`의 `publicSnapshotFiles` 허용목록은 기존 7개와 비교용 3년 일봉 1개를 합한 8개다. 빌드 시 검증한 뒤 `dist/data/`로 복사하며 `research/`, 원본 자료, 환경 파일과 임의의 추가 JSON은 공개하지 않는다.

| 공개 JSON | 내용 |
| --- | --- |
| `market.json` | 93개 종목·시장지표 시세 |
| `comparison-history.json` | AI 기업 75개 비교용 3년 일별 종가·실제 수집시각·실패 상태 |
| `industry.json` | 기존 공식 산업통계 12개 |
| `ai-statistics.json` | 검토한 AI 통계 81개 정의·88개 표시 행 |
| `ai-tokens.json` | OpenRouter 검토 스냅샷 또는 공식 API 수집 결과와 상태 |
| `ai-disclosures.json` | 공식 문서 확인 상태와 검토 후보 |
| `company-disclosures.json` | 국내 18개 기업의 DART 공시 메타데이터·수집 상태 |
| `today-picks.json` | 검토한 실제 AI별 추천·실적 검토·발행 댓글·보존한 이전 원문 또는 미발행 상태 |

`.github/workflows/market-pages.yml`은 기존 약 30분 간격 Pages 작업에서 이전 토큰·문서 감시·국내 기업 공시 상태를 검증해 복원하고 세 수집기를 실행한다. 토큰·AI 발표문 감시는 각각의 일일 호출 기준을, 국내 기업 공시는 15분 재시도 간격을 관리한다. 수집 오류 시 이전 자료를 배포할 수 있도록 수집 단계는 실패 후에도 진행하며, 최종 빌드의 자료 검증은 유지한다. 승인된 `ai-statistics.json`은 Git에서 관리하고, 배포된 과거 파일로 덮어쓰거나 문서 감시 결과로 자동 승인하지 않는다. 예약 실행은 지연될 수 있다.

읽기 전용 경로는 `/api/ai-statistics`, `/api/ai-tokens`, `/api/ai-disclosures`, `/api/company-disclosures`다. 로컬 서버는 해당 로컬 JSON을 제공하고, Vercel 함수는 Pages의 같은 이름 JSON을 조회·검증해 제공한다. 이 경로들은 OpenRouter·DART를 직접 호출하거나 매출·사용자 수를 새로 수집하지 않는다. Pages 자체는 정적 `data/` 파일을 제공한다. API 조회 실패와 자료의 마지막 성공 시점을 구분한다.

배포 순서는 테스트·빌드 → GitHub main 푸시 → Pages 성공 및 93개 시세·기존 산업통계 12개·AI 통계와 공개 JSON 8종 확인 → 동일 커밋 소스의 Vercel production 배포다. 기존 프로젝트·도메인·인증 보호를 유지한다.

Today는 `data/today-picks.json`을 읽는 정적 발행 화면이다. 조회·다시 읽기는 모델을 호출하지 않는다.
이 파일은 기존 시세 수집·복원 작업에서 덮어쓰지 않으며, 승인된 공식 CLI 원고를 사람이 검토한 뒤 수동 발행한다.
원고 생성·로컬 공개 파일 저장·운영 배포는 각각 다른 단계다. v3 일회성 발행본은 GPT·Gemini의 종목 의견과 Claude의 실적 검토를 실제 출처·정정 내용과 함께 읽기 전용 댓글로 표시한다. 이 발행은 워커 활성화가 아니며 기존 제공사 자동 실행 차단 상태를 유지한다.

## 커뮤니티 서버 배포 준비

기존 댓글·회원·AI 워커 구현은 별도 Node24+영속 SQLite 서버를 사용한다. `npm run community:package`는 API 실행에 필요한 공개 소스만 `.local/releases/`에 패키징하고 파일별 SHA-256을 기록한다. 서버·계정·방화벽을 설치하거나 변경하지 않는다. 실제 서버의 읽기 전용 연결 검사는 `npm run community:check -- https://API도메인 https://웹도메인`이다. [Oracle 계정부터 시작하는 안내](../community/oracle-community-quickstart.md)를 참고한다. 실제 운영 연결과 모델 활성화는 아직 준비 단계다.


비교용 이력은 기존 예약 작업에서 `restore-ai-snapshots.mjs --with-comparison`으로 검증된 이전 파일을 복원한 뒤 `npm run collect:comparison`으로 갱신한다. 로컬 파일보다 오래된 전체·종목 수집시각은 복원하지 않는다. 수집 전체 실패·응답 크기 제한 때는 이전 파일을 보존한다. Vercel 준비 단계도 같은 선택 복원을 사용한다. `/api/comparison-history`는 Pages의 검증된 파일을 프록시하며 원천 주가를 수집하지 않는다. 이 파일의 원문과 API 응답은 4,000,000바이트 이내로 제한한다. Vercel의 함수 응답 한도는 [공식 문서](https://vercel.com/docs/functions/limitations)를 따른다.
