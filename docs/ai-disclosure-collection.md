# OpenAI·Anthropic 발표자료 모니터

`scripts/collect-ai-disclosures.mjs`는 공식 웹페이지의 변경과 일부 새 발표문을 찾아 `data/ai-disclosures.json`에 기록한다. 수집 방식은 **공식 발표자료 웹 모니터링**이다. 매출·사용자 수를 제공하는 공개 API와 연결한 기능이 아니다. 승인된 통계는 `data/ai-statistics.json`에 출처·관측기간·단위와 함께 별도로 저장하며, 이 수집기는 해당 파일을 읽기만 한다.

## 실행

Node.js 24에서 저장소 루트를 기준으로 실행한다. 추가 패키지나 API 키가 필요하지 않다.

```sh
node scripts/collect-ai-disclosures.mjs
node scripts/collect-ai-disclosures.mjs --force
node scripts/collect-ai-disclosures.mjs --no-discovery
node tests/ai-disclosures.test.mjs
```

기본 실행은 `Asia/Seoul` 달력 날짜당 한 번이다. 같은 날 이미 시도한 기록이 있으면 성공 여부와 무관하게 기존 결과를 반환한다. 일시적인 오류를 다시 확인하려면 `--force`를 사용한다. `--no-discovery`는 기존 통계에 연결된 공식 출처만 확인한다. 실행 예약은 저장소의 GitHub Actions가 담당하며 이 스크립트 자체는 스케줄러를 설치하지 않는다.

## 확인 범위

다음 두 경로만 기사로 허용한다. 프로토콜은 HTTPS, 호스트는 정확히 해당 도메인 또는 그 `www` 별칭이어야 한다. 사용자정보가 들어간 URL, 비표준 포트, 그 밖의 경로는 요청하지 않는다. 쿼리와 해시를 제거하고 동일 출처를 중복 수집하지 않는다.

| 대상 | 허용 기사 경로 | 출처 발견 방법 |
| --- | --- | --- |
| OpenAI | `https://openai.com/index/<slug>/` | 통계에 연결된 출처 및 [공식 뉴스 RSS](https://openai.com/news/rss.xml) |
| Anthropic | `https://www.anthropic.com/news/<slug>` | 통계에 연결된 출처 및 [공식 뉴스 목록](https://www.anthropic.com/news) |

2026-10-26에 공식 OpenAI RSS 경로가 XML을 제공하고, Anthropic 공식 뉴스 목록에 기사 링크가 있는 것을 확인했다. 웹 검색 도구의 RSS 본문 파서는 해당 XML 형식을 열지 못했으므로, 이는 실제 수집 작업의 성공 확인을 뜻하지 않는다. 개별 실행의 성공 여부는 결과 파일의 상태와 확인일로 판단한다.

통계 파일의 `metrics[].observations[].sourceUrl`에서 공식 출처를 모은다. 호환을 위해 `metric.sourceUrl`과 `metric.sources`도 읽는다. Reuters 등 다른 매체, 개발자 문서, API 주소는 이 모니터의 대상에 포함하지 않는다.

새 글 탐색은 각 공식 목록에서 매출·사용자·기업고객·투자·컴퓨팅·토큰 등에 해당하는 영문 제목을 가진 기사 중 앞의 최대 6개만 선택한다. 다른 발행사의 링크나 외부 링크는 버린다. RSS의 CDATA 제목도 처리한다. 기사 링크를 전혀 확인하지 못한 목록이나 차단 화면은 실패로 기록한다. 정상 목록에서 관련 제목이 없으면 발견 건수는 0개다.

현재 실행은 **기존 통계의 공식 출처와 해당 실행에서 발견한 기사**를 확인한다. 이전 후보가 뉴스 목록에서 사라지고 아직 통계 출처에도 편입되지 않은 경우, 그 후보의 이전 확인 기록은 보존하지만 계속 순회하지 않는다. `detectedAt`은 이 프로그램이 발견한 시점이며 최초 발표일을 보장하지 않는다. 초기 실행에서 발견하는 기사에는 이전에 발행된 글도 포함될 수 있다.

## 요청 제한과 오류 처리

| 항목 | 기본 설정 |
| --- | --- |
| 기사 동시 요청 | 최대 3개; 함수 옵션으로 설정해도 상한 5개 |
| 뉴스 목록 | 고정된 2개 주소, 순차 요청 |
| 요청 제한시간 | 리디렉션을 포함한 요청당 15초 |
| 리디렉션 | 최대 3번, 매 이동 전에 동일한 호스트·경로 허용목록 검사 |
| 응답 크기 | 최대 3,000,000바이트; 헤더와 실제 수신 크기 모두 검사 |
| 응답 형식 | HTML·XHTML·XML·RSS XML |
| 기사 본문 | `<article>`, `<main>`, `<body>` 순으로 선택, 제목과 충분한 본문 확인 |

자동 리디렉션을 끄고 새 주소를 검증한 뒤 요청한다. 허용 도메인에서 외부·내부망 주소로 이동시키는 응답도 거절한다. 로그인·유료벽·봇 확인을 우회하지 않는다.

실패한 출처는 이전 `contentHash`, `title`, `checkedAt`, `lastChangedAt`을 유지하고 `lastAttemptAt`과 짧은 오류 상태만 추가한다. 첫 요청부터 실패했다면 해시와 확인일은 `null`이다. 뉴스 목록도 이전 성공 확인일을 보존한다. 일부 요청만 성공하면 상태는 `partial`이며, 전체 성공 시각인 `collection.lastSuccessAt`은 갱신하지 않는다.

네트워크 오류가 있어도 이전 자료와 오류 상태를 정상적으로 기록했다면 명령은 완료된다. 입력 JSON 손상, 허용되지 않은 저장 기록, 파일 쓰기 실패 등으로 결과를 만들 수 없으면 종료 코드 1을 반환하며 기존 결과 파일을 덮어쓰지 않는다. 쓰기는 임시 파일에서 완료한 뒤 원본 파일로 교체한다.

## 저장되는 자료와 검토 기준

본문에서 내비게이션·스크립트·푸터와 공백 차이를 제거한 뒤 제목과 본문을 SHA-256 해시로 비교한다. HTML, 본문 전문, 긴 인용문, 숫자 추출 결과는 공개 JSON에 저장하지 않는다. 제목은 최대 220자이며, 확인할 수 있으면 발표일도 짧은 날짜 문자열로 기록한다. 이 해시는 통계 변경을 확정하는 신호가 아니므로 문구 수정이나 페이지 구조 변경도 검토 후보가 될 수 있다.

| 경우 | 동작 |
| --- | --- |
| 이미 검토된 통계 출처의 첫 수집 | 해시 기준선만 기록하며 후보를 만들지 않음 |
| 기존 출처의 해시 변경 | `needs-review` 후보 생성 |
| 뉴스 목록에서 아직 검토되지 않은 출처 발견 | 본문 확인 성공 후 `needs-review` 후보 생성 |
| 동일 출처·동일 해시 재확인 | 확인일 갱신; 후보 중복 생성 안 함 |
| 실패·차단·본문 확인 불가 | 이전 성공 자료 유지; 통계나 현재 값 생성 안 함 |

검토 후보는 담당자가 원문을 열어 통계의 단위, 범위, 기준일, 비교 가능성을 확인할 자료 목록이다. 관련 수치가 있으면 검증 후 별도 변경으로 `ai-statistics.json`의 관측값과 출처를 업데이트한다. 후보의 `status`는 수동으로 `reviewed` 또는 `dismissed`로 기록할 수 있다. 수집기는 이미 존재하는 같은 해시의 검토 상태를 되돌리지 않는다.

### 공개 JSON 계약

```js
{
  schemaVersion: 1,
  collection: {
    method: 'web-monitor',
    status: 'not-run' | 'ok' | 'partial' | 'error',
    lastAttemptAt: null | 'ISO-8601 UTC',
    lastSuccessAt: null | 'ISO-8601 UTC',
    // 실행 뒤 추가되는 메타데이터
    attemptedSourceCount: 13,
    checkedSourceCount: 12,
    failedRequestCount: 1,
    timezone: 'Asia/Seoul'
  },
  sources: [{
    url, title, contentHash, checkedAt, lastChangedAt,
    // 선택 항목: publishedAt, lastAttemptAt, error
  }],
  candidates: [{
    id, url, title, detectedAt, status: 'needs-review', reason,
    // 선택 항목: publishedAt
  }],
  // 새 글 탐색을 실행한 경우에만 갱신
  discovery: [{ url, checkedAt, foundCount /* 또는 lastAttemptAt, error */ }],
  notes: []
}
```

`checkedAt`은 페이지 본문을 성공적으로 읽은 시점이다. 통계의 관측일이나 발표일과 다르다. `lastChangedAt`은 첫 기준선을 얻은 시점 또는 마지막으로 해시 변경을 관찰한 시점이다. 모든 저장 시각은 UTC ISO 문자열이며, 일별 실행 여부만 한국 달력 날짜로 판단한다. `attemptedSourceCount`와 `checkedSourceCount`는 각각 이번 기사 확인 시도 수와 성공 수이고, `failedRequestCount`에는 뉴스 목록 요청 실패도 포함한다.

### 모듈 함수

테스트와 작업 실행용으로 다음 함수를 내보낸다. Node 전용 모듈이므로 브라우저에서 가져오지 않는다.

- `emptyDisclosureSnapshot()` — 초기 상태 생성.
- `validateDisclosureSnapshot(snapshot)` — 저장 형식·해시·공식 URL 검증 후 원본 반환.
- `extractKnownDisclosureUrls(statistics)` — 승인 통계에 연결된 공식 URL 목록.
- `normalizeOfficialUrl(url, { discovery, base })` — URL 허용목록 검사 및 정규화.
- `extractDisclosureDocument(html)` — `{ title, contentHash, publishedAt? }` 반환.
- `discoverDisclosureLinks(body, { url, type, limit })` — 허용된 관련 기사 목록 반환.
- `fetchOfficialDocument(url, { fetcher, timeoutMs, discovery })` — 검사된 응답 본문과 최종 URL 반환. 본문은 메모리에만 존재.
- `collectDisclosures(previous, statistics, options)` — 이전 성공 자료를 보존하며 새 스냅샷 반환. `options`는 `fetcher`, `now`, `force`, `discover`, `timeoutMs`, `concurrency`, `discoveryLimit`을 지원.
- `collectDisclosureFile({ input, output, force, discover, fetcher, now })` — 기본 입력·출력 파일을 읽고 결과를 원자적으로 저장.

## 검증과 제한

`tests/ai-disclosures.test.mjs`는 실제 네트워크 대신 주입한 응답으로 허용 URL, 리디렉션, 크기·형식 제한, 기준선, 본문 변경, 중복 후보, 일부 실패, 실패 시 확인일 보존, 오류 문구 정리, KST 일별 실행, 동시성 제한을 검증한다. RSS·HTML 목록과 차단 응답도 검사한다.

테스트 통과는 실제 공식 사이트가 항상 접근 가능하다는 뜻이 아니다. 사이트의 봇 차단, HTML 구조 변경, RSS 누락, 제목 필터, 한 번에 읽는 기사 수 때문에 발견하지 못하는 발표가 생길 수 있다. 이 기능은 모든 발표를 수집하는 통계 데이터베이스나 실시간 사용자·매출 계측 서비스가 아니다. 공개되지 않은 수치를 생성하거나 과거 발표를 오늘의 관측값으로 바꾸지 않는다.
