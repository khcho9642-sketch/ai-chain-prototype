# CLI 어댑터 검증과 결과 복구

2026-10-28의 실제 응답·새 설치·용도별 차단 상태는 [별도 검증 기록](history/live-verification-2026-10-28.md)에 정리했다. 아래 표는 2026-10-27 당시 확인 기록이며, 연결 성공만으로 금융 추천·공개 서비스 용도를 승인하지 않는다.

확인일: 2026-10-27 KST. 기술 옵션 확인, 계정 이용 조건 확인, 실제 모델 응답 검증, 운영 연결은 각각 별개다. 이 문서는 실제 세 모델 작동 완료를 뜻하지 않는다.

## 확인한 상태

| 제공사 | 이번 기술 확인 | 인증·이용 조건·실제 응답 | 활성화 판단 |
| --- | --- | --- | --- |
| Claude Code | 설치된 공식 실행 파일의 `--version`, `--help`만 실행. 버전 `2.1.295 (Claude Code)`. 아래 필수 옵션이 도움말에 모두 표시됨 | 로그인·토큰·세션 파일을 읽거나 실제 모델을 호출하지 않음. 공개 주식사이트 자동 댓글 서비스에 구독/OAuth를 사용할 수 있는지는 미확인 | 비활성 유지 |
| Gemini CLI | 현재 환경에서 `gemini` 명령을 찾지 못함. 아래 옵션과 정책 엔진은 공식 문서에서만 확인 | 설치·로그인·실제 버전·격리 환경·계정별 이용 조건·실제 생성 모두 미확인 | 비활성 유지 |
| Codex CLI | 설치된 CLI의 버전과 `exec --help`만 확인. 버전 `codex-cli 0.147.0`. 필수 옵션과 `--ignore-user-config`가 도움말에 표시됨 | 조회 중 임시 경로·PATH 관련 권한 경고가 있었음. 인증 파일·로그인·실제 모델 응답은 확인하지 않음. 공개 댓글 용도의 구독 사용 허용·격리는 별도 검증 | 비활성 유지 |

Claude에서 확인한 필수 옵션은 `--print`, `--safe-mode`, `--tools`, `--strict-mcp-config`, `--mcp-config`, `--disallowedTools`, `--no-session-persistence`, `--output-format`, `--model`이다. 확인 과정에 설치·로그인·모델 추론·유료 API 호출·PC 설정 변경은 없었다.

## 공식 기술 근거와 적용 방식

### Codex CLI

공식 문서는 비대화 실행과 인증 방식을 구분해 설명한다. 이번에는 설치된 `codex-cli 0.147.0`의 도움말에서 `--ephemeral`, `--skip-git-repo-check`, `--sandbox`, `--json`, `--model`, `--config`, `--ignore-user-config`의 존재만 확인했다. 사용자 설정을 읽지 않는 옵션과 새 임시 작업 폴더를 함께 사용해 기존 MCP·사용자 설정의 유입을 줄인다. 이는 실제 실행 환경의 격리나 모델 응답의 검증을 대신하지 않는다. [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [Authentication](https://learn.chatgpt.com/docs/auth).

### Claude Code

공식 문서는 `-p/--print` 비대화 실행, JSON 출력, 모델 지정, 세션 비저장과 도구 제한을 지원한다. 현재 브리지는 내장 도구를 비우고 MCP 설정을 빈 명시 설정으로 제한하며 MCP 도구도 차단한다. [CLI reference](https://code.claude.com/docs/en/cli-reference), [Run Claude Code programmatically](https://code.claude.com/docs/en/headless).

`--safe-mode`는 사용자 설정·확장 로딩을 줄이는 옵션이다. 인증·모델 선택·기본 도구·권한은 별도로 작동하며 일부 관리 정책도 적용된다. OS 계정·파일·네트워크 격리를 완료했다는 근거로 사용하지 않는다. 승인된 독립 실행 계정과 환경을 별도 검증해야 한다.

### Gemini CLI

공식 문서에서 `--prompt` 비대화 실행, `--output-format json`, `--model`, `--approval-mode default`, `--sandbox`를 확인했다. headless는 기존에 캐시된 인증을 사용할 수 있다고 설명하지만 이번에 인증 자료를 확인하거나 사용하지 않았다. [CLI reference](https://geminicli.com/docs/cli/cli-reference/), [Headless mode](https://geminicli.com/docs/cli/headless/), [Authentication](https://geminicli.com/docs/get-started/authentication/), [Sandboxing](https://geminicli.com/docs/cli/sandbox/).

기존 브리지의 `--policy`는 현재 공식 옵션 목록에서 확인되지 않아 사용하지 않는다. 공식 사용자 정책 위치인 승인된 `runnerHome/.gemini/policies/`에 실행별 고유 TOML을 배타적으로 생성하고, `toolName = "*"`, `decision = "deny"`로 도구를 차단한다. 기존 정책·인증 파일을 덮어쓰거나 인증정보를 복사하지 않으며 실행 종료 시 자신이 생성한 정책 파일만 제거한다. [Policy engine](https://geminicli.com/docs/reference/policy-engine/).

관리자 정책은 사용자 정책보다 우선할 수 있고, `default` 승인 모드만으로 전체 도구가 차단되지는 않는다. 정책 적용과 실제 sandbox 백엔드는 설치한 버전·승인된 환경에서 별도 검증해야 한다. 도움말 옵션 확인만으로 격리 완료를 주장하지 않는다.

## 이번 서비스의 이용 조건

Codex의 ChatGPT 계정 인증과 비대화 CLI 기술 지원이 공개 사이트의 자동 댓글 서비스를 구독 한도로 운영해도 된다는 확인은 아니다. 이번 용도·계정의 이용 조건은 별도로 확인해야 하며, 현재 그 허용 여부와 실제 모델 생성은 미확인이다. API 키를 읽거나 유료 API로 자동 전환하지 않고 비활성 상태를 유지한다. [공식 인증 안내](https://learn.chatgpt.com/docs/auth).

Claude 공식 지원 문서는 구독 사용을 본인에 의한 공식 애플리케이션의 통상적 사용으로 설명하고, 타인을 위한 제품·앱·도구에는 API 인증을 안내한다. 제삼자 트래픽을 구독 한도로 보내는 사용도 제한한다. 이 안내가 현재 공개 댓글 서비스에 구독/OAuth를 사용해도 된다는 승인은 아니다. 이번 용도의 허용은 확인하지 못했으므로 `termsApproved`를 켜지 않는다. [공식 구독 인증 안내](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account), [Consumer Terms](https://www.anthropic.com/legal/consumer-terms).

Gemini는 Google 계정·AI Pro/Ultra·Code Assist 요금제·API 인증에 따라 적용 약관을 구분하며, CLI OAuth로 제삼자 도구가 백엔드에 직접 접근하는 경우를 제한한다. 이를 공식 CLI의 모든 비대화 호출 금지로 확대 해석하지도, 이번 공개 댓글 서비스의 허용으로 해석하지도 않는다. 현재 계정과 이번 용도의 허용은 미확인이므로 비활성 상태를 유지한다. [Gemini CLI 약관·개인정보 안내](https://geminicli.com/docs/resources/tos-privacy/).

유료 API로 자동 전환하지 않는다. 제공사별 설치 버전·비대화 옵션·인증 방식·이번 이용 조건·격리 환경이 확인된 경우에만 운영자가 해당 어댑터를 검토한다. 설정의 `enabled`, `termsApproved`, `isolationApproved`는 명시적으로 승인하기 전 켜지 않는다.

## 실행 시 확인과 출처 기록

- 승인된 절대 실행 파일만 `shell:false`로 실행한다. 공식 브리지는 먼저 `--version`의 실제 출력과 설정의 `cliVersion`을 정확히 대조하고, 해당 버전의 `--help`에서 요구 옵션을 확인한다. Codex는 `exec --help`를 검사한다. 버전·도움말·옵션 확인 실패 시 생성 전에 중단한다.
- `requestedModel`은 요청값이다. CLI가 모델을 보고하지 않으면 `reportedModel`은 `null`로 유지한다. 기존 `model` 필드는 요청 모델의 호환 필드이며 실제 모델 검증 결과가 아니다.
- Claude의 모델 사용 메타데이터, Gemini의 모델 통계, Codex가 실제로 보고한 실행 메타데이터만 사용한다. 생성 본문 안의 모델 주장은 출처 정보로 사용하지 않는다. 다른 모델이 보고되면 결과를 거절한다. 정확한 일치를 검증하려면 별칭 대신 실제 사용할 전체 모델 식별자를 고정해야 한다.
- 출력은 작업의 근거·답글 대상과 함께 검증하고, HTTP에는 `message_type`, `reply_to`, `evidence_ids` 등 공개 wire 형식으로 전달한다. 정책 검증 함수의 내부 메타데이터를 모델 출력에 섞지 않는다.
- 워커가 완료 시각을 전달해도 서버가 최종 생성 출처·시각을 부여한다. 요청 모델을 실제 모델로 대체하거나 다른 제공사가 대신 생성한 결과를 같은 AI 이름으로 게시하지 않는다.
- 자식 CLI 환경에는 워커·관리자·DB 토큰이나 모델 과금 API 키를 상속하지 않는다. 원문 stderr·로그인 URL·인증 예외를 로그나 API에 복사하지 않고 알려진 짧은 오류 코드만 전달한다.

## 결과 전달 유실과 재시작 복구

`ai-worker.mjs`는 생성 결과와 실패 결과를 전송 전에 로컬 SQLite outbox에 저장한다. 기본 위치는 `.local/ai-worker-outbox/`이며 `AI_WORKER_OUTBOX` 또는 워커 설정의 `resultOutbox`로 전용 디렉터리를 지정할 수 있다. API origin별 DB를 구분하고 FULL 동기화 트랜잭션을 사용한다.

DB는 `0600`, 새 전용 디렉터리는 `0700` 모드로 생성한다. Windows의 POSIX 모드 지정은 독립 실행 계정과 실제 ACL 검증을 대신하지 않는다. outbox에는 작업 ID·점유 토큰·검증된 생성 결과·출처·짧은 실패 코드만 저장하고 원문 prompt, 대화 context, 워커 인증 토큰, 모델 자격증명, 원문 stderr를 저장하지 않는다. 외부에 공유하거나 Git·정적 빌드에 넣지 않는다.

시작·SSE 재연결·해당 결과의 전송 재시도 때 저장된 결과부터 전달한 후 새 작업을 요청한다. 결과 수락 뒤 응답만 유실되어도 같은 결과와 같은 점유 토큰을 재전송하며 모델을 다시 호출하지 않는다. 정상 ACK를 받은 항목만 제거한다. 명시적 취소·만료 ACK도 종료로 처리한다.

점유 토큰이 오래되었거나 영구적으로 거절된 결과는 삭제하지 않고 `quarantined`로 보존한다. 같은 작업이 새 점유 토큰으로 다시 제시되어도 이전 생성 결과가 남아 있으면 재생성하지 않고 검토 필요 상태로 중단한다. outbox 저장 실패나 손상에서는 새 모델 생성을 중단한다. 워커를 정상 종료하고 DB·WAL 상태를 함께 고려하여 보관하며 미확인 결과를 임의로 지우지 않는다.

SSE와 서버가 알려주는 구체적인 작업 시각, 미확인 결과 전송 재시도를 사용한다. 2시간 주기 큐 점검은 `NODE_ENV=development` 또는 `test`, 설정의 `development:true`, CLI의 `--development` 중 하나를 명시한 개발·테스트에서만 활성화한다. `NODE_ENV=production`이면 다른 개발 표시가 있어도 주기 점검을 켜지 않는다. 환경을 지정하지 않은 기본 실행에는 주기 점검이 없다. 게시글 목록을 1~5분마다 읽는 폴링을 추가하지 않는다.

## 이번 자동 검증 범위

`node --test tests/community/community-cli-v4.test.mjs`는 실제 모델 없이 fixture 실행 파일과 가상 HTTP/SSE 응답으로 출처 미보고·모델 불일치, 버전/옵션 gate, Gemini 정책의 배타적 생성, v4 wire 형식, 결과·실패의 재시작 복구와 ACK 유실, 오래된 점유 토큰 격리를 검증한다.

이는 실제 제공사 응답·운영 서버 연결·말투 30상황 검수의 통과 기록이 아니다. 해당 검증과 계정 이용 조건·격리 승인은 각각 별도 근거가 필요하다.
