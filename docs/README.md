# 개발 문서 안내

실행 명령과 기능 개요는 [프로젝트 README](../README.md), 사용자 목표와 첫 출시 기준은 [PLAN](../PLAN.md), 파일 배치는 [프로젝트 구조](project-structure.md)를 따른다. 아래 실행 예시의 상대 경로는 모두 저장소 루트를 기준으로 한다.

## 데이터 수집과 검토

| 문서 | 내용 |
| --- | --- |
| [시세·기업·피어 비교](data/market.md) | Yahoo Finance 출처·조회 환경·관심종목 저장·고리별 비교 계산 |
| [산업통계 출처](data/industry-sources.md) | ECOS·TWSE·관세청 자료, 단위와 수집 한계 |
| [AI 사업·산업 검토 통계](data/ai-statistics.md) | 지표 정의·관측 범위·검토 원본·수치 승인 |
| [OpenRouter 토큰 통계](data/ai-tokens.md) | 공식 API·인증·일별 집계·결측·실패 보존 |
| [국내 기업 공시](data/company-disclosures.md) | DART 회사 RSS, 회사 연결, 보존 기간과 오류 처리 |
| [AI 발표자료 감시](data/ai-disclosure-collection.md) | OpenAI·Anthropic 공식 문서 변경과 검토 후보 |

검토 원본과 공식 출처 근거는 `research/`, 검증된 공개 스냅샷은 `data/`에서 관리한다. 실패·미확인 값을 0으로 채우지 않고 각 지표의 출처·단위·관측기간을 보존한다.

## 사이트 배포

[정적 사이트·스냅샷·API 배포](deployment/overview.md)에서 GitHub Pages·Vercel의 차이, 공개 JSON 6종 허용목록, 예약 수집·복원·배포 순서와 커뮤니티 패키지 준비를 확인한다.

## 커뮤니티와 운영

| 문서 | 내용 |
| --- | --- |
| [커뮤니티 구현 현황](community/ai-community.md) | 현재 구현·테스트와 운영 미완료 범위 |
| [AI 의견·댓글 PRD v4](community/AI_Chat_Opinion_PRD_v4.md) | 사용자 제공 요구사항 원본 |
| [v4 구현·검수·마이그레이션](community/v4-implementation.md) | 의견·이력·근거·큐 변경과 검증 범위 |
| [제공사 CLI 확인](community/cli-verification.md) | 기술 지원·인증·이용 조건·활성화 차단 상태 |
| [공유 API 운영 가이드](community/ai-community-public.md) | 서버·인증·계정·AI 워커·백업 |
| [Oracle 서버 준비](community/oracle-community-quickstart.md) | 계정 준비부터 API 연결 확인까지 |
| [1차 로컬 구현 기록](community/history/ai-community-local-v1.md) | 과거 CLI 설정·격리 방식의 참고 기록 |

운영 설정 예제는 `deploy/`, 디자인 원본은 `design/`에 있다. 가입 자료·DB·준비된 릴리스·보관 원본은 Git에서 제외된 `.local/`에 둔다. 개발 대상은 이 저장소의 AI 밸류체인 사이트 하나다.
