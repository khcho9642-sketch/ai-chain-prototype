# AI 체인 프로젝트 폴더와 개발 기준

이 저장소 `ai-chain-prototype`에서 사이트 개발을 이어간다. 교육용 문서·수업 자료와 사이트 개발 파일을 분리하며, 소스·검증 근거·로컬 산출물도 각각 용도에 맞는 폴더에 둔다. 사이트 파일을 이전 교육 폴더에 새로 만들지 않는다.

## 폴더별 역할

```text
ai-chain-prototype/
├─ AGENTS.md                     작업 위치·파일 배치 기준
├─ README.md                     실행·기능·데이터·배포 개요
├─ PLAN.md                       사용자 목표·첫 출시 기준·남은 작업
├─ CLAUDE.md                     기존 작업 인계 메모
├─ index.html                    Claude 원본 화면 기반의 사이트 진입점
├─ assets/                       화면 JavaScript·CSS·브라우저 검증기
├─ api/                          Vercel 읽기 전용 시세·스냅샷 함수
├─ server/                       시세 서비스·공용 스냅샷·커뮤니티 서버 코드
├─ scripts/                      실행·빌드·수집·운영 명령
│  └─ windows/                   로컬 AI 워커 작업 관리 스크립트
├─ tests/                        단위·HTTP·배포·브라우저 테스트
│  ├─ helpers/                   테스트 전용 서버 등 보조 코드
│  └─ fixtures/                  공개·비식별 테스트 입력 자료
├─ data/                         검증된 공개 스냅샷 6종
├─ research/                     검토 통계 원본·공식 출처 확인 근거
│  └─ dart/                      DART 종목코드·회사 연결 확인 근거
├─ docs/                         기능별 정의·수집 방식·운영 안내
├─ deploy/                       Caddy·systemd 등 운영 설정 예제
├─ design/                       Claude 원본 디자인 캔버스
├─ .github/workflows/            수집·테스트·Pages 배포 작업
├─ .local/                       Git에서 제외하는 로컬 작업물
│  ├─ tmp/                      재생성 가능한 임시 작업 파일
│  ├─ screenshots/              개발·브라우저 검증 캡처
│  ├─ onboarding/oracle/        Oracle 가입 진행용 비공개 자료
│  ├─ archive/                  이전 작업 파일의 비공개 보관본
│  ├─ organization/             폴더 정리 목록·이동 검증 기록
│  └─ releases/                 manifest가 있는 준비된 API 배포 패키지
└─ dist/                         빌드로 다시 만드는 공개 배포 파일
```

런타임 경로는 기존 구조를 유지한다. 테스트만 `tests/`로 모았으며 실행 코드와 API 주소를 조직 정리 목적으로 바꾸지 않는다. `scripts/collect-tsmc.mjs`·`official-trade.mjs` 같은 수집 보조 모듈도 실제 수집기에서 사용하는 파일이다. `server/community/http.mjs`는 로컬 개발 모드에서 사용하므로 공개용 처리 모듈과 이름이 비슷하다는 이유로 삭제하지 않는다.

## 공개 데이터와 비공개 작업물

`data/`의 공개 파일은 `market.json`, `industry.json`, `ai-statistics.json`, `ai-tokens.json`, `ai-disclosures.json`, `company-disclosures.json`이다. 빌드의 명시적 허용목록과 검증을 통과한 파일만 `dist/data/`에 복사한다. `research/`, `docs/`, `deploy/`, `design/`, `.local/`을 공개 사이트에 통째로 복사하지 않는다.

`research/ai-statistics-2026-10-26.json`은 검토 통계의 재생성·테스트 입력이다. `research/dart/`는 공식 회사 연결 검증 근거다. 공개 스냅샷과 연구 원본을 구분하고 확인되지 않은 자료를 자동 승인하지 않는다. 예전 산업통계 작업의 원본 seed·다운로드는 `.local/archive/education-2026-10-27/industry-stats-work/export/`에 보관하며, 현재 실행은 통합된 `data/industry.json`과 공식 수집 모듈을 사용한다.

개인 캡처·가입 자료·로컬 로그·DB·환경 파일은 Git과 공개 빌드에서 제외한다. `.local/`의 릴리스·검증 기록·보관 원본은 용도를 확인하고 관리한다. `dist/`는 빌드 산출물이지만 `design/`은 보존할 원본이다.

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

## 현재 구현과 운영 연결 상태

주가·차트·관심종목·8개 고리 피어 비교·기업 목록·산업통계·AI 통계가 같은 화면과 데이터 구조를 사용한다. DART 공식 RSS는 2026-10-27 01:27 KST 수집본에서 국내 18개 기업 확인·공시 24건을 검증했다. 이는 해당 시점에 수집해 보존한 메타데이터 수이며 전체 과거 공시나 DART 재무제표 API 연결을 뜻하지 않는다. 현재 성공 여부와 시각은 `data/company-disclosures.json`에서 확인한다.

종목별 공유 댓글·회원 인증·영속 SQLite API·AI 워커의 초안·승인 흐름은 개발 코드와 테스트에 구현했다. 운영 API 서버·도메인 연결 및 실제 모델의 작동 검증은 아직 완료하지 않았다. Oracle 가입은 현재 개발의 필수 조건으로 취급하지 않으며, 서버 연결 없이도 데이터·화면·테스트 개발을 계속할 수 있다. 댓글 구현을 자유게시판의 글 목록·본문 등 모든 출시 기능의 완료로 확대하지 않는다.

기능별 문서: [국내 기업 공시](company-disclosures.md), [산업통계 출처](industry-sources.md), [AI 발표문 감시](ai-disclosure-collection.md), [커뮤니티 구현 상태](ai-community.md), [공유 API 운영 가이드](ai-community-public.md), [Oracle 서버 준비](oracle-community-quickstart.md).
