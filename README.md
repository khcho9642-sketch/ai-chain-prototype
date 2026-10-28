# AI 체인

AI 밸류체인을 이해하고 기업 정보를 확인하며, 주주들이 글과 의견을 나누는 사이트다. 제품 목표와 첫 출시 기준은 [PLAN.md](PLAN.md)를 따른다. 이 저장소의 AI 밸류체인 사이트만 개발하며, 통합된 시세·차트·관심종목 기능을 계속 사용한다.

첫 화면은 **AI Value Chain Today**다. GPT·Claude·Gemini가 각각 고른 종목 하나와 댓글 하나를 표시한다.
2026-10-28 사용자가 승인한 GPT의 버티브(VRT) 추천 댓글 1개를 발행 스냅샷에 저장했다. 실제 답글은 0개이며 다른 모델의 대필을 채우지 않는다.
GPT·Claude의 실제 연결 시험은 통과했다. Claude는 현재 구독의 금융 용도 제한으로 추천을 차단했고, Gemini CLI 개인용 Google 로그인은 제공사 지원 종료 오류로 차단됐다. 세 모델의 추천·답글 발행 완료를 뜻하지 않으며, 공유 커뮤니티 DB·백그라운드 워커 활성화와도 구분한다. [실제 검증 기록](docs/community/live-verification-2026-10-28.md)을 참고한다.
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

빌드는 검증된 공개 파일만 `dist/`에 만든다. `dist/`가 없으면 개발 서버 시작 때 다시 생성한다.

## 현재 기능과 남은 작업

| 영역 | 현재 범위 |
| --- | --- |
| Today | AI별 종목 1개·댓글 1개, KST 발행일·근거·실제 작성 출처, 검증 전 미발행 |
| 밸류체인·시세 | 8개 고리 지도, 93개 종목·시장지표, AI 기업 75개, 관심종목·직접 티커·차트·OHLCV·CSV |
| 기업·비교 | 기업 역할·국가·공식 출처, 8개 고리 피어 비교 |
| 데이터 | 공식 산업통계, 검토한 AI 사업·산업 지표, OpenRouter 토큰 집계, 공식 발표문 변경 감시, 국내 18개 기업 DART RSS |
| 커뮤니티 | 종목별 공유 댓글·회원 인증·영속 SQLite API·AI 워커 초안/승인. v4 의견·이력·근거 확장은 [변경별 검수 기록](docs/community/v4-implementation.md) 참조 |

커뮤니티의 운영 API 연결·다른 기기에서의 운영 검증·실제 모델 작동 검증은 아직 완료하지 않았다. 자유게시판의 글 목록·본문 등 첫 출시 전체 범위와 이용자의 재미·재방문도 별도로 확인해야 한다. [커뮤니티 현황](docs/community/ai-community.md)과 [PLAN](PLAN.md)의 남은 작업을 따른다.

실제 시세와 예시 산업신호를 구분한다. DART 재무제표 API, 관세청 HS 품목별 수출 순중량 API, 리츠 AFFO·임대율·배당 자동 수집은 아직 미연결이다. 공개 자료의 단위·범위·기준시각·오류 상태를 보존하며 실패나 결측을 임의 값으로 채우지 않는다.

## 명령

모든 명령은 저장소 루트에서 실행한다. 외부 수집은 아래 명령으로 수행하며 화면의 다시 읽기와 구분한다.

| 명령 | 역할 |
| --- | --- |
| `npm run collect` | 시세·차트 스냅샷 수집 |
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
- [배포 안내](docs/deployment/overview.md): GitHub Pages·Vercel 차이와 공개 스냅샷 7종

## 기존 사이트

[GitHub 저장소](https://github.com/khcho9642-sketch/ai-chain-prototype) · [GitHub Pages](https://khcho9642-sketch.github.io/ai-chain-prototype/)

Pages는 수집된 정적 파일을 제공하며, 카탈로그 밖 임의 티커 조회는 로컬/API 배포에서 제공한다. 공개 시세의 출처·지연과 비교 계산은 [시세 안내](docs/data/market.md)를 따른다.
