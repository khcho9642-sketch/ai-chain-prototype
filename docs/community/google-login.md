# Google 로그인 설정과 운영 범위

## 현재 상태 — 2026-11-09

사용자 선택에 따라 Google Identity Services(GIS) 로그인과 서버 세션을 구현했다. 처음 로그인하면 Google 계정으로 회원을 만들고, 다시 로그인하면 같은 회원을 사용한다. Google OAuth 웹 클라이언트 ID는 아직 확보하지 않았으며 Cloudflare D1 생성·연결, 운영 배포, 실제 Google 계정 로그인 검증은 미완료다. 코드·자동 테스트 완료와 실제 운영 완료를 구분한다.

인증 경로는 `/api/auth/*`로 한정한다. `realtimeEnabled = false`와 기존 커뮤니티 회원·댓글·투표 API, SSE, 시세 수집·폴링, AI 워커의 중지를 유지한다. Google 회원 데이터는 기존 커뮤니티 SQLite DB와 분리한다. 기본 설정에서 `/api/auth/config`는 `enabled: false`를 반환하며 미설정 상태의 인증 요청은 성공으로 처리하지 않는다.

## Google 설정

[Google Cloud Console](https://console.cloud.google.com/auth/clients)에서 해당 서비스의 OAuth 클라이언트를 **웹 애플리케이션**으로 만든다. 앱 이름·지원 이메일·동의 화면을 실제 서비스에 맞게 설정하고, 테스트 상태라면 사용할 테스트 계정을 등록한다.

승인된 JavaScript 원본에는 사용할 주소를 정확히 등록한다. 원본에는 경로·해시를 넣지 않는다.

- 운영: `https://ai-chain-prototype.pages.dev`
- 기본 로컬 개발: `http://127.0.0.1:5175`
- localhost로 접속할 때: `http://localhost`와 `http://localhost:5175`

포트나 호스트를 바꾸면 Google 설정과 `AUTH_ORIGIN`도 실제 접속 주소에 맞춘다. 임의의 Pages 미리보기 주소를 자동 허용하지 않는다. 이 구현은 GIS JavaScript callback의 ID token을 검증하는 방식으로, OAuth client secret이나 토큰 교환용 redirect URI가 필요하지 않다. 로그인에 필요한 기본 신원 정보(`openid`, `email`, `profile`)만 사용하며 Gmail·Drive 접근 권한은 요청하지 않는다. [Google 공식 설정 안내](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)

## 로컬 실행

Node.js 24와 현재 작업 사본에서 PowerShell로 실행한다.

```powershell
$env:GOOGLE_CLIENT_ID = '발급받은-웹-클라이언트-ID.apps.googleusercontent.com'
npm run dev
```

기본 접속 주소는 `http://127.0.0.1:5175`다. 개발 서버는 loopback에서만 인증용 HTTP를 허용하고 별도 `.local/members.sqlite`를 만들어 스키마를 적용한다. 기존 `.local/community.sqlite`와 다른 보관 DB는 변경하지 않는다. ID를 지정하지 않으면 로그인 설정 대기 상태로 실행한다. client ID는 공개 식별자이지만 실제 값이나 회원 DB를 예제 소스·공개 스냅샷에 넣지 않는다.

## Cloudflare Pages 연결

| 설정 | 용도 |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Google 웹 클라이언트 ID. 브라우저와 서버 audience 검증에 함께 사용 |
| `AUTH_ORIGIN` | `https://ai-chain-prototype.pages.dev`와 같은 정확한 인증 원본 |
| `MEMBER_DB` | 회원 전용 Cloudflare D1 바인딩 |

운영 연결 순서는 다음과 같다. 아래 단계는 아직 실행하지 않았다.

1. 현재 Cloudflare 계정의 무료 요금제와 기존 사용량을 확인하고 회원 전용 D1 DB를 만든다. 유료 전환이나 추가 유료 서비스를 자동으로 신청하지 않는다.
2. `deploy/auth/0001-members.sql`을 회원 DB에 적용하고 Pages 프로젝트에 `MEMBER_DB`로 연결한다. 회원·세션·nonce·요청 제한 테이블을 기존 커뮤니티 DB와 분리한다.
3. Pages 운영 환경에 `GOOGLE_CLIENT_ID`와 `AUTH_ORIGIN`을 설정한다. `AUTH_ALLOW_LOCAL_HTTP`는 운영에 설정하지 않는다. 미리보기 환경은 별도의 원본·DB를 준비하기 전까지 비활성으로 둔다.
4. 관련 테스트와 빌드를 통과한 작업 사본에서 기존 Pages 프로젝트에 배포한다. `functions/api/auth/[[path]].js`와 `server/member/google-auth.mjs`를 함께 포함하는 Functions 배포가 필요하다. 정적 `dist/` 파일만 호스팅하는 곳에서는 로그인 서버가 작동하지 않는다.
5. 실제 Google 계정으로 최초 로그인·새로고침 후 로그인 유지·로그아웃을 확인하고, 다른 브라우저에서 회원 식별과 인증 실패 표시를 확인한다. 설정 대기 또는 자동 테스트만으로 이 검증을 완료했다고 기록하지 않는다.

Pages Functions는 `/api/auth/*`만 실행하도록 제한한다. 기존 데이터·지도·차트는 저장 스냅샷을 계속 제공한다. Pages 파일 라우팅과 D1 바인딩은 [Functions 라우팅](https://developers.cloudflare.com/pages/functions/routing/)과 [D1 API](https://developers.cloudflare.com/d1/worker-api/d1-database/)를 따른다.

## 인증 계약과 데이터

| 요청 | 결과 |
| --- | --- |
| `GET /api/auth/config` | `enabled`, 공개 `clientId`; 설정 누락이면 `enabled: false` |
| `GET /api/auth/nonce` | 10분 nonce와 해당 브라우저에 묶인 HttpOnly 쿠키 |
| `POST /api/auth/google` | JSON `{credential}` 검증 후 회원과 7일 세션 쿠키 |
| `GET /api/auth/me` | 현재 회원 또는 `user: null` |
| `POST /api/auth/logout` | JSON `{}`로 서버 세션 삭제·쿠키 만료 |

Google 서명·발급자·client ID·만료·nonce를 서버에서 검증한다. 회원 연결키는 Google `sub`이며 이메일로 기존 계정을 자동 연결하지 않는다. 저장 정보는 회원 ID, Google 식별자, 이름·이메일, 생성·로그인 시각 등 인증에 필요한 범위다. 비밀번호는 받지 않는다. Google ID token 원문을 저장하지 않고 세션·nonce는 해시로 저장한다. 운영 세션 쿠키는 HttpOnly·Secure 속성을 사용하며 인증 응답은 캐시하지 않는다. [Google ID token 검증 기준](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)

검증은 정상·재로그인, 위조/만료/다른 audience 토큰, nonce 불일치·재사용, 다른 Origin, 세션 만료·로그아웃, 미설정/DB 오류, 기존 실시간 API 차단을 포함한다. 실제 Google 계정 검증은 별도 실행 기록으로 남긴다.

## 무료 사용량 기준

2026-11-09 공식 문서 확인 기준이다. 실제 계정 상태와 사용량은 운영 연결 전에 다시 확인한다.

| 항목 | 무료 한도 |
| --- | --- |
| Pages Functions | Workers와 합산 하루 100,000 요청; UTC 자정 초기화 |
| D1 읽기 | 하루 5,000,000행 |
| D1 쓰기 | 하루 100,000행 |
| D1 저장 | DB당 500 MB, 계정 합계 5 GB |

[Pages Functions 요금](https://developers.cloudflare.com/pages/functions/pricing/), [D1 요금](https://developers.cloudflare.com/d1/platform/pricing/), [D1 한도](https://developers.cloudflare.com/d1/platform/limits/)

정적 파일 요청은 Functions를 호출하지 않으면 무료·무제한이지만 인증 요청은 별도 집계된다. D1은 요청 수가 아니라 읽고 쓴 행 수를 계산하므로 이 수치를 지원 회원 수로 바꾸거나 특정 회원 수를 보장하지 않는다. 로그인 빈도·세션 확인·인덱스·계정의 다른 서비스 사용량도 영향을 준다. 한도 초과 시 유료 전환을 자동으로 진행하지 않는다.


## 개발 검증 기록 — 2026-11-09

- `npm test`: 전체 759개 통과. Google 서명 토큰 검증·세션·nonce 보안 검사, 브라우저 API 클라이언트, 로컬 HTTP 어댑터, 기존 실시간 API 차단 회귀 검사 포함.
- `wrangler pages functions build`: Cloudflare Worker 컴파일 통과.
- Chrome 데스크톱 및 390px 모바일: 헤더 로그인 버튼·모달·닫기와 초점 복원·설정 대기 표시 확인. Google client ID가 없으므로 실제 Google 버튼/계정 로그인 검증은 미완료.
- Google Cloud Console의 `AI Value Chain` 프로젝트 생성 양식을 준비했다. 프로젝트 생성은 자동 승인 검토에서 영구 리소스 생성에 대한 구체 승인이 필요하다는 이유로 차단되어 제출하지 않았다. 사용자 승인 후 등록을 이어간다. 결제 계정 연결·유료 전환은 실행하지 않았다.
