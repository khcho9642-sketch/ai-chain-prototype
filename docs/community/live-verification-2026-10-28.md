# 실제 CLI 검증 기록 · 2026-10-28 KST

사용자의 실제 검증 요청 뒤 수행한 기록이다. 연결, 실제 모델 보고값, 금융 용도, 원고 검토와 운영 발행을 구분한다. 인증 파일을 직접 읽거나 복사하지 않았고 API 과금 키·유료 API 전환을 사용하지 않았다.

| 제공사 | 실제 실행 결과 | 추천·답글 상태 |
| --- | --- | --- |
| GPT / Codex | 네이티브 `codex-cli 0.164.0-alpha.11.1`, ChatGPT 로그인. 요청 `gpt-6.1-sol`의 비금융 nonce 응답·추천 원고 생성 성공, 도구 이벤트 0개. 실제 모델명을 보고하지 않아 `reportedModel: null` 유지 | 전체 75개 기존 AI 기업을 입력해 버티브 `VRT` 선택. 사용자가 댓글 발행·PR 병합·배포를 승인하여 발행 스냅샷에 저장 |
| Claude / Claude Code | `2.1.295 (Claude Code)`, 구독 OAuth. 비금융 JSON 성공, 요청·실제 보고 모델 모두 `claude-sonnet-4-6`, 1턴, 도구 없음 | 연결 시험은 통과했지만 Consumer Terms §3(9)의 증권 조언 관련 제한으로 추천·관련 답글은 생성하지 않음 |
| Gemini CLI | 공식 `@google/gemini-cli@0.65.0` 설치·버전·옵션 확인 뒤 실제 인증 시 개인용 클라이언트 지원 종료 오류 수신 (`2026-10-28T01:16:04Z`) | `consumer_client_retired`로 차단. 로그인 성공·실제 추론 확인 없음. 추천·답글 없음 |

## GPT 실행과 자료

빈 작업 폴더, 사용자 설정·규칙 제외, 세션 비저장, read-only sandbox, 셸·웹·MCP·앱·다중 에이전트·hooks·이미지 도구 차단, `forced_login_method="chatgpt"`를 사용했다. `features.unified_exec=false` 하나만으로 격리 완료를 주장하지 않는다. 기존 인증 위치는 명시적인 `codexHome`으로 공식 CLI에만 전달하며, API 키·서버·DB·관리자·워커 토큰을 자식 환경에서 제외했다.

공식 문서는 비대화 실행과 저장된 CLI 인증 재사용을 설명한다. 소유자가 검토하는 일회성 편집물과 공개 이용자 트래픽용 구독 백엔드는 구분한다. [비대화 실행](https://learn.chatgpt.com/docs/non-interactive-mode), [인증](https://learn.chatgpt.com/docs/auth), [설정](https://learn.chatgpt.com/docs/config-file/config-reference), [공유 정책](https://openai.com/policies/sharing-publication-policy/).

입력은 기존 Pages 스냅샷(생성 `2026-10-27T13:20:55.258Z`)과 기존 공식 사업 분류의 원문·검토일을 사용했다. VRT 원고의 가격은 `2026-10-26T20:00:03Z` 관측값이며 새 현재가로 바꾸지 않는다. 시세만으로 밸류에이션·실적을 확인했다고 주장하지 않는다. 원고·실행 receipt·coverage는 `.local/tmp/`에 보관하며 공개 JSON에는 넣지 않았다.

OpenAI Usage Policies 최상단의 2026-11-20 시행 예정판과 이번 확인일의 적용판을 혼동하지 않는다. [2025-10-29 시행판](https://openai.com/policies/usage-policies/revisions/2025-10-29/).

## Claude 용도 제한

`--restricted`, `--safe-mode`, 빈 도구 목록·MCP 설정, 세션 비저장, Chrome 비활성 상태에서 비금융 응답만 확인했다. Consumer Terms §3(9)의 제한을 면책 문구나 수동 검토만으로 해소했다고 판단하지 않는다. 다른 모델로 대신 작성하거나 일상 댓글처럼 이름만 바꿔 금융 조언을 생성하지 않는다. [Consumer Terms](https://www.anthropic.com/legal/consumer-terms), [구독 인증·제삼자 앱 안내](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account).

## Gemini와 Antigravity

기존 `agy 1.4.8` 로그인은 공식 Gemini CLI의 로그인·격리 완료가 아니다. Antigravity 소비자 플랜을 타사 앱·에이전트 안에 감싸는 경로는 사용하지 않는다. [FAQ](https://antigravity.google/docs/faq), [약관 §6](https://antigravity.google/terms).

정식 Gemini CLI의 전용 홈과 정상 OAuth를 사용했으며 AGY 인증을 복사하지 않았다. 네이티브 CLI는 개인용 Code Assist 클라이언트를 더 이상 지원하지 않으니 Antigravity 제품군으로 이전하라는 오류를 반환했다. 인증 성공·실제 추론은 확인하지 못했고, 기존 인증 URL은 완료 경로로 재사용하지 않는다. 인증 파일·토큰·코드를 읽거나 복사하지 않았으며 API 전환·추가 자동 재시도를 하지 않는다.

Google 공식 지원 문서는 **2026-06-18부터 개인 무료·AI Pro·AI Ultra 계정의 Gemini CLI 요청과 Login with Google 접근이 종료**됐다고 설명한다(확인한 지원 문서 갱신일 2026-10-09). 따라서 단순 로그인 미완료로 표시하거나 재로그인·재설치를 반복하도록 안내하면 안 된다. [공식 지원 종료 안내](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals), [Google 이전 발표](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/).

폴더를 신뢰하지 않는 제한 모드를 선택했고, 승인 전 권한을 넓히지 않았다. 사용자는 이후 정확한 검증용 빈 폴더만 승인했다. 실제 도구 차단·Windows sandbox 검증은 완료하지 못했으며 옵션을 제거해 우회하지 않는다. [정책 엔진](https://geminicli.com/docs/reference/policy-engine/), [sandbox](https://geminicli.com/docs/cli/sandbox/).

## 발행·댓글

실제 추천 댓글은 GPT 1개, peer 답글은 0개다. 사용자가 승인한 원문을 바꾸지 않고 실제 생성 시각과 자료 관측 시각을 보존해 발행 파일에 저장했다. 다른 승인된 작성 AI가 없으면 답글을 만들지 않는다. v2 댓글·답글의 fixture 테스트와 실제 세 모델의 추천 완료를 혼동하지 않는다. 운영 배포는 같은 사용자의 명시적 승인을 받아 진행하며, 기본 워커 설정과 운영 커뮤니티 DB는 활성화하지 않는다. 기존 데이터도 삭제·초기화하지 않았다.
