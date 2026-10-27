# AI 종목 의견·댓글 구현 현황

기존 커뮤니티는 PR #1을 통해 main `2f79942dad6ba71d419c461054b0cd75acb893d8`에 병합됐다.
2026-10-27 v4 추가 개발은 최신 main의 새 브랜치에서 진행한다. 요구사항 원본은
[PRD v4](AI_Chat_Opinion_PRD_v4.md), 변경별 구현·검증·마이그레이션과 남은 활성화 조건은
[v4 구현 및 검수](v4-implementation.md)에 기록한다.
**코드 병합·정적 화면 배포와 공유 댓글 서버·실제 제공사 CLI 운영은 각각 다른 상태다.**

## 이번 추가 구현

- 기존 종목 차트 아래에 종목별 댓글창 연결. 기업 카드의 토론 링크와 `#talk/NVDA` 같은 직접 링크 제공.
- 시세 화면이 갱신돼도 작성 중 초안 유지. 종목 전환 시 초안·답글 대상 분리.
- 기존 Node/SQLite 코드를 별도 상시 서버용 공유 API로 분리. 프런트엔드와 로컬 CLI PC는 HTTPS로 연결.
- 초대 가입·로그인·로그아웃, 관리자/일반회원/워커 권한 분리. 비밀번호와 세션/초대 토큰 해시 저장.
- CORS 허용 목록, HTTPS/Host 검증, 로그인·작성 제한, 개인정보가 없는 연결 상태 표시.
- 종목별 AI 중지, 일일 한도 설정, 서버 허용+관리자 선택 시에만 자동 게시.
- 기존 DB 유지 마이그레이션, SQLite 온라인 백업 도구.
- 개발용 Windows 로그인 시작·2시간 외부 감시 스크립트. 수동 중지 존중, 24시간 내 최대 3회 복구.
- 이벤트 기반 처리 유지. 게시글 1~5분 폴링 없음. MCP·유료 AI API·모의투자 없음.

## 실행 구조

```
기존 GitHub Pages 또는 Vercel 화면
            │ HTTPS
별도 상시 Node API + 영속 SQLite (서버 1개, 프로세스 1개)
            │ HTTPS 이벤트 구독 / 작업 점유·결과 전달
로컬 PC의 GPT·Claude·Gemini CLI 워커
```

이는 Supabase나 새로운 유료 서비스를 가입시킨 것이 아니다. **공유 API를 실제 실행할 서버와
HTTPS 도메인은 아직 지정·배포하지 않았다.** SQLite를 Vercel 함수의 임시 디스크에 올리지 않는다.
공유 API가 별도 서버에서 실행 중이면 로컬 CLI PC가 꺼져도 사람 댓글과 AI 작업은 서버에 남는다.
사이트와 API까지 모두 같은 로컬 PC에서 실행하면 PC 종료 중에 새 글을 받을 수 없다.

## 사용 문서

- 공개용 준비·환경변수·계정·백업·운영 한계: [ai-community-public.md](ai-community-public.md)
- 기존 CLI 격리·인증 설정 예시: [ai-community-local-v1.md](history/ai-community-local-v1.md) — 1차 구현 당시 기록
- Windows: `scripts/windows/Manage-AiWorker.ps1` — 직접 실행하기 전 `-WhatIf`로 확인

## 검증 범위

추가 단위·HTTP 통합 테스트는 `tests/community/community-public.test.mjs`에 있다.
기존 테스트와 함께 `npm test`로 실행한다. 실제 모델 API/CLI 호출 없이 임시 DB·fixture를 사용한다.
선택 브라우저 테스트 `tests/browser-smoke.py`는 임시 HTTPS 서버 2개에서 CORS, 로그인,
다른 브라우저의 공용 댓글, 종목 상세 댓글창, 초안 보존, 모바일 폭, 관리자 권한을 검사한다.
`Community PR checks`는 Linux/Windows 테스트, PowerShell 구문 검사 및 브라우저 검증을 수행한다.
**성공 여부는 해당 커밋의 CI 결과를 확인한다. 테스트 추가 자체를 통과로 보지 않는다.**

## 아직 필요한 운영 준비

1. 공유 API 서버·도메인·영속 디스크 선택 및 운영 배포 승인.
2. 실제 제공사 CLI의 로그인·설치 버전·계정 이용 조건·OS 격리 검증.
3. 실제 세 모델의 댓글 품질과 차단 규칙 검수 후 AI별 활성화.
4. 백업 보관 위치, 운영자 계정, 악성 사용자 대응, 개인정보 처리 고지 확정.

자동 게시 기본값은 OFF이며, 실제 모델을 실행하지 않았다. 이 단계의 브라우저용 AI 댓글은
`fixture-not-real-ai`로 표시되는 임시 검증 데이터다. 실제 운영 데이터로 이관하지 않는다.

## Oracle 운영 준비 추가

산업통계·AI 통계·토큰·공시 기능과 기존 커뮤니티 코드는 PR #1을 통해 함께 main에 병합됐다. 아래 Oracle 준비 기록이 공유 API의 실제 운영 개시를 뜻하지는 않는다.

API 전용 소스 패키지와 SHA-256 manifest 생성은 `npm run community:package`, 실제 HTTPS 서버의 읽기 전용 연결 검사는 `npm run community:check -- API_ORIGIN SITE_ORIGIN`이다. 검사는 초대 가입·관리자 승인 모드와 CORS를 확인하며 실제 AI 호출을 실행하지 않는다. [Oracle 시작 안내](oracle-community-quickstart.md)를 따른다. 현재 Oracle 계정·서버·API 도메인은 없으며 Gemini CLI도 설치가 확인되지 않았다. 새 계정·VM·유료 서비스·PC 자동 시작을 만들거나 운영 배포하지 않았다.
