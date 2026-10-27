# OpenRouter 공식 토큰 통계

저장소의 초기 토큰 자료는 2026-10-25 공개 순위에서 검토한 모델 10개의 반올림 스냅샷이다. 상위 10개 합계를 플랫폼 전체 사용량으로 표시하지 않는다. API 연결 여부·마지막 시도·마지막 성공과 자료의 관측일을 따로 표시한다.

`npm run collect:tokens`는 [OpenRouter 공식 Data API](https://openrouter.ai/docs/cookbook/administration/data-api)의 `GET /api/v1/datasets/rankings-daily`를 사용한다. 기본 범위는 현재 UTC 날짜를 제외한 완료된 90일이며, `npm run collect:tokens -- --force --days 90` 형태로 강제 재수집과 1~366일 범위를 지정할 수 있다. 같은 UTC 날짜에 이미 성공했으면 기본 실행은 건너뛴다.

GitHub Actions는 Secret `OPENROUTER_API_KEY`를 수집기 환경변수로 전달한다. 로컬 수집기도 같은 환경변수를 읽는다. 브라우저, 코드, 공개 JSON과 로그에는 키를 포함하지 않는다. 키가 없으면 외부 요청 없이 이전 자료를 보존하고 `missing-key` 상태로 정상 종료한다. 초기 저장소 상태는 API 미연결이며, 성공 수집이 확인되기 전에는 실시간 자료로 표시하지 않는다.

성공 시 API의 일별 상위 50개 모델과 `other`가 초기 검토 스냅샷을 대체한다. API 집계에서만 공개 플랫폼 합계를 계산하며, 개발사 합계는 화면에 식별된 모델 범위다. 비공개·Zero Data Retention 트래픽은 공개 집계 범위에 포함되지 않으므로 이를 회사 전체 토큰 사용량으로 확대하지 않는다. 입력·출력 토큰 합계는 정수 문자열과 `BigInt`로 보존하고, 7일 이동평균은 연속한 UTC 날짜 7개가 있을 때만 계산한다. 서로 다른 모델의 토크나이저 차이도 고려해야 한다. 출처와 기준시점, CC BY 4.0 표시를 유지한다.

API 오류·호출 제한·유효하지 않은 응답은 이전 관측과 `lastSuccessAt`을 유지한 채 `error`로 기록한다. 재수집한 날짜는 모델별 덧붙이기가 아니라 날짜 단위로 교체해 상위권 이탈 모델과 `other`의 중복을 막는다. 응답에 빠진 이전 API 관측일은 보존하고 관련 메타데이터를 남기며, 결측일을 0으로 만들지 않는다.

이 자료는 [검토한 사업·산업 통계](ai-statistics.md)와 별도로 수집한다. 공개 스냅샷 API와 예약 배포는 [배포 안내](../deployment/overview.md)를 따른다.
