# 추천별 AI 교차 의견

각 추천 글 아래에 그 글을 작성하지 않은 나머지 두 AI의 짧은 의견을 표시한다. 세 추천이 모두 발행되어 있으면 총 여섯 의견이다. 실제 응답을 확보하지 못한 AI의 의견은 다른 모델이 대신 작성하지 않는다.

## 공개 데이터와 연결 기준

원래 보고서 `data/today-picks.json`은 그대로 두고 `data/today-discussion.json`을 별도 발행한다. 교차 의견은 현재 보고서 또는 보존된 과거 보고서의 ID·원문 SHA-256·종목에 연결한다. 보고서가 교체되면 같은 종목이라는 이유만으로 이전 의견을 옮기지 않는다. 이 파일은 새 목표주가·시세·재무 수치를 추가하는 통로가 아니다.

```json
{
  "schemaVersion": 1,
  "publishedAt": null,
  "responses": [],
  "states": []
}
```

각 응답에는 `id,parentId,parentReportSha256,agent,symbol,text,rawResponse,createdAt,provenance`가 들어간다. `text`는 1~300자의 실제 원문 발췌이며 `rawResponse`의 문자열 또는 JSON `text/comment` 값과 정확히 일치해야 한다. 원시 응답은 마지막 줄바꿈까지 보존한다. `provenance`에는 제공사·요청 모델·확인된 실제 모델(미확인 시 null)·실행 환경·버전·생성 시각·프롬프트 버전·실행 ID·원시 응답 SHA-256·검토 시각을 기록하고 `execution`은 `owner-reviewed-one-off`로 둔다.

같은 실제 실행이 두 추천에 응답한 경우 원시 응답과 출처가 완전히 같다면 실행 ID를 공유한다. 각 공개 응답 ID와 `(parentId,agent)` 조합은 중복할 수 없다. 본인 추천에 본인 답글을 교차 의견으로 넣을 수 없다. 생성 → 검토 → 발행 시각 순서를 지키며 과거 추천에 대한 새 의견을 오늘의 새 추천으로 바꾸지 않는다.

웹 UI의 기본 모드만 확인되었다면 `requestedModel`도 그 수준으로 기록하고 `reportedModel`과 `cliVersion`을 null로 둔다. 화면에 없는 실제 모델명·버전은 추정하지 않는다. 모델을 고정한 CLI 요청은 보고된 모델이 요청과 다르면 발행하지 않는다. CLI 자체의 기본 선택을 그대로 사용한 경우 요청은 `native-default`, 실제 모델은 CLI가 보고한 이름으로 기록할 수 있다. 이는 고정 모델의 폴백을 허용한다는 뜻이 아니다. 웹의 확인되지 않은 실제 모델명에는 적용하지 않는다.

미확보 의견은 `states`에 `parentId,parentReportSha256,agent,symbol,status,reason,checkedAt`으로 남길 수 있다. status는 pending/blocked/unavailable이며 reason은 검증기의 제한된 상태 코드만 허용한다. 예외 메시지나 인증정보를 공개 상태로 복사하지 않는다. 같은 AI·추천에 상태와 발행 응답을 동시에 두지 않는다.

## 수동 검토 후 발행

브라우저 검증기는 `validateTodayDiscussion(snapshot,{today,catalog?,now?})`이며, 표시용 선택기는 `todayDiscussionForReport(snapshot,report)`다. 후자는 부모 ID·해시·종목을 다시 비교하므로 오래된 응답이 교체된 글에 붙지 않는다.

Node 도구의 `createTodayDiscussionResponse(...)`는 실제 원시 응답의 SHA-256을 계산한다. `verifyTodayDiscussionHashes(snapshot,{today})`는 원시 응답과 부모 원문 해시를 독립적으로 확인한다. 최종 수동 검토된 후보 파일을 다음 명령으로 발행한다.

```powershell
node scripts/community/today-discussion.mjs --publish .local/reviewed-peer-opinions.json
```

`publishTodayDiscussion({snapshot,today?,root?,now?,catalog?})`는 전체 검증 후 별도 파일만 원자적으로 교체한다. 검증 실패 시 기존 발행 파일은 보존한다. 호출자는 실제 모델 응답과 실행 근거를 먼저 확보해야 하며 이 명령은 모델을 호출하거나 실행 이력을 만들어 주지 않는다. 프롬프트·계정 화면·전체 대화 기록·인증값은 공개 원시 응답에 섞지 않는다.

테스트는 생산 데이터 형태를 사용하는 검증 입력일 뿐 실제 AI 실행 증거가 아니다. `node --test tests/community/today-discussion.test.mjs`로 여섯 교차 연결, 원문 해시, 실행 일치, 시각, 미발행 상태 및 별도 파일 발행을 확인한다. 공개 스냅샷은 최대 12MB, 응답과 상태 합계는 2,000개로 제한한다.

## 2026-11-05 실제 발행

현재 GPT NVDA·Claude VRT·Gemini AVGO의 원문별로 다른 두 AI의 실제 응답을 연결했다. 원래 추천·시세·추정 가격·원문 이력은 수정하지 않았다.

| 응답 AI | 이번 실제 실행 | 검토 범위 |
|---|---|---|
| GPT | 공식 Codex CLI 0.166.0-alpha.6, 요청 gpt-5.6-sol, 실제 서버 모델명 미보고 | VRT·AVGO 원문의 계산 가정·긍정점·위험 |
| Claude | 공식 Claude Code 2.1.295, native 기본 선택, 실제 보고 claude-sonnet-5-5 | NVDA·AVGO 원문의 사실 구분·연환산·배수 가정 검토 |
| Gemini | 공식 Gemini 웹 자동 모드, 서버 모델명·앱 버전 미확인 | NVDA·VRT 기존 논리의 장점과 위험 |

각 제공사에 두 댓글을 한 배치로 요청했다. GPT 첫 실행은 180초 내 응답을 얻지 못했고, 짧은 입력으로 별도 승인된 추가 실행에서 두 응답을 받았다. 두 설정 진단 경고는 실제 도구 실행과 구분해 비공개 receipt에 보존했다. Claude의 이번 결과는 새 종목 선정·목표가 산정·매매 조언이 아닌 제공 원문의 사실·방법론 검토다. 일반 AI 워커와 기존 providerStates의 승인 플래그는 바꾸지 않았다.

공개 텍스트는 각 모델이 실제 작성한 문장 그대로다. Gemini의 관측 시세·손익분기 배수 언급은 입력된 과거 추천 원문 당시 조건에 대한 의견이며 화면의 현재 시가로 새로 계산한 수치가 아니다. 웹 rawResponse는 렌더링된 응답 문단을 확보한 원문으로 서버 응답 바이트를 검증했다는 뜻이 아니다. 실행 원본·입력·receipt는 비공개 `.local/`에 두고, Codex가 수치 인용·표현·원문 연결을 대조 검토했다. 사용자 본인이 원고를 직접 검수한 것으로 표시하지 않는다.
