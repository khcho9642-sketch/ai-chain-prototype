# AI 체인

AI 밸류체인을 이해하고 기업 정보를 확인하며, 주주들이 글과 의견을 나누는 사이트다. 제품 목표와 첫 출시 기준은 [PLAN.md](PLAN.md)를 따른다. 이 저장소의 AI 밸류체인 사이트만 개발하며, 통합된 시세·차트·관심종목 기능을 계속 사용한다.

## 현재 운영과 개발 기준

- [Cloudflare 운영 사이트](https://ai-chain-prototype.pages.dev/)와 GitHub의 최신 main을 공동 기준으로 사용한다. 다른 개발 채팅도 최신 main을 반영한 작업 사본에서 이어간다. 컴퓨터마다 다른 로컬 경로를 공통 지침으로 지정하지 않는다.
- 공통 헤더는 나스닥·S&P 500·코스피·CXMT(688825.SS)·코스닥 순으로 저장 시세를 표시한다. CXMT는 중국 상하이 상장 개별 종목이다. 2026-11-09 확인한 위치는 맨 상단 헤더 로고 **AI Value Chain 시장 지도** 바로 오른쪽이다. 모든 챕터의 공통 헤더에 계속 제공하며 모바일도 같은 최상단 로고 옆 영역에서 가로로 넘겨 본다. 헤더의 “실시간 갱신 중지 · 저장된 종가” 문구는 제거하고 각 **ⓘ 자료** 버튼에서 원래 날짜·출처·저장 상태를 펼쳐 확인한다. 실제 실시간·수집·API·폴링 중지는 유지한다. 추가 수집이나 자동 재조회는 하지 않는다. 핵심 52개(상장 48·비상장 4)·효과적 전체 587개 기업(원본 586+사용자 신규 1)과 승인된 PC 14열 배치를 유지한다.
- 2026-11-08 사용자 요청으로 기존 전체 목록의 Qualcomm(QCOM, C0371)을 AI 칩 핵심에 추가했다. 원본 ‘핵심기업 49’ 시트와 `research/market/home-map-selection.json`·시트 출처·SHA-256은 보존하며, 별도 `research/market/home-map-additions.json`의 사용자 추가 근거를 합성한다.
- 2026-11-08 사용자 후속 요청으로 CXMT(C0119)를 메모리 핵심에 추가한다. 사용자 추가 순서는 QCOM 50번을 보존하고 CXMT 51번으로 이어진다. 메모리 6개·AI 칩 6개이며 이 편입 당시 원본 49개와 회사 원장 586개를 유지했다. 이 원본은 이후 사용자 신규 회사와 분리해 보존한다. CXMT의 상장 코드 `688825`는 [회사 공식 소개](https://www.cxmt.com/en/about.html)와 [상하이거래소 상장 공고](https://www.sse.com.cn/disclosure/announcement/listing/ipo/c/c_20260724_10826610.shtml)로 확인하며, 제공처 연결 티커는 `688825.SS`다. 새 시세는 수집하지 않는다.
- 2026-11-08 사용자 요청으로 영국 비상장 Nscale(C0587)을 클라우드·GPU 컴퓨팅 핵심의 순서 52로 추가한다. `research/market/company-additions.json`에 신규 회사 1개를, `research/market/home-map-additions.json`에 핵심 선정 근거를 분리한다. 클라우드·GPU는 7개(상장 6·비상장 1), AI 모델은 기존 5개(상장 2·비상장 3)다. [공식 서비스 소개](https://www.nscale.com/service-overview)를 근거로 클라우드·GPU 컴퓨팅에 분류한다. [IPO 신청 발표](https://www.nscale.com/press-releases/nscale-files-initial-public-offering)의 `NSCL`은 제안 티커이며, 작업 시점 [SEC 제출 메타데이터](https://data.sec.gov/submissions/CIK0002110365.json)의 `tickers`·`exchanges`가 빈 배열인 상태를 기준으로 비상장으로 둔다. `NSCL`을 상장 티커나 시세 조회 대상으로 연결하지 않는다.
- 실시간 시세·원천 자동 수집·폴링·댓글·투표·기존 커뮤니티 회원 API·AI 워커는 중지 상태다. 기존 종가·통계·AI 발행물은 기준일과 출처를 보존한다.
- 2026-11-09 [Google 로그인](docs/community/google-login.md)을 별도 `/api/auth/*`로 운영 배포했고, 실제 계정의 로그인 상태·새로고침 후 유지·로그아웃을 확인했다. Google 앱은 외부 사용자용 프로덕션으로 전환했으며 공개 전환 후 추가 재로그인 시험은 미완료다. 닉네임용 운영 DB 마이그레이션과 `48a9e07` 운영 배포를 완료했으며, 닉네임 직접 변경을 포함한 최종 운영본은 `973f87c`([262aa997](https://262aa997.ai-chain-prototype.pages.dev/))이다. 로컬의 실제 백엔드와 별도 테스트 계정으로 닉네임 저장·새로고침 유지·로그아웃을 확인했으며, 운영 실계정의 닉네임 저장과 새 Google 계정의 전체 가입 흐름은 시험하지 않았다. 사용자 후속 요청인 내 계정의 닉네임 직접 변경도 운영 배포했다. 전체 778개 테스트와 로컬 테스트 계정의 현재값 표시·취소·변경 저장·새로고침 유지·로그아웃을 확인했다. 운영 실사용자의 닉네임은 임의로 수정하지 않았다. Google 인증 뒤 추가 입력은 닉네임 하나이며 실명·이메일을 사이트의 회원 표시·내 계정·회원 API 응답에 포함하지 않는다. Google이 제공하는 로그인 버튼·계정 선택 화면에는 Google 이름·이메일이 표시될 수 있다. 기존 실시간 기능은 계속 중지한다.
- 작업 시작 시 Git 상태와 [공통 작업 안내](AGENTS.md)를 읽는다. 기존 미커밋 작업을 보존하며 오래된 폴더를 그대로 재배포하지 않는다. [배포 절차와 검증 이력](docs/deployment/overview.md)을 따른다.

## 기존 Today 발행 기록

첫 화면은 **AI 시장 지도**이며, **AI Value Chain Today**는 오늘의 변화 메뉴에서 제공한다. 실제 종목 의견은 **GPT의 엔비디아(NVDA), Claude의 버티브(VRT), Gemini의 브로드컴(AVGO)**으로 서로 다르다. 표기는 **AI 추정 가격**이며 2026-11-04 새 GPT의 조건부 추정값은 222 USD(PER 민감도 195.36~248.64 USD), Claude는 270 USD, Gemini는 375.20 USD다. GPT는 회사 Q2 조정 EPS 2.22 × 4 × 주관적 PER 25배를 사용하며 TTM·공식 연간 전망이 아니다. [GPT 새 추정과 검산](docs/community/nvda-estimate-2026-11-04.md)을 참고한다. Claude 입력 당시 관측 시세 249.525 USD 대비 차이는 +8.21%다. 정상 조회된 동일 종목·통화의 현재 시가보다 높을 때만 상승 여력 조건 충족으로 집계하며, 낮거나 같으면 참고 의견으로 표시한다. 시세 변경·조회 실패 때도 비교 상태를 다시 계산한다. 모델별 최근 의견을 원래 발행일과 함께 표시하고 오늘 새 발행 건수는 별도로 계산한다.
이미 고른 종목은 다음 AI 후보에서 제외하며 중복 응답은 거절한다. 이전 의견서·대화체 댓글·가격·출처는 원래 날짜와 함께 이전 발행에 보존한다. 실제 답글은 0개이며 다른 모델의 대필을 채우지 않는다.
Claude VRT 의견은 사용자가 직접 승인 방식으로 전환하도록 요청한 뒤 **공식 Claude 웹의 Opus 5.5 중간 선택 모드에서 요청 1회로 받은 실제 응답**이다. 270 USD는 회사의 Q4 조정 EPS 전망 2.25 × 4 × 주관적 30배이며 확정 실적이나 TTM이 아니다. 기존 Claude 실적 검토와 GPT·Gemini 전체 기록은 원래 날짜·원문 그대로 보존한다. Gemini CLI 개인용 Google 로그인과 개인 구독 `agy`의 타사 코딩 에이전트 내 실행은 기존 차단 상태다. AVGO 의견은 공식 Gemini 웹의 3.1 Pro 선택 모드에서 요청 1회로 받은 응답이며 이전 Antigravity VRT 원문·234 USD는 이력에 보존한다. 웹의 서버 모델 식별자는 미보고이고 앱 버전도 임의로 채우지 않는다. 공유 커뮤니티 DB·백그라운드 워커·기존 CLI 활성화 설정은 변경하지 않았다. [Claude 실제 웹 의견과 검토](docs/community/claude-web-2026-10-30.md), [추정 가격 비교와 Gemini 재선정](docs/community/estimated-price-2026-10-29.md), [서로 다른 종목 검증 기록](docs/community/distinct-recommendations-2026-10-29.md)을 참고한다.
기존 지도·시세·통계는 상세 메뉴와 기존 주소에서 계속 제공한다. [Today 실행·검토·발행](docs/community/today-picks.md)을 따른다.

## 바로 실행

Node.js 24에서 처음 실행하거나 의존성이 변경되면 `npm ci`로 잠금 파일의 패키지를 설치한다. Google 로그인 토큰 검증에는 `jose`를 사용한다.

```sh
npm ci
npm run dev
```

개발 주소는 `http://127.0.0.1:5175`다. `npm run preview`와 `npm start`도 같은 정적 화면·저장된 스냅샷을 제공한다.

```sh
npm test
npm run build
```

빌드는 검증된 공개 파일만 `dist/`에 만든다. `dist/`가 없으면 개발 서버 시작 때 다시 생성한다.

## 현재 기능과 남은 작업

지도·비교·기업·산업통계·시나리오의 고리 표시 순서는 소부장 → 메모리 → 파운드리·패키징 → AI 칩으로 시작한다. 기존 종목과 저장 자료의 분류 ID는 유지한다.

| 영역 | 현재 범위 |
| --- | --- |
| 시나리오 분석 | #scenario에서 5개 변화 입력·9개 섹터·빅테크 7개 비교. 상장사 재무 DB의 연간 실적과 전파 가정을 구분하며 [계산 방법](docs/data/scenario.md)을 공개 |
| Today | AI별 종목 1개·댓글 1개, KST 발행일·근거·실제 작성 출처, 검증 전 미발행 |
| 밸류체인·시세 | 8개 고리 지도, 93개 종목·시장지표, AI 기업 75개, 관심종목·직접 티커·차트·OHLCV·CSV |
| 기업·비교 | 기업 역할·국가·공식 출처, 8개 고리 평균·회사별 비교, 1개월~3년, 목록에서 회사 선택 |
| 데이터 | 공식 산업통계, 검토한 AI 사업·산업 지표, Epoch AI 모델·칩·데이터센터·판매 추정, OpenRouter 토큰 집계, 공식 발표문 변경 감시, 국내 18개 기업 DART RSS |
| Google 로그인 | Google 인증·세션·닉네임 최초 설정 운영 배포 완료. 내 계정에서 닉네임 직접 변경도 운영 배포 완료. 설정·변경 흐름은 로컬 테스트 계정으로 확인; 운영 실계정 저장 시험은 미실시 |
| 커뮤니티 | 종목별 공유 댓글·회원 인증·영속 SQLite API·AI 워커 초안/승인. v4 의견·이력·근거 확장은 [변경별 검수 기록](docs/community/v4-implementation.md) 참조 |

커뮤니티의 운영 API 연결·다른 기기에서의 운영 검증·실제 모델 작동 검증은 아직 완료하지 않았다. 자유게시판의 글 목록·본문 등 첫 출시 전체 범위와 이용자의 재미·재방문도 별도로 확인해야 한다. [커뮤니티 현황](docs/community/ai-community.md)과 [PLAN](PLAN.md)의 남은 작업을 따른다.

실제 시세와 예시 산업신호를 구분한다. DART 재무제표 API, 관세청 HS 품목별 수출 순중량 API, 리츠 AFFO·임대율·배당 자동 수집은 아직 미연결이다. 공개 자료의 단위·범위·기준시각·오류 상태를 보존하며 실패나 결측을 임의 값으로 채우지 않는다.

## 명령

모든 명령은 현재 작업 사본의 저장소 루트에서 실행한다. 아래 수집·워커 명령은 보존된 도구이며 사용자 후속 요청 없이 실행하지 않는다.

| 명령 | 역할 |
| --- | --- |
| `npm run collect` | 시세·차트 스냅샷 수집 |
| `npm run collect:comparison` | AI 기업 75개 비교용 3년 일별 종가 수집 |
| `npm run collect:industry` | ECOS·TWSE 공식 산업통계 수집 |
| `npm run collect:epoch` | Epoch AI 공개 CSV 4종 수집·검증; UTC 일 1회 시도 |
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
- [Epoch AI 산업데이터](docs/data/epoch-ai.md): 공식 CSV 4종·일일 수집·검색·CSV·추정치와 출처
- [배포 안내](docs/deployment/overview.md): Cloudflare 최신 소스 복구·정적 배포와 공개 스냅샷

## 기존 사이트

[GitHub 저장소](https://github.com/khcho9642-sketch/ai-chain-prototype) · [GitHub Pages](https://khcho9642-sketch.github.io/ai-chain-prototype/)

Pages는 수집된 정적 파일을 제공하며, 카탈로그 밖 임의 티커 조회는 로컬/API 배포에서 제공한다. 공개 시세의 출처·지연과 비교 계산은 [시세 안내](docs/data/market.md)를 따른다.
