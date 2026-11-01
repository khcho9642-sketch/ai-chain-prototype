# Epoch AI 산업데이터

[Epoch AI](https://epoch.ai/data)의 공개 CSV 4종에서 필요한 열을 선택해 하나의 `data/epoch-ai.json`으로 제공한다. AI 모델·반도체 사양·데이터센터·칩 판매 추정을 탐색하는 자료이며, 각 목록의 행 수는 산업 전체 규모나 서로 중복되지 않는 기업 수가 아니다.

## 출처와 공개 범위

| 데이터셋 | 공식 설명·원본 | 공개 항목·단위 | 해석 범위 |
| --- | --- | --- | --- |
| `models` 주요 AI 모델 | [설명](https://epoch.ai/data/ai-models-documentation/downloads) · [CSV](https://epoch.ai/data/notable_ai_models.csv) | 모델·개발기관·발표일·국가, 파라미터 수, 학습 연산량(FLOP), 학습 비용 추정(2023 USD), 원자료 Confidence | Epoch가 선정한 주요 모델이며 전체 출시 목록이 아니다. 연산량·비용에는 추정치가 포함된다. |
| `hardware` AI 반도체 사양 | [설명](https://epoch.ai/data/machine-learning-hardware) · [CSV](https://epoch.ai/data/ml_hardware.csv) | 칩·제조사·출시일·유형, FP8 성능(FLOP/s), 메모리(bytes), TDP(W), 출시 가격(USD) | 사양상 연산 성능은 실제 서비스 처리량과 다르다. TDP는 칩 설계 전력이며 데이터센터 전체 전력 소비가 아니다. |
| `data-centers` AI 데이터센터 | [설명](https://epoch.ai/data/ai-data-centers) · [CSV](https://epoch.ai/data/data_centers/data_centers.csv) | 시설·소유자·국가·사용자·칩, 현재 H100 환산량(H100e), IT 전력용량(MW), 자본비용(십억 2025 USD) | Epoch가 추적하는 대형 시설의 현재 상태 추정으로, 전 세계 모든 시설을 포괄하지 않는다. |
| `chip-sales` AI 칩 판매 추정 | [설명](https://epoch.ai/data/ai-chip-sales) · [CSV](https://epoch.ai/data/ai_chip_sales_timelines_by_chip.csv) | 제조사·칩·기간·미완료 여부, 판매량 추정(개), 판매량 5·95백분위, H100e 중앙값, 판매금액 추정(USD) | 칩·기간별 추정이며 회사가 공시한 확정 출하·매출이 아니다. 미완료 기간을 완결 분기와 구분한다. |

2026-11-01 19:09:38 KST(`2026-11-01T10:09:38.092Z`) 로컬 수집본은 모델 1,091행, 반도체 사양 183행, 데이터센터 96행, 칩 판매 추정 171행으로 총 1,541행이다. 이는 해당 수집본의 확인 기록이며 이후 원자료 변경에 따라 달라진다. 수집·구현 기록은 운영 배포 완료를 뜻하지 않는다.

공개 JSON에는 `assets/epoch-ai-core.js`의 `EPOCH_DATASETS`에 정의된 열과 행 식별자만 저장한다. CSV의 전체 열을 자동 공개하지 않는다. 모델 비용의 2023 USD와 데이터센터 자본비용의 2025 USD를 현재 명목 USD로 바꾸거나 합산하지 않는다.

## 수집 명령과 주기

Node.js 24에서 저장소 루트를 작업 폴더로 사용한다. 공개 CSV를 읽으므로 API 키는 필요하지 않다.

```sh
npm run collect:epoch
npm run collect:epoch -- --force
npm run collect:epoch -- --no-evidence
```

- 기본 명령은 UTC 날짜별 첫 수집 시도에만 네 CSV를 요청한다. 같은 UTC 날짜에 이미 시도했으면 실패 여부와 관계없이 저장된 스냅샷을 유지하고 외부 요청을 생략한다.
- `--force`는 같은 날짜에도 수집을 다시 시도한다.
- `--no-evidence`는 원본 CSV와 출처 기록의 새 저장을 생략한다. 기존 연구 근거를 삭제하지 않으며 공개 JSON의 검증·실패 보존은 유지한다.
- GitHub Pages 예약 작업은 약 30분마다 실행되지만 Epoch 수집기는 위 일일 제한을 적용한다. 작업은 이전 스냅샷을 검증해 복원한 뒤 `npm run collect:epoch -- --no-evidence`를 실행한다. 예약 실행 시각은 지연될 수 있다.

수집기는 각 CSV에 45초 제한과 20,000,000바이트 원자료 제한을 적용하고 리디렉션을 허용하지 않는다. 필수 열·CSV 구조·자료형을 검증한 뒤 공개 스냅샷을 임시 파일에 쓰고 교체한다. 공개 JSON과 API 응답은 3,800,000바이트 한도를 적용한다.

## 결측·추정과 수집 상태

빈 수치·날짜와 원자료의 `Unknown`, `N/A` 등 수치·날짜 결측 표기는 `null`로 보존하며 0으로 채우지 않는다. 텍스트 열의 `Confidence` 값은 `Unknown`을 포함해 원문 분류를 유지한다. 이를 사이트가 계산한 신뢰 확률로 바꾸지 않는다. 연도·연월만 있는 날짜도 임의의 관측일을 채우지 않는다.

각 데이터셋은 `status`, `lastAttemptAt`, `lastSuccessAt`, `error`, `rawRowCount`, `rows`를 가진다. 수집 또는 형식 검증이 실패하면 그 데이터셋의 이전 행과 마지막 성공 시각을 남기고 현재 실패 상태를 기록한다. 다른 데이터셋의 정상 갱신은 반영한다. 이전 성공 자료가 없는 데이터셋은 빈 행을 유지한다.

전체 `collection.status`는 `ok`·`partial`·`error`·`not-connected`를 구분한다. 전체 `lastSuccessAt`은 네 데이터셋이 모두 성공한 시각이며 개별 데이터셋의 성공 시각과 다를 수 있다. 일부 또는 전체 수집 실패 시 명령은 종료 코드 1을 반환한다. `generatedAt`과 수집 시각은 자료를 가져온 시각이며 모델 발표일·판매 기간·시설 상태의 원래 관측일을 대신하지 않는다.

`scripts/deployment/restore-ai-snapshots.mjs`는 검증된 Pages 파일만 복원한다. 로컬의 최근 시도 시각이 더 최신이거나, 한 데이터셋이라도 로컬 성공 시각이 원격보다 최신이면 원격 스냅샷 전체를 거절해 로컬 자료를 보존한다.

## 연구 근거와 라이선스

기본 수집은 성공한 각 데이터셋에 대해 `research/epoch-ai/YYYY-MM-DD/<id>.csv`와 `<id>.source.json`을 저장한다. 날짜는 UTC 기준이다. 출처 기록에는 CSV URL·설명 페이지·라이선스·수집 시각·행 수·헤더·SHA-256이 포함된다. 같은 날짜의 재수집은 해당 날짜 파일을 갱신하므로 실행마다 별도 버전을 만드는 구조는 아니다.

원본과 근거는 정적 빌드 대상이 아니다. 빌드는 검증된 `data/epoch-ai.json` 한 개만 명시적 공개 허용목록에 따라 `dist/data/`에 복사한다.

자료의 출처와 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 링크를 화면·스냅샷·CSV에 표시한다. 원자료의 열 선택과 한국어 표제 적용 사실을 공개 JSON에 다음과 같이 기록한다.

```text
Source: Epoch AI, CC BY 4.0. Selected fields and Korean labels by AI CHAIN.
```

## 화면과 읽기 전용 API

산업 화면 `#industry`의 **Epoch AI** 탭에서 네 데이터셋을 선택하고 이름·기관·제품·지역 등 표시 열을 검색한다. 표는 페이지당 25개 또는 50개를 표시한다. CSV는 현재 데이터셋의 전체 행 또는 검색 조건에 맞는 전체 결과를 내보내며 현재 페이지에만 한정하지 않는다. 내보낸 CSV에는 단위·출처·라이선스·마지막 수집 성공 시각을 포함한다.

**최신 수집값 읽기**는 저장된 공개 스냅샷을 다시 읽는다. 원천 CSV 수집을 실행하지 않는다. GitHub Pages에서는 `data/epoch-ai.json`, 로컬·Vercel에서는 `/api/epoch-ai`를 읽는다. 로컬 API는 로컬 파일을 제공하고 Vercel 함수는 Pages의 같은 JSON을 조회·검증해 제공한다. API는 GET·HEAD를 지원하며 다른 메서드는 405를 반환한다. API 조회 실패와 원자료 수집 실패를 구분한다.

구현은 `assets/epoch-ai-core.js`, `assets/epoch-ai.js`, `assets/epoch-ai.css`, `scripts/data/collect-epoch-ai.mjs`, `api/epoch-ai.js`에 있다. 데이터 검증·수집 동작은 `tests/data/epoch-ai.test.mjs`, 공개 파일·로컬 API 계약은 `tests/market/market-server.test.mjs`에서 확인한다. 운영 배포는 [배포 안내](../deployment/overview.md)의 검증 순서를 따른다.
