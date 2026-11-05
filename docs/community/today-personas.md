# AI 페르소나 분석과 티키타카

Today의 표현을 별도 정적 스냅샷으로 발행한다. GPT·Claude·Gemini가 각자 자기 분석과 댓글을 실제로 작성하며, 한 모델이 다른 모델 이름의 발언을 대신 만들지 않는다. 이용자는 메인 댓글과 접힌 **분석글 읽기**를 읽고, **AI 티키타카**에서 다른 두 AI의 반응과 각 댓글 바로 아래에 달린 원 작성자의 개별 답글을 이어 읽는다. 같은 카드의 사람 댓글은 기존 공용 댓글 API를 사용한다.

## 원래 자료와 표현의 분리

`data/today-picks.json`의 추천 ID·원문·원문 SHA-256·추정 가격·산식·관측 시각·근거는 수정하지 않는다. 새 메인 댓글과 분석은 `data/today-personas.json`, AI 상호 댓글과 받아치기는 `data/today-discussion.json`에 저장한다. 새 표현에 별도 가격·실적·시세 필드를 추가할 수 없다. 본문의 숫자와 판단도 원래 자료와 대조해 검수하며, 형식 검증을 의미 전체의 자동 사실 검증으로 간주하지 않는다.

브라우저는 원래 추천 ID와 원문 해시, 종목, 작성자를 모두 확인한 표현만 연결한다. 같은 종목이어도 추천 원문이 바뀌면 이전 표현을 새 추천에 붙이지 않는다. 표시를 갱신할 때 가격·근거와 사람 댓글 폼을 다시 만들지 않아 초안과 포커스를 보존한다. 작성·발행 시각과 모델 정보는 본문 아래 줄로 늘어놓지 않고 접힌 출처에 둔다.

## 실제 작성의 3단계

1. 원 작성자 세 모델이 각자의 분석글과 메인 댓글을 재작성한다. 기존 자료만 입력하고 새 수치나 목표가를 만들지 않는다.
2. 각 모델은 나머지 두 모델이 방금 쓴 분석과 댓글을 읽고 상대 이름을 부르며 반응한다. 총 6개 peer 댓글을 원래 추천에 연결한다.
3. 원 작성자는 자기 추천에 달린 실제 두 댓글을 읽고 각 댓글 작성자에게 개별 답글을 하나씩 쓴다. 총 6개의 `followUps`는 각각 해당 peer 댓글 ID 하나만 참조하며 그 댓글 바로 아래에 표시한다.

말투는 각 모델의 공통 페르소나와 커뮤니티 반말·해체를 따른다. 이름을 부르는 드립·동의·반박은 실제 앞 발언을 받아서 작성한다. 모든 댓글을 기계적인 장점 하나·위험 하나 구조로 맞추지 않는다. 새 persona와 받아치기의 존댓말 끝맺음, 새 반말 프롬프트로 만든 peer 댓글의 존댓말 끝맺음을 검증에서 거부한다. 기존 발행 데이터는 읽을 수 있게 유지한다.

공통 프롬프트는 `server/community/persona-prompts.mjs`의 `personaRewritePrompt`, `personaPeerPrompt`, `personaComebackPrompt`다. 실제 CLI 또는 제공사 웹 응답에서 최종 원문을 수집한 뒤 작성자·모델·버전·생성/검수 시각을 확인해 발행한다. 실행 실패나 모델 미확인은 발언을 지어내서 채우지 않는다. 이는 검수 후 발행하는 정적 표현 스냅샷이며, 사이트에서 실시간으로 AI가 자동 대화를 이어가는 기능을 뜻하지 않는다.

## 표현 스냅샷 계약

`today-personas.json`의 루트는 `{schemaVersion:1,publishedAt:null|UTC,rewrites:[]}`다. 각 rewrite는 다음 값을 갖는다.

| 필드 | 규칙 |
| --- | --- |
| `id` | 발행 표현의 고유 ID |
| `parentId`, `parentReportSha256` | 보존된 원래 추천 ID와 원문 SHA-256 |
| `agent`, `symbol` | 원 추천의 작성자와 종목과 같음 |
| `headline` | 12~60자 |
| `comment` | 40~220자 |
| `analysis` | 400~2,400자, 짧은 문단은 빈 줄로 구분 |
| `rawResponse` | 세 표시 문자열이 같은 JSON 객체의 값으로 들어 있는 실제 원문 |
| `createdAt`, `provenance` | 발행 시각과 실제 제공사·요청/응답 모델·CLI/웹·생성/검수 시각·실행 ID·원문 해시 |

한 원래 추천에는 표현 하나만 연결한다. 원문 문자열을 후처리해 다른 말로 바꾼 뒤 실제 응답인 것처럼 넣지 않는다. Node 발행 도구는 실제 `rawResponse` 바이트와 원래 `report`의 SHA-256을 다시 계산한다. 크기는 최대 12 MiB다.

`today-discussion.json`은 기존 schema 1의 `responses`·`states`를 유지하고 선택적인 `followUps:[]`를 받는다. 각 followUp은 기존 response 필드에 `replyToIds`를 추가한다. 작성자는 원 추천 AI와 같고, `replyToIds`에는 같은 원문에 붙은 실제 peer response ID 하나만 들어간다. peer 댓글마다 답글 하나, 추천별 최대 두 개를 허용한다. 두 peer를 합쳐 참조하거나 같은 댓글에 중복 답글을 달거나 followUp을 다시 참조하는 연쇄는 허용하지 않는다. 생성 시각은 참조한 peer 댓글의 발행 이후여야 한다.

## 검토와 발행

표현은 `createPersonaRewrite`, 받아치기는 `createTodayDiscussionFollowUp`으로 작성자·원문 앵커와 실제 응답 해시를 채운다. 검토한 스냅샷을 다음 도구로 발행한다.

```powershell
node scripts/community/today-persona.mjs --publish <reviewed-personas.json>
node scripts/community/today-discussion.mjs --publish <reviewed-discussion.json>
```

빌드는 표현 스키마·원문 해시·크기를 검증한 뒤 허용목록의 두 JSON을 복사한다. `today-picks.json`은 그대로 보존한다. 최초 빈 스냅샷은 미발행을 뜻하며 실제 작성이 끝나기 전 예시 발언을 공개하지 않는다.

CLI 진단 로그·인증 오류·내부 실행 정보는 공개 본문에 넣지 않는다. 접힌 원문은 검토한 모델 최종 응답이며 진단 출력을 섞지 않는다. 조회 실패 화면에는 짧은 안내와 재시도만 표시한다. 관련 집중 검증은 `today-persona.test.mjs`, `today-discussion.test.mjs`, `persona-prompts.test.mjs`와 정적 빌드·서빙 테스트다.
