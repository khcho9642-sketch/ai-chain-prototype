# Google 로그인 설정과 운영 범위

## 현재 상태 — 2026-11-09

사용자 선택에 따라 Google Identity Services(GIS) 로그인과 서버 세션을 구현했다. 처음 로그인하면 Google 계정으로 회원을 만들고, 다시 로그인하면 같은 회원을 사용한다. 사용자 승인 후 Google 프로젝트 `ai-value-chain`과 회원 전용 Cloudflare D1 `ai-chain-members`를 생성하고 DB 스키마를 적용했다. Google OAuth 웹 클라이언트 ID, 운영 환경 연결·배포, 실제 Google 계정 로그인 검증은 아직 미완료다. 코드·자동 테스트 완료와 실제 운영 완료를 구분한다.

인증 경로는 `/api/auth/*`로 한정한다. `realtimeEnabled = false`와 기존 커뮤니티 회원·댓글·투표 API, SSE, 시세 수집·폴링, AI 워커의 중지를 유지한다. Google 회원 데이터는 기존 커뮤니티 SQLite DB와 분리한다. 기본 설정에서 `/api/auth/config`는 `enabled: false`를 반환하며 미설정 상태의 인증 요청은 성공으로 처리하지 않는다.

## Google 설정

[Google Cloud Console](https://console.cloud.google.com/auth/clients)의 운영 프로젝트 `ai-value-chain`에서 OAuth 클라이언트를 **웹 애플리케이션**으로 만든다. 앱 이름·지원 이메일·동의 화면을 실제 서비스에 맞게 설정한다. 사용자가 지정한 지원 이메일은 `khcho9642@gmail.com`이며, 현재 Console 로그인 계정과 달라 지원 이메일 선택을 확인 중이다. 앱 등록과 클라이언트 ID 발급은 아직 완료하지 않았다.

운영 클라이언트의 승인된 JavaScript 원본에는 `https://ai-chain-prototype.pages.dev`만 등록한다. 원본에는 경로·해시를 넣지 않는다. Google 정책에 따라 개발·테스트용 OAuth 클라이언트는 별도 개발 프로젝트에 만들고, 로컬 원본을 운영 클라이언트에 섞지 않는다. [운영·테스트 프로젝트 분리](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)

로컬 로그인을 검증할 때는 별도 개발 프로젝트에 실제 사용할 원본을 등록한다. localhost를 사용한다면 `http://localhost`와 `http://localhost:5175`를 함께 등록하고 개발 서버도 `HOST=localhost`로 실행한다. 기본 개발 주소인 `http://127.0.0.1:5175`를 사용하려면 해당 원본도 개발 클라이언트에 등록한다. 개발 프로젝트 생성·클라이언트 등록은 아직 실행하지 않았다.

포트나 호스트를 바꾸면 해당 환경의 Google 설정과 `AUTH_ORIGIN`도 실제 접속 주소에 맞춘다. 임의의 Pages 미리보기 주소를 자동 허용하지 않는다. 이 구현은 GIS JavaScript callback의 ID token을 검증하는 방식으로, OAuth client secret이나 토큰 교환용 redirect URI가 필요하지 않다. 로그인에 필요한 기본 신원 정보(`openid`, `email`, `profile`)만 사용하며 Gmail·Drive 접근 권한은 요청하지 않는다. [Google 공식 설정 안내](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)

기본 신원 범위만 요청하는 Sign in with Google에는 테스트 사용자 명단 예외가 적용된다. 테스트 사용자 사전 등록을 필수 조건으로 안내하거나 이 사이트의 회원 한도를 100명이라고 설명하지 않는다. 다른 OAuth 범위를 추가하면 이 예외가 사라질 수 있으며, 미승인 민감·제한 범위의 경고 화면에 적용되는 100명 사용자 제한과도 구분한다. 앱 공개 상태·브랜드 표시 요구사항과 Google Workspace 관리자의 접근 제한은 별도로 확인한다. [Google 사용자·공개 상태 안내](https://support.google.com/cloud/answer/15549945)

## 로컬 실행

Node.js 24와 현재 작업 사본에서 의존성을 설치한 뒤 PowerShell로 실행한다. 아래 ID는 운영 프로젝트가 아닌 별도 개발 프로젝트의 웹 클라이언트 ID를 사용한다.

```powershell
npm ci
$env:GOOGLE_CLIENT_ID = '개발용-웹-클라이언트-ID.apps.googleusercontent.com'
npm run dev
```

기본 접속 주소는 `http://127.0.0.1:5175`다. 개발 서버는 loopback에서만 인증용 HTTP를 허용하고 별도 `.local/members.sqlite`를 만들어 스키마를 적용한다. 기존 `.local/community.sqlite`와 다른 보관 DB는 변경하지 않는다. ID를 지정하지 않으면 로그인 설정 대기 상태로 실행한다. client ID는 공개 식별자이지만 실제 값이나 회원 DB를 예제 소스·공개 스냅샷에 넣지 않는다.

## Cloudflare Pages 연결

| 설정 | 용도 |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Google 웹 클라이언트 ID. 브라우저와 서버 audience 검증에 함께 사용 |
| `AUTH_ORIGIN` | `https://ai-chain-prototype.pages.dev`와 같은 정확한 인증 원본 |
| `MEMBER_DB` | 회원 전용 Cloudflare D1 바인딩 |

회원 DB 생성과 스키마 적용까지 완료했다. 운영 연결은 다음 상태를 기준으로 이어간다.

1. 완료: Cloudflare 무료 한도 화면을 확인하고 회원 전용 D1 `ai-chain-members`를 생성했다. 유료 전환이나 추가 유료 서비스는 신청하지 않았다.
2. 완료: `deploy/auth/0001-members.sql`의 테이블 4개·명시 인덱스 4개를 회원 DB에 적용했다. `wrangler.jsonc`의 `env.production`에 `MEMBER_DB` 바인딩과 `AUTH_ORIGIN`을 준비했으며, 배포 후 실제 연결 확인이 남아 있다.
3. 대기: Google 웹 클라이언트 ID 발급 후 Pages 운영 환경에 `GOOGLE_CLIENT_ID`를 설정하고 `AUTH_ORIGIN`을 확인한다. `AUTH_ALLOW_LOCAL_HTTP`는 운영에 설정하지 않는다. 미리보기 환경은 별도의 원본·DB를 준비하기 전까지 비활성으로 둔다.
4. 대기: 관련 테스트와 빌드를 통과한 작업 사본에서 기존 Pages 프로젝트에 배포한다. `functions/api/auth/[[path]].js`와 `server/member/google-auth.mjs`를 함께 포함하는 Functions 배포가 필요하다. 정적 `dist/` 파일만 호스팅하는 곳에서는 로그인 서버가 작동하지 않는다.
5. 대기: 실제 Google 계정으로 최초 로그인·새로고침 후 로그인 유지·로그아웃을 확인하고, 다른 브라우저에서 회원 식별과 인증 실패 표시를 확인한다. 설정 대기 또는 자동 테스트만으로 이 검증을 완료했다고 기록하지 않는다.

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
- Google 프로젝트 생성은 처음 자동 승인 검토에서 차단되었고, 이후 사용자가 새 프로젝트 생성·로그인 연결을 승인하여 `ai-value-chain`을 생성했다. 생성 시 기존 결제 계정이 자동 연결된 것을 확인해 이 프로젝트의 결제를 비활성화했다. Console의 비활성화 완료 알림과 연결 프로젝트 목록에서 제외된 상태로 확인했으며 기존 결제 계정 자체는 변경하지 않았다. 유료 전환은 실행하지 않았다.


## 연결 진행 — 2026-11-09

사용자가 결제 계정을 연결하지 않고 새 Google 프로젝트를 만든 뒤 구글 로그인을 연결하도록 승인했다. Google 프로젝트 `ai-value-chain` 생성 때 기존 결제 계정이 자동 연결되었으나, 이후 이 프로젝트의 결제를 비활성화한 상태를 확인했다. Cloudflare 무료 한도 화면(10 DB, 일 읽기 500만·쓰기 10만, 총 5GB)을 확인한 뒤 전용 D1 `ai-chain-members`를 생성하고 `0001-members.sql`의 테이블 4개·명시 인덱스 4개를 적용했다. DB 식별자는 `e979860b-4763-4b90-84a7-8c4e856ccabe`다. 이 정보는 인증 비밀이 아니다.

사용자가 지정한 지원 이메일 `khcho9642@gmail.com`의 선택과 앱 등록을 진행 중이며 Client ID는 아직 없다. 회원 DB를 준비했지만 운영 배포/실제 로그인은 아직 완료하지 않았다. 기존 Wrangler OAuth는 pages:write만 포함하고 d1:write는 없어 DB 생성·스키마 적용은 사용자의 로그인된 Cloudflare 대시보드에서 실행했다. 운영 D1 바인딩만 wrangler env.production에 준비하고 preview에는 DB를 연결하지 않는다.

사용자는 관리자 페이지를 만들지 않기로 했다. 현재 저장하는 가입일·Google 재로그인 시각·계정 상태로 회원 수와 최근 로그인 현황을 조회할 수 있다. last_login은 방문/활동 시각이 아니며 Google 표시 이름은 공개 닉네임과 구분한다. 이용 정지 시 세션도 함께 폐기한다. 전용 관리 CLI·탈퇴·문의 UI는 아직 만들지 않았고, 사용자와 범위를 정한 후 구현한다.


## 다음 연결 단계

지원 이메일 계정 `khcho9642@gmail.com`에 `ai-value-chain` 프로젝트의 OAuth 구성 편집자(`roles/oauthconfig.editor`) 역할을 추가하는 IAM 양식을 준비했다. 아직 저장하지 않았으며, 계정의 인증 설정 접근 권한을 새로 부여하는 작업이므로 사용자 확인을 기다린다. 확인 후 해당 계정으로 Console에 로그인해 지원 이메일을 선택하고 앱 등록을 이어간다. 프로젝트 전체 Editor/Owner 권한을 임의로 확대하지 않는다.

기본 신원 정보만 사용하는 로그인 기능 시험과 공개 운영 준비는 구분한다. Google의 인증 전용 운영 안내는 운영 앱의 브랜드 검증 제출, 홈페이지·개인정보 안내 및 도메인 소유 확인을 요구한다. 공유 호스팅에서 자체 도메인 사용은 권장 사항이며 `pages.dev` 하위 도메인의 검증 승인은 아직 확인하지 않았다. 현재 서비스의 개인정보/약관 페이지와 브랜드 검증은 준비되지 않았으므로 공개 운영 검증이 끝났다고 기록하지 않는다. [Google 인증 전용 운영 안내](https://developers.google.com/identity/verification/authentication-policy-compliance)
