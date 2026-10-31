# AI 체인 프로젝트 폴더와 개발 기준

이 저장소 `ai-chain-prototype`에서 사이트 개발을 이어간다. 교육용 문서·수업 자료와 사이트 개발 파일을 분리하며, 소스·검증 근거·로컬 산출물도 각각 용도에 맞는 폴더에 둔다. 사이트 파일을 이전 교육 폴더에 새로 만들지 않는다.

## 폴더별 역할

```text
ai-chain-prototype/
├─ AGENTS.md                     작업 위치·파일 배치 기준
├─ README.md                     실행·기능·데이터·배포 개요
├─ PLAN.md                       사용자 목표·첫 출시 기준·남은 작업
├─ CLAUDE.md                     작업 인계·기준 문서 참조
├─ index.html                    Claude 원본 화면 기반의 사이트 진입점
├─ assets/                       화면 JavaScript·CSS·브라우저 검증기
├─ api/                          Vercel 읽기 전용 시세·스냅샷 함수
├─ server/                       시세 서비스·공용 스냅샷·커뮤니티 서버 코드
├─ scripts/                      실행·빌드·수집·운영 명령
│  ├─ build.mjs / serve.mjs      빌드·개발 서버 진입점
│  ├─ data/                     시세·산업·공시 수집과 검토 통계 생성
│  ├─ community/                커뮤니티 서버·계정·백업·AI 워커
│  ├─ deployment/               배포 준비·스냅샷 복원·패키징·연결 검사
│  └─ windows/                  로컬 AI 워커 작업 관리 스크립트
├─ tests/                        단위·HTTP·배포·브라우저 테스트
│  ├─ market/                   시세·차트·고리별 비교
│  ├─ data/                     산업·AI 통계·토큰·공시
│  ├─ community/                회원·댓글·AI·패키징·운영 연결
│  ├─ browser-smoke.py          브라우저 통합 검사
│  └─ helpers/                  테스트 전용 서버 등 보조 코드
├─ data/                         검증된 공개 스냅샷 8종 (Today·3년 비교 이력 포함)
├─ research/                     검토 통계 원본·공식 출처 확인 근거
│  └─ dart/                     DART 회사 연결 근거·RSS 형식 샘플
├─ docs/                         기능별 정의·수집 방식·운영 안내
│  ├─ README.md                 문서 찾아보기
│  ├─ project-structure.md      폴더 배치·개발 기준
│  ├─ data/                     시세·비교·산업·AI 통계·토큰·공시 정의
│  ├─ deployment/               Pages·Vercel·공개 스냅샷 배포
│  └─ community/                커뮤니티 현황·운영·서버 준비
│     └─ history/               과거 구현·검증 기록
├─ deploy/                       Caddy·systemd 등 운영 설정 예제
├─ design/                       Claude 원본 디자인 캔버스
├─ .github/workflows/            수집·테스트·Pages 배포 작업
├─ .local/                       Git에서 제외하는 로컬 작업물
│  ├─ README.md                 로컬 작업물 찾아보기
│  ├─ tmp/                      재생성 가능한 임시 작업 파일
│  ├─ screenshots/              개발·브라우저 검증 캡처
│  ├─ onboarding/oracle/        Oracle 가입 진행용 비공개 자료
│  ├─ archive/                  이전 작업 파일의 비공개 보관본
│  ├─ organization/             폴더 정리 목록·이동 검증 기록
│  ├─ review/                   PR 검토·작성용 로컬 메모
│  └─ releases/                 manifest가 있는 준비된 API 배포 패키지
└─ dist/                         빌드로 다시 만드는 공개 배포 파일
```

브라우저의 `assets/` 경로와 `api/` 주소, `server/`의 공용 모듈 위치는 유지한다. 실행 스크립트와 테스트·문서만 기능별로 묶었다. `npm run` 명령 이름은 그대로 사용하며, 스크립트를 직접 실행할 때는 위 하위 폴더 경로를 따른다. `scripts/data/collect-tsmc.mjs`·`official-trade.mjs` 같은 수집 보조 모듈도 실제 수집기에서 사용하는 파일이다. `server/community/http.mjs`는 로컬 개발 모드에서 사용하므로 공개용 처리 모듈과 이름이 비슷하다는 이유로 삭제하지 않는다.

새 수집기와 통계 생성기는 `scripts/data/`, 커뮤니티 실행 도구는 `scripts/community/`, 배포·패키징 도구는 `scripts/deployment/`에 추가한다. 테스트도 같은 기능의 하위 폴더에 넣고 `package.json`의 테스트 명령에 등록한다. 기능 설명은 `docs/data/` 또는 `docs/community/`에 두고 [문서 목록](README.md)에 연결한다.

새 테스트 fixture가 실제로 필요하면 `tests/fixtures/`에 추가한다. 현재 DART RSS 형식 샘플은 테스트가 읽는 입력이 아니므로 `research/dart/`에서 회사 연결 근거와 함께 보존한다. 과거 구현 설명은 `docs/community/history/`에 두고 현재 운영 문서와 구분한다.

### 주요 실행 모듈

| 경로 | 역할·정의 |
| --- | --- |
| `assets/dashboard.js`, `market-core.js`, `market.css` | 통합 종목·차트·관심종목 |
| `assets/instruments.js` | 화면과 수집기가 공유하는 시세 카탈로그 |
| `assets/peer-comparison-core.js`, `peer-comparison.js`, `peer-comparison.css` | 고리별 피어 비교 계산·화면 |
| `assets/company-profiles.js`, `company-directory.js` | 기업 역할·국가·공식 출처·목록 |
| `assets/ai-statistics.js`, `ai-statistics.css`, `ai-statistics-core.js` | AI 통계 화면·검증 |
| `assets/token-core.js`, `ai-disclosure-core.js` | 토큰 집계·발표자료 감시 상태 검증 |
| `assets/company-disclosure-sources.js`, `company-disclosures-core.js` | 국내 기업 DART 연결·메타데이터 검증 |
| `server/market.mjs`, `api/chart.js` | 단일 시세 조회·정규화·캐시·Vercel 진입점 |
| `server/ai-snapshots.mjs` | 공개 AI 통계·토큰·발표문·DART 스냅샷 API 공통 처리 |

기능별 출처·단위·계산·갱신 방식은 [전문 문서](README.md)를 따른다.

## 공개 데이터와 비공개 작업물

`data/`의 공개 파일은 `market.json`, `industry.json`, `ai-statistics.json`, `ai-tokens.json`, `ai-disclosures.json`, `company-disclosures.json`, `today-picks.json`이다. Today 파일은 실제 제공사 실행·수동 검토를 마친 종목별 추천·댓글만 담으며 초기값은 빈 미발행 상태다. 빌드의 명시적 허용목록과 검증을 통과한 파일만 `dist/data/`에 복사한다. `research/`, `docs/`, `deploy/`, `design/`, `.local/`을 공개 사이트에 통째로 복사하지 않는다.

`research/ai-statistics-2026-10-26.json`은 검토 통계의 재생성·테스트 입력이다. `research/dart/`는 공식 회사 연결 검증 근거와 당시 RSS 형식 샘플이다. 샘플의 날짜·공시 수를 현재 수집 상태로 읽지 않는다. 공개 스냅샷과 연구 원본을 구분하고 확인되지 않은 자료를 자동 승인하지 않는다. 예전 산업통계 작업의 원본 seed·다운로드는 `.local/archive/education-2026-10-27/industry-stats-work/export/`에 보관하며, 현재 실행은 통합된 `data/industry.json`과 공식 수집 모듈을 사용한다.

개인 캡처·가입 자료·로컬 로그·DB·환경 파일은 Git과 공개 빌드에서 제외한다. `.local/`의 릴리스·검증 기록·보관 원본은 용도를 확인하고 관리한다. `dist/`는 빌드 산출물이지만 `design/`은 보존할 원본이다.

일반 정리에서는 `dist/`와 용도가 끝난 개별 임시 파일·로그를 삭제 대상으로 확인한다. 사용자가 별도 삭제를 지정한 경우에는 정확한 경로와 의존관계를 확인한 범위에서 수행한다. `dist/`가 없으면 `npm run build` 또는 `npm run dev`로 다시 생성된다. `.local/archive/`의 파일이 현재 소스와 같더라도 보관 묶음과 이동 기록의 일부일 수 있으므로 중복만으로 삭제하지 않는다. 준비된 `.local/releases/`의 과거 경로와 manifest는 당시 배포본의 기록이므로 새 폴더 구조로 고쳐 쓰지 않는다.

AI 밸류체인 사이트의 개발은 저장소 루트에서만 이어간다. 로컬 검토 메모와 비공개 보관물은 Git·공개 빌드에서 제외하며 [로컬 안내](../.local/README.md)에서 찾는다.

## 개발과 확인

Node.js 24에서 저장소 루트를 작업 폴더로 사용한다.

```sh
npm run dev
npm test
npm run build
```

기본 개발 주소는 `http://127.0.0.1:5175`다. `npm run preview`와 `npm start`도 같은 서버를 실행한다. 모든 JavaScript 테스트는 `tests/`에 모았고 브라우저 smoke는 `tests/browser-smoke.py`가 담당한다. 외부 서비스를 호출하는 수집은 필요한 자료를 갱신할 때 실행하며, UI 재조회와 원천 수집을 혼동하지 않는다.

| 명령 | 역할 |
| --- | --- |
| `npm run collect` | 실제 시세·차트 스냅샷 수집 |
| `npm run collect:industry` | ECOS·TWSE 공식 산업통계 갱신 |
| `npm run build:statistics` | 검토 원본에서 승인된 AI 통계 재생성 |
| `npm run collect:tokens` | 키가 연결된 경우 OpenRouter 공식 공개 토큰 API 수집 |
| `npm run collect:disclosures` | OpenAI·Anthropic 공식 발표문 변경 감시 |
| `npm run collect:company-disclosures` | 국내 18개 기업의 DART 회사 RSS 메타데이터 수집 |
| `npm run community:package` | 영속 커뮤니티 API의 소스·SHA-256 manifest 패키지 생성 |
| `npm run community:check -- API_ORIGIN SITE_ORIGIN` | 실제 커뮤니티 HTTPS 연결의 읽기 전용 검사 |

## 상태의 확인

제품 목표·첫 출시 기준·남은 작업은 [PLAN](../PLAN.md), 커뮤니티 구현과 운영 준비는 [커뮤니티 현황](community/ai-community.md)을 따른다. Oracle 가입은 현재의 화면·데이터·테스트 개발의 필수 조건이 아니다. 코드와 테스트 구현을 운영 서버 연결이나 실제 모델 검증의 완료로 바꾸어 해석하지 않는다.

기능별 문서는 [문서 목록](README.md)에서 찾는다.
