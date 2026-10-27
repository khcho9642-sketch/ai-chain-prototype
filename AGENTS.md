# AI 체인 저장소 작업 안내

이 폴더 `ai-chain-prototype`가 AI 체인 사이트의 유일한 개발 기준이다. 사이트 코드·문서·수집 근거·테스트·작업 산출물은 이 프로젝트 안에 둔다. 기존 교육 자료 폴더에 사이트 파일이나 별도 앱을 다시 만들지 않는다.

## 폴더와 실행

- 제품 목표와 출시 기준은 `PLAN.md`, 실행·데이터 정의는 `README.md`, 폴더별 용도는 `docs/project-structure.md`를 따른다.
- `assets/`는 브라우저 코드·스타일·검증기, `api/`는 Vercel 함수 진입점, `server/`는 서버 공통 코드다. 기존 진입점·import·URL은 필요한 근거 없이 옮기지 않는다.
- 실행·빌드·원천 수집·운영 명령은 `scripts/`, 모든 테스트와 테스트 전용 helper·fixture는 `tests/`에 둔다.
- `scripts/data/`는 수집·통계 생성, `scripts/community/`는 서버·계정·백업·워커, `scripts/deployment/`는 배포·패키징·연결 검사다. 테스트는 `tests/market/`, `tests/data/`, `tests/community/`, 기능 문서는 `docs/data/`, `docs/community/`에 나누고 `docs/README.md`에서 찾는다. 빌드·개발 서버 진입점은 기존 `scripts/build.mjs`, `scripts/serve.mjs`를 유지한다.
- 공개 스냅샷은 `data/`에 둔다. `scripts/build.mjs`의 공개 파일 허용목록과 검증을 유지하고, 임의 파일을 일괄 공개하지 않는다.
- 검토 원본·공식 출처 확인 근거는 `research/`, 배포 설정 예제는 `deploy/`, Claude 디자인 원본은 `design/`에 보존한다. 이 폴더들은 정적 공개 빌드 대상이 아니다.
- 개인 작업물은 Git에서 제외된 `.local/`에 둔다: `tmp/`, `screenshots/`, `onboarding/oracle/`, `archive/`, `organization/`, `releases/`. 캡처·다운로드·로그·가입 자료·DB·인증정보를 소스나 공개 데이터에 섞지 않는다. `.local/` 전체를 폐기 가능한 임시 파일로 간주하지 않는다.
- 개발 대상은 이 저장소의 AI 밸류체인 사이트 하나이며 기본 개발 주소는 `http://127.0.0.1:5175`다. 통합된 시세·차트·관심종목 기능은 유지한다. 비공개 보관물 안내는 `.local/README.md`, 과거 구현 문서는 `docs/community/history/`, 현행 배포 안내는 `docs/deployment/`에서 관리한다.
- Node.js 24에서 `npm run dev`, `npm test`, `npm run build`를 사용한다. 수집 명령은 해당 데이터 문서를 따른다. 코드나 경로를 변경하면 관련 테스트와 빌드를 확인한다.

## 데이터와 완료 상태

- 숫자는 출처·단위·관측기간·수집 상태를 보존한다. 실패나 결측을 임의 값으로 채우지 않는다.
- DART 회사 RSS 메타데이터와 OpenAI·Anthropic 발표문 검토 후보를 분리한다. API 경로가 브라우저 요청마다 원천 수집을 실행하지 않도록 기존 스냅샷 구조를 유지한다.
- 구현·테스트 완료와 운영 배포·실제 모델 작동을 구분한다. 커뮤니티 API·회원·AI 워커 코드는 구현되어 있지만 운영 서버 연결과 실제 모델 검증은 별도 작업이다.
- 기존 Git 이력·브랜치·사용자 수정 내용을 보존한다. 파일 이동·삭제는 정확한 대상과 의존성을 확인한 뒤 수행하며, 원본 디자인·검토 근거·준비한 릴리스·DB를 중복으로 단정해 제거하지 않는다.
