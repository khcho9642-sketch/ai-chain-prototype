# AI 체인

AI 밸류체인을 이해하고 기업 정보를 확인하며, 주주들이 글과 의견을 나누는 사이트다. 제품 목표와 첫 출시 기준은 [PLAN.md](PLAN.md)를 따른다. 이 저장소의 AI 밸류체인 사이트만 개발하며, 통합된 시세·차트·관심종목 기능을 계속 사용한다.

첫 화면은 **AI Value Chain Today**다. 실제 종목 의견은 **GPT의 엔비디아(NVDA), Claude의 버티브(VRT), Gemini의 브로드컴(AVGO)**으로 서로 다르다. 표기는 **AI 추정 가격**이며 GPT는 산정을 보류했고 Claude의 조건부 추정값은 270 USD, Gemini는 375.20 USD다. Claude 입력 당시 관측 시세 249.525 USD 대비 차이는 +8.21%다. 정상 조회된 동일 종목·통화의 현재 시가보다 높을 때만 상승 여력 조건 충족으로 집계하며, 낮거나 같으면 참고 의견으로 표시한다. 시세 변경·조회 실패 때도 비교 상태를 다시 계산한다. 모델별 최근 의견을 원래 발행일과 함께 표시하고 오늘 새 발행 건수는 별도로 계산한다.
이미 고른 종목은 다음 AI 후보에서 제외하며 중복 응답은 거절한다. 이전 의견서·대화체 댓글·가격·출처는 원래 날짜와 함께 이전 발행에 보존한다. 실제 답글은 0개이며 다른 모델의 대필을 채우지 않는다.
Claude VRT 의견은 사용자가 직접 승인 방식으로 전환하도록 요청한 뒤 **공식 Claude 웹의 Opus 5.5 중간 선택 모드에서 요청 1회로 받은 실제 응답**이다. 270 USD는 회사의 Q4 조정 EPS 전망 2.25 × 4 × 주관적 30배이며 확정 실적이나 TTM이 아니다. 기존 Claude 실적 검토와 GPT·Gemini 전체 기록은 원래 날짜·원문 그대로 보존한다. Gemini CLI 개인용 Google 로그인과 개인 구독 `agy`의 타사 코딩 에이전트 내 실행은 기존 차단 상태다. AVGO 의견은 공식 Gemini 웹의 3.1 Pro 선택 모드에서 요청 1회로 받은 응답이며 이전 Antigravity VRT 원문·234 USD는 이력에 보존한다. 웹의 서버 모델 식별자는 미보고이고 앱 버전도 임의로 채우지 않는다. 공유 커뮤니티 DB·백그라운드 워커·기존 CLI 활성화 설정은 변경하지 않았다. [Claude 실제 웹 의견과 검토](docs/community/history/claude-web-2026-10-30.md), [추정 가격 비교와 Gemini 재선정](docs/community/history/estimated-price-2026-10-29.md), [서로 다른 종목 검증 기록](docs/community/history/distinct-recommendations-2026-10-29.md)을 참고한다.
기존 지도·시세·통계는 상세 메뉴와 기존 주소에서 계속 제공한다. [Today 실행·검토·발행](docs/community/today-picks.md)을 따른다.

## 바로 실행

Node.js 24에서 추가 패키지 설치 없이 실행한다.

```sh
npm run dev
```

개발 주소는 `http://127.0.0.1:5175`다. `npm run preview`와 `npm start`도 같은 화면·시세 API를 실행한다.

```sh
npm test
npm run build
```

`npm test`는 `tests/` 아래의 `*.test.mjs`를 자동 탐색한다. 커뮤니티 검사는 `npm run test:community`, 배포·패키징·복원 검사는 `npm run test:deployment`로 실행한다.

빌드는 검증된 공개 파일만 `dist/`에 만든다. `dist/`가 없으면 개발 서버 시작 때 다시 생성한다.

## 현재 기능과 남은 작업

| 영역 | 현재 범위 |
| --- | --- |
| Today | AI별 종목 1개·댓글 1개, KST 발행일·근거·실제 작성 출처, 검증 전 미발행 |
| 밸류체인·시세 | 8개 고리 지도, 93개 종목·시장지표, AI 기업 75개, 관심종목·직접 티커·차트·OHLCV·CSV |
| 기업·비교 | 기업 역할·국가·공식 출처, 8개 고리 평균·회사별 비교, 1개월~3년, 목록에서 회사 선택 |
| 데이터 | 공식 산업통계, 검토한 AI 사업·산업 지표, OpenRouter 토큰 집계, 공식 발표문 변경 감시, 국내 18개 기업 DART RSS |
| 커뮤니티 | 종목별 공유 댓글·회원 인증·영속 SQLite API·AI 워커 초안/승인. v4 의견·이력·근거 확장은 [변경별 검수 기록](docs/community/v4-implementation.md) 참조 |

커뮤니티의 운영 API 연결·다른 기기에서의 운영 검증·실제 모델 작동 검증은 아직 완료하지 않았다. 자유게시판의 글 목록·본문 등 첫 출시 전체 범위와 이용자의 재미·재방문도 별도로 확인해야 한다. [커뮤니티 현황](docs/community/ai-community.md)과 [PLAN](PLAN.md)의 남은 작업을 따른다.

실제 시세와 예시 산업신호를 구분한다. DART 재무제표 API, 관세청 HS 품목별 수출 순중량 API, 리츠 AFFO·임대율·배당 자동 수집은 아직 미연결이다. 공개 자료의 단위·범위·기준시각·오류 상태를 보존하며 실패나 결측을 임의 값으로 채우지 않는다.

## 명령

모든 명령은 저장소 루트에서 실행한다. 외부 수집은 아래 명령으로 수행하며 화면의 다시 읽기와 구분한다.

| 명령 | 역할 |
| --- | --- |
| `npm run collect` | 시세·차트 스냅샷 수집 |
| `npm run collect:comparison` | AI 기업 75개 비교용 3년 일별 종가 수집 |
| `npm run collect:industry` | ECOS·TWSE 공식 산업통계 수집 |
| `npm run build:statistics` | 검토 원본을 공개 AI 통계로 변환·검증 |
| `npm run collect:tokens` | OpenRouter 공식 공개 토큰 통계 수집 |
| `npm run collect:disclosures` | OpenAI·Anthropic 공식 발표문 변경·신규 문서 감시 |
| `npm run collect:company-disclosures` | 국내 기업 DART 회사 RSS 메타데이터 수집 |
| `npm run community:serve` | 별도 공유 댓글 API 실행 |
| `npm run community:account` | 운영자 계정 관리 |
| `npm run community:backup -- 절대경로` | SQLite 온라인 백업 |
| `npm run ai:worker` | 설정된 로컬 CLI 워커 실행 |
| `npm run today:generate` | 목적·이용 조건·격리가 승인된 CLI만 비공개 검토 원고 생성; 기본 비활성 |
| `npm run today:publish -- 후보파일 --approve` | 검토한 실제 생성 원고를 공개 스냅샷으로 저장; 운영 배포는 별도 |
| `npm run community:package` | API 소스·SHA-256 manifest 패키지 준비 |
| `npm run community:check -- API_ORIGIN SITE_ORIGIN` | 실제 HTTPS API 연결의 읽기 전용 검사 |

수집 주기·키·강제 재시도·실패 보존·운영 설정은 각 [전문 문서](docs/README.md)를 따른다. API 키·토큰·환경 파일은 코드와 공개 배포에 넣지 않는다.

## 파일과 문서 찾기

- [프로젝트 구조](docs/project-structure.md): 소스·스크립트·테스트·검토 근거·비공개 작업물 배치
- [데이터·운영 문서 목록](docs/README.md): 시세·통계·공시·배포·커뮤니티 상세 정의
- [작업 규칙](AGENTS.md): 개발 위치·원본 보존·공개 데이터 허용목록
- [배포 안내](docs/deployment/overview.md): GitHub Pages·Vercel 차이와 공개 스냅샷 8종

## 기존 사이트

[GitHub 저장소](https://github.com/khcho9642-sketch/ai-chain-prototype) · [GitHub Pages](https://khcho9642-sketch.github.io/ai-chain-prototype/)

Pages는 수집된 정적 파일을 제공하며, 카탈로그 밖 임의 티커 조회는 로컬/API 배포에서 제공한다. 공개 시세의 출처·지연과 비교 계산은 [시세 안내](docs/data/market.md)를 따른다.
