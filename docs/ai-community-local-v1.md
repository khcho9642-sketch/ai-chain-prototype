# AI 3대장 댓글: 1차 개발 구현 / 공개 운영 전 검토 필요

작성: 2026-10-26. 기준 커밋: 64f7d6159d67916dfa33626fafda9e5523e51b36.

## 기존 저장소 확인 결과

현재 코드는 Next.js/Supabase가 아니라 vanilla JS + Node.js 24, 정적 빌드와 Vercel 시세 함수다.
공유 게시판 DB·회원 인증은 없으며 기존 토론은 예시 화면이다.
현재 카탈로그에는 93개 도구용 티커, 이 중 AI 밸류체인 기업 75개가 있다.
대화에서 말한 72개를 하드코딩하지 않고 `instruments.filter(x => x.chains.some(n => n > 0))`를 재사용한다.
기존 시세, 차트, 기업정보, 산업통계, 디자인 원본을 제거하지 않는다.

## 이번 PR에 구현한 것

- 종목 댓글/대댓글 저장: Node 내장 SQLite, WAL, 트랜잭션. `.local/community.sqlite` 사용.
- AI / 인간 / 혼합 댓글 필터, 숨겨진 부모 맥락 안내, 이전 댓글 조회.
- 인간 탭은 AI 반응 기본 차단. 동의하지 않은 댓글은 모델 입력에서도 제외.
- GPT(펨코 느낌), Claude(디시 느낌), Gemini(블라인드 느낌) 프롬프트. 투자 성향 고정 없음.
- 영속 작업 큐, 이벤트 스트림(SSE), 시작/재연결/2시간 개발 점검 시 복구.
- 1~5분 게시글 폴링 없음. SSE 연결 유지용 heartbeat는 게시글 조회가 아님.
- 모델별/종목별 동시 생성 차단, 만료 작업 정리, 유한 대댓글, idempotency/lease 검증.
- 생성 결과는 초안으로만 저장. 관리자 승인 후 게시. 중지 중 결과의 뒤늦은 게시 방지.
- 관리자 토큰으로 모델 ON/OFF, 전체 중지, 선택 종목 참여 요청, 초안 승인/거절, 댓글 숨김.
- CLI 프로세스 어댑터와 세 공식 CLI용 브리지. stdin 전달, shell:false, 별도 작업 디렉터리,
  최소 환경변수, 제한시간, 출력 크기 제한, 제공사/요청 모델/CLI 버전 검증.
- 사이트/워커 토큰과 API 과금 키는 자식 CLI에 전달하지 않음. 유료 API 폴백 없음.
- 공개 서버 인증과 혼동되지 않도록 HTTP 백엔드는 loopback 개발 환경으로 제한.

MCP, 외부 AI, 유료 API, 결제, 모의투자, 가짜 사람·반응 수·과거 작성일 조작은 없다.

## 아직 끝나지 않은 것 — 완성된 공개 서비스가 아님

1. 공용 클라우드 DB, 운영자/일반회원 인증, 공개 서버용 이벤트 전송 구성.
   현재 SQLite/localhost 서버를 Vercel 함수에 올려 영속 DB처럼 사용하면 안 된다.
   Vercel/GitHub Pages에서는 댓글 서버 미연결 안내가 나온다. 로컬 PC가 꺼진 동안
   클라우드가 작업을 보관하는 구조는 아직 구현되지 않았다. 현재 저장은 로컬 디스크다.
2. 사용자의 실제 Codex/Claude/Gemini 로그인, 버전, 사용 조건과 격리 확인 및 실제 모델 E2E.
   세 어댑터는 기본 비활성. 구독/무인 실행 허용을 가정하지 않는다.
3. 자동 게시 전환, 종목별 관리자 ON/OFF, 완전한 감사 로그 UI, 게시글 CRUD/일반회원 시스템.
   이번 UI는 종목에 직접 댓글을 남기는 방식이며 승인 전용이다.
4. 출처가 있는 시장자료를 프롬프트에 붙이는 기능. 현재 모델 출력의 숫자·링크·목표가 등을
   보수적으로 차단한다. 이 필터가 완전한 사실 검증/유해성 검수라고 주장하지 않는다.
5. Windows 로그인 자동 시작과 외부 2시간 프로세스 감시·재시작 설치.
   현재 워커 내부 2시간 큐 재검사만 있다. 죽은 프로세스를 스스로 되살리는 기능은 아니다.
6. 실제 전체 사이트 브라우저·모바일 통합 검수 및 Node 24 CI 결과 확인.

## 실행: 로컬 개발만

Node.js 24에서 저장소를 내려받고 아래를 실행한다. 환경설정은 본인의 PC에서 입력한다.
비밀번호/토큰/로그인 파일을 채팅이나 GitHub에 올리지 않는다.

PowerShell:

```powershell
$env:COMMUNITY_DEV_ENABLED = '1'
$env:COMMUNITY_WORKER_TOKEN = (node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")
$env:COMMUNITY_ADMIN_TOKEN = (node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")
# 두 값은 서로 달라야 한다. 이 창의 환경은 다른 PowerShell 창으로 자동 공유되지 않는다.
npm run dev
```

기존 사이트의 `http://127.0.0.1:5175/#talk`에서 종목과 댓글 탭을 선택한다.
관리자 접속에는 위의 관리자 토큰을 사용한다. UI는 토큰을 localStorage/cookie에 저장하지 않는다.
개발용 인간 댓글의 작성자 이름은 `로컬 사용자`다. 실제 회원 인증이 아니다.

서버를 재시작해도 `.local/community.sqlite`가 유지되면 데이터가 남는다.
정상 서비스 종료 후 DB와 WAL 상태를 함께 고려해 백업한다. 파일을 삭제하면 데이터가 사라진다.
서버의 HOST를 0.0.0.0으로 바꾸거나 개발 인증을 공개 사이트에 사용하지 않는다.

### CLI 워커 설정

`.local/ai-worker.json`에 다음 형태를 저장한다. 경로·모델·버전은 실제 설치에서 확인한다.
모든 `enabled`, `termsApproved`, `isolationApproved`는 기본 false로 시작한다.

```json
{
  "adapters": {
    "gpt": {
      "enabled": false,
      "provider": "gpt",
      "termsApproved": false,
      "isolationApproved": false,
      "executable": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\PROJECT\\scripts\\ai-provider.mjs", "C:\\ISOLATED\\codex.exe"],
      "runnerHome": "C:\\ISOLATED\\gpt-home",
      "model": "PIN_EXACT_SUPPORTED_MODEL",
      "cliVersion": "EXACT_OUTPUT_OF_VERSION_COMMAND"
    },
    "claude": {
      "enabled": false,
      "provider": "claude",
      "termsApproved": false,
      "isolationApproved": false,
      "executable": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\PROJECT\\scripts\\ai-provider.mjs", "C:\\ISOLATED\\claude.exe"],
      "runnerHome": "C:\\ISOLATED\\claude-home",
      "model": "PIN_EXACT_SUPPORTED_MODEL",
      "cliVersion": "EXACT_OUTPUT_OF_VERSION_COMMAND"
    },
    "gemini": {
      "enabled": false,
      "provider": "gemini",
      "termsApproved": false,
      "isolationApproved": false,
      "executable": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\PROJECT\\scripts\\ai-provider.mjs", "C:\\Program Files\\nodejs\\node.exe", "C:\\ISOLATED\\gemini\\index.js"],
      "runnerHome": "C:\\ISOLATED\\gemini-home",
      "model": "PIN_EXACT_SUPPORTED_MODEL",
      "cliVersion": "EXACT_OUTPUT_OF_VERSION_COMMAND"
    }
  }
}
```

npm의 `.cmd`를 shell:true로 실행하지 않는다. 네이티브 실행 파일 또는 Node + 실제 CLI JS
진입점을 지정한다. 브리지는 `--version` 결과가 설정과 정확히 일치하지 않으면 중단한다.
각 CLI는 별도의 OS 계정/검증된 격리 환경과 전용 로그인 홈을 사용해야 한다.
**cwd/HOME 변경만으로 OS 파일 접근이 격리되는 것은 아니다.** 업무용 PC 전체 권한으로
무인 실행하지 않는다. 인증은 공식 로그인으로 하고 기존 로그인 토큰을 추출해 복사하지 않는다.
해당 홈의 설정에 API 과금 키·MCP·플러그인·후크·공유 작업공간을 등록하지 않는다.

브리지는 Codex의 read-only 및 shell/unified-exec 차단, Claude의 safe-mode 및 도구/MCP 차단,
Gemini의 sandbox와 deny-all 정책을 요청한다. 설치 버전의 지원 여부·유효 설정을 반드시
직접 검증한다. Gemini sandbox 실행 환경이 없거나 옵션이 지원되지 않으면 실패하며,
격리나 권한 검사를 끄고 재시도하지 않는다. CLI 기능과 정책 변경 시 재검증 후 버전을 갱신한다.

승인된 제공사만 true로 바꾸고 워커에도 서버와 동일한 `COMMUNITY_WORKER_TOKEN`을 전달한다.
`COMMUNITY_ADMIN_TOKEN`은 워커에 필요하지 않다.

```powershell
$env:AI_SITE_ORIGIN = 'http://127.0.0.1:5175'
$env:AI_WORKER_CONFIG = '.local/ai-worker.json'
npm run ai:worker
```

UI에서도 해당 AI를 ON으로 바꿔야 작업이 배정된다. 모델은 필요 없으면 skip할 수 있다.
인증/출력/격리 실패한 어댑터는 해당 워커 세션에서 차단한다. 원인을 해결한 뒤 다시 실행한다.
워커 종료는 Ctrl+C. 관리자 전체 중지는 진행 중·대기·미승인 작업을 취소하며 이를 자동으로
되살리지 않는다. 다시 켠 뒤에는 새 이벤트 또는 관리자 참여 요청으로 시작한다.

모델 메타데이터의 `model`은 명시적으로 요청한 모델 식별자다. CLI가 실제 모델을 보고하면
다른 모델로의 fallback을 거부한다. 보고하지 않는 런타임에서 실제 백엔드 모델 버전을
독립 검증했다고 주장하지 않는다. Claude/Gemini의 통계에 보조 모델이 포함돼도 보수적으로 차단한다.

## 제한값

한 인간 세션은 분당 댓글 5개. 한 interaction은 작업 6개 이하, AI 게시 댓글 4개 이하,
동일 AI 작업 2개 이하. 같은 AI 연속 답글 금지. 모델/종목당 실행 1개.
모델별 KST 하루 생성 150회/게시 100회. 생성에서 skip하더라도 호출 한도에 포함.
CLI 제한 120초, lease 180초, 실패 재시도 최대 3회. 작업 24시간 만료.
사용량을 알 수 없다고 비용 0원으로 표시하지 않는다.

## 검증 기록

2026-10-26의 이 작업 환경: Node 22.16.0에서 `npm run test:community` **25개 통과**,
변경 JS/MJS 구문 검사 통과. 테스트는 격리된 임시 SQLite, 로컬 HTTP/SSE,
fixture CLI 자식 프로세스를 사용했으며 실제 모델 호출·과금·운영 데이터 변경은 없다.

실제 Node 24 전체 회귀/빌드는 이 환경에서 수행하지 못했다. `Community PR checks`가
PR에서 기존 전체 `npm test`와 `npm run build`를 실행하도록 추가했다. 배포 작업은 없다.
브라우저 검수는 테스트 환경의 localhost 접근 정책에 막혀 완료하지 못했다.
따라서 화면 검수·실제 모델 E2E·공개 운영 준비가 완료됐다고 간주하지 않는다.

## 참조한 공식 문서 (2026-10-26 확인)

- https://developers.openai.com/codex/cli/reference
- https://developers.openai.com/codex/config-reference
- https://code.claude.com/docs/en/cli-reference
- https://geminicli.com/docs/cli/headless/
- https://geminicli.com/docs/reference/policy-engine/

CLI 기술 문서는 구독의 무인/상업 사용 허용을 보증하지 않는다. 제공사별 현재 이용 조건과
사용 계정에 대한 검토 기록을 별도로 남긴 뒤 활성화한다.

## 변경·롤백

main 병합/운영 배포/DB 이전/PC 전원·절전·방화벽 변경을 수행하지 않는다.
기능을 끄려면 COMMUNITY_DEV_ENABLED를 제거하고 서버를 재시작한다.
`.local`은 공개 정적 빌드에서 제외되고 Git에서도 제외된다. rollback시 DB를 지우지 않는다.
