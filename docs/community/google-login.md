# Google 로그인 설정과 운영 범위

## 현재 상태 — 2026-11-09

Google 프로젝트 `ai-value-chain`과 회원 전용 Cloudflare D1 `ai-chain-members`를 연결해 커밋 `266322f`를 운영 배포했다. 실제 Google 계정의 로그인 상태·새로고침 후 로그인 유지·로그아웃을 관찰했고 Google 앱을 외부 사용자용 프로덕션으로 전환했다. 공개 전환 후 추가 재로그인 시험은 컴퓨터 사용 도구 중단으로 미완료다.

앞선 사용자 요청으로 Google 인증 뒤 닉네임 하나만 입력하는 가입 흐름을 추가했다. 닉네임이 없는 신규·기존 회원에게 최초 설정을 안내하고 사이트의 회원 표시·내 계정·회원 API 응답에는 Google 실명·이메일을 포함하지 않는다. Google이 제공하는 로그인 버튼·계정 선택 화면에는 Google 이름·이메일이 표시될 수 있다. 닉네임용 운영 DB 마이그레이션과 커밋 `48a9e0764d5cf09dc748659c82b1442ba0b1eb2f`의 운영 배포를 완료했다. 닉네임 기능의 최초 배포는 [2ec91d54](https://2ec91d54.ai-chain-prototype.pages.dev/)이며, 개인정보 안내 문구를 보완한 최종 운영본은 `b7022665587dcb5a15cff97c6e16d350061798b5`([81b45430](https://81b45430.ai-chain-prototype.pages.dev/))이다. 최종 보완은 개인정보 안내와 그에 따른 첫 화면 출력만 변경했고 인증 Functions는 동일하다. 로컬의 실제 백엔드와 별도 테스트 계정으로 닉네임 흐름을 확인했으며, 운영 실계정의 닉네임 저장과 새 Google 계정의 전체 가입 흐름은 시험하지 않았다.

사용자 후속 요청으로 설정한 닉네임을 내 계정에서 직접 변경할 수 있도록 한다. 이번 직접 변경 코드의 검증·운영 배포는 대기이며, 위의 `b702266` 배포 이력과 구분한다. 기존 D1 스키마를 그대로 사용하고 추가 마이그레이션은 없다.

인증 경로는 `/api/auth/*`로 한정한다. `realtimeEnabled = false`와 기존 커뮤니티 회원·댓글·투표 API, SSE, 시세 수집·폴링, AI 워커의 중지를 유지한다. Google 회원 데이터는 기존 커뮤니티 SQLite DB와 분리한다. 필수 설정이 누락되면 `/api/auth/config`는 `enabled: false`를 반환하며 미설정 상태의 인증 요청은 성공으로 처리하지 않는다.

## Google 설정

[Google Cloud Console](https://console.cloud.google.com/auth/clients)의 운영 프로젝트 `ai-value-chain`에서 OAuth 클라이언트를 **웹 애플리케이션**으로 만든다. 앱 이름·지원 이메일·동의 화면을 실제 서비스에 맞게 설정한다. 사용자가 지정한 지원 이메일과 개발자 연락처는 `khcho9642@gmail.com`이다. 사용자 승인 후 이 계정에 OAuth 구성 편집자 역할만 추가해 지원 이메일을 선택했으며, Google 사용자 데이터 정책 동의와 앱 등록을 완료했다. 개요·클라이언트 목록에 필요한 추가 조회 권한은 확대하지 않고 기존 소유자 계정으로 웹 클라이언트 `AI Value Chain Web`을 발급했다.

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

Google 로그인 연결과 닉네임 최초 설정의 운영 배포를 완료했다. 후속 요청인 닉네임 직접 변경의 검증·배포는 별도 진행 중이다. 배포·자동 검사·실제 계정 검증을 구분해 기록한다.

1. 완료: Cloudflare 무료 한도 화면을 확인하고 회원 전용 D1 `ai-chain-members`를 생성했다. 유료 전환이나 추가 유료 서비스는 신청하지 않았다.
2. 완료: `deploy/auth/0001-members.sql`의 테이블 4개·명시 인덱스 4개를 회원 DB에 적용하고 운영 `MEMBER_DB` 바인딩을 연결했다. 이번 `deploy/auth/0002-member-nicknames.sql`의 `ALTER TABLE member_users ADD COLUMN nickname TEXT;`도 Cloudflare Console에서 성공을 확인했다. 기존 행·컬럼을 보존하고 기존 회원의 닉네임은 `null`로 둔다.
3. 완료: 발급한 Google 웹 클라이언트 ID와 `AUTH_ORIGIN`을 `wrangler.jsonc`의 `env.production`에 설정해 운영 연결을 확인했다. `AUTH_ALLOW_LOCAL_HTTP`는 운영에 설정하지 않는다. 미리보기 환경은 별도의 원본·DB를 준비하기 전까지 비활성으로 둔다.
4. 완료: 기존 Google 로그인 코드 `266322f`를 [고정 배포](https://6d7ec560.ai-chain-prototype.pages.dev/)와 운영 주소에 배포했다. 각각 정적 파일 119개의 SHA-256이 로컬 `dist`와 일치했다. 닉네임 변경 `48a9e07`의 [2ec91d54 배포](https://2ec91d54.ai-chain-prototype.pages.dev/)도 고정·운영 주소 각각 119개 파일, 총 238개의 SHA-256이 일치했다. 개인정보 안내를 보완한 최종 `b702266`의 [81b45430 배포](https://81b45430.ai-chain-prototype.pages.dev/)와 운영 주소에서는 `index.html`, `privacy.html`, `member-auth.js`, `member-auth-core.js`, `member-auth.css` 각각 5개씩 총 10개 파일이 HTTP 200이고 SHA-256이 일치했다. 운영 API의 정상 응답·권한·원본 검사와 기존 API 차단을 확인했으며 실시간 중지 설정과 저장 자료의 기준시각을 유지했다. 저장소 루트의 `functions/api/auth/[[path]].js`와 참조 서버 모듈을 함께 번들하며 정적 파일만 업로드하지 않는다.
5. 관찰 완료: 기존 운영본에서 실제 Google 계정의 로그인 상태·새로고침 후 유지·로그아웃. 닉네임 흐름은 로컬의 실제 백엔드와 별도 테스트 계정으로 입력 거절·저장·새로고침 유지·로그아웃을 확인했다. 미완료: 외부 프로덕션 전환 후 추가 재로그인, 운영 실계정의 닉네임 저장 및 새 Google 계정의 전체 가입 흐름. 사용자가 선택할 운영 닉네임을 임의로 설정하지 않았다.

Pages Functions는 `/api/auth/*`만 실행하도록 제한한다. 기존 데이터·지도·차트는 저장 스냅샷을 계속 제공한다. Pages 파일 라우팅과 D1 바인딩은 [Functions 라우팅](https://developers.cloudflare.com/pages/functions/routing/)과 [D1 API](https://developers.cloudflare.com/d1/worker-api/d1-database/)를 따른다.

## 닉네임 설정·직접 변경 — 새 변경 검증·운영 배포 대기

Google 인증으로 회원을 식별한 뒤 닉네임이 없으면 입력을 안내한다. 기존 회원의 새 `nickname` 값도 `null`에서 시작하며 Google 이름으로 자동 채우지 않는다. 설정을 마친 회원은 내 계정 → 닉네임 변경에서 현재 닉네임이 채워진 입력란을 열어 새 값을 저장하거나 취소할 수 있다. 취소하면 기존 값은 유지하며 Google로 재로그인해도 닉네임을 덮어쓰지 않는다. 닉네임 중복을 허용하고 식별·권한 판단은 사이트 회원 ID와 Google `sub`로 처리한다.

- 서버에서 NFC 정규화 후 Unicode 코드포인트 수로 2~20자를 확인한다. 첫 글자는 Unicode 글자·숫자·밑줄이어야 하며 이후 글자에는 결합문자도 허용한다. 공백을 자동으로 잘라내지 않고 공백·이모지·제어문자를 거절한다.
- `POST /api/auth/profile`은 현재 유효한 세션과 계정 상태·요청 원본을 확인한 뒤 본인의 닉네임을 설정하거나 변경한다. 기존 1회 설정 제한과 다른 값에 대한 `409 nickname_already_set` 거절은 제거한다. 같은 닉네임 재시도도 성공으로 처리하며 제한 횟수에는 포함한다. 인증과 닉네임 입력 검증을 통과한 profile 요청은 접속 IP 기준으로 10분 동안 20회까지 허용하고 이후 `429 rate_limited`로 거절한다. 기존 요청 제한 테이블의 해시 키·횟수·만료 시각을 사용하며 원문 IP는 저장하지 않는다.
- `deploy/auth/0002-member-nicknames.sql`로 기존 D1 테이블을 갱신했다. 로컬 `.local/members.sqlite`도 기존 회원을 보존하는 업그레이드를 적용하며 원래 커뮤니티 DB는 건드리지 않는다. 이번 닉네임 직접 변경에는 기존 `nickname` 칼럼을 그대로 사용하며 추가 스키마 변경은 없다.
- 신규 Google 회원의 기존 `name` 칼럼에는 일반값 `회원`을 저장한다. Google 이름을 새로 저장·갱신하지 않으며, 이미 저장된 이름 값은 보존하되 브라우저에 반환하지 않는다.

## 인증 계약과 데이터

| 요청 | 결과 |
| --- | --- |
| `GET /api/auth/config` | `enabled`, 공개 `clientId`; 설정 누락이면 `enabled: false` |
| `GET /api/auth/nonce` | 10분 nonce와 해당 브라우저에 묶인 HttpOnly 쿠키 |
| `POST /api/auth/google` | JSON `{credential}` 검증 후 `{user:{id,nickname,needsNickname}}`와 7일 세션 쿠키 |
| `GET /api/auth/me` | `{user:{id,nickname,needsNickname}}` 또는 `user: null` |
| `POST /api/auth/profile` | JSON `{nickname}`으로 본인의 닉네임을 설정·변경 후 `{user:{id,nickname,needsNickname:false}}` |
| `POST /api/auth/logout` | JSON `{}`로 서버 세션 삭제·쿠키 만료 |

Google 서명·발급자·client ID·만료·nonce를 서버에서 검증한다. 회원 연결키는 Google `sub`이며 이메일로 기존 계정을 자동 연결하지 않는다. Google `sub`와 확인된 이메일은 내부 회원 정보로 보관한다. 사용자 입력은 닉네임 하나이며 회원 API의 사용자 객체에는 `id`, `nickname`, `needsNickname`만 반환한다. Google 실명·이메일은 사이트의 회원 표시·내 계정·회원 API 응답에 포함하지 않는다. Google이 제공하는 로그인 버튼·계정 선택 화면의 이름·이메일 표시는 이 범위와 구분한다. 새 Google 이름 저장·갱신은 중단하지만 이전 이름 기록은 보존한다. 회원 ID·계정 상태·생성·로그인 시각도 저장한다. 비밀번호는 받지 않는다. Google ID token 원문을 저장하지 않고 세션·nonce는 해시로 저장한다. 운영 세션 쿠키는 HttpOnly·Secure 속성을 사용하며 인증 응답은 캐시하지 않는다. [Google ID token 검증 기준](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)

검증은 정상·재로그인, 위조/만료/다른 audience 토큰, nonce 불일치·재사용, 다른 Origin, 세션 만료·로그아웃, 미설정/DB 오류, 기존 실시간 API 차단을 포함한다. 닉네임 직접 변경은 기존 DB·회원 보존, 신규·기존 회원의 미설정 상태, Unicode 경계값, 중복 허용, 본인만 수정 가능, 동일값 재시도, 반복·동시 변경, 요청 제한, 현재값 채움·취소·새로고침 유지, 실명·이메일 비노출을 검증한다. 이번 변경의 검사 결과는 완료 후 별도로 기록한다. 운영 실계정의 닉네임 저장과 새 Google 계정의 전체 가입 흐름은 미검증으로 남기며, 자동 검사·로컬 브라우저 검증 결과와 구분한다.

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

- 기존 닉네임 최초 설정 배포: `npm test` 전체 772개 통과. 이후 NFC 정규화 전 HTML `maxlength` 제한을 제거한 작은 수정은 관련 15개 검사로 재검증했다. Google 서명 토큰·세션·nonce, 닉네임 경계값·1회 설정·동시성, 브라우저 API 클라이언트, 로컬 HTTP 어댑터, 기존 실시간 API 차단 회귀 검사를 포함한다. 기존 Google 로그인 배포 당시 전체 검사는 759개였다.
- 기존 배포의 최종 `npm run build` 및 `wrangler pages functions build`: 정적 빌드와 Cloudflare Worker 컴파일 통과.
- 운영 API: config `200 enabled:true`, 존재하지 않는 형식상 유효한 세션 쿠키로 me `200 user:null`(닉네임 컬럼 조회 포함), 익명 profile POST `401 login_required`, 다른 Origin의 POST `403 invalid_origin`, profile GET `405`를 확인했다. 기존 커뮤니티 me·시세 API는 `404`이고 확인한 응답은 모두 `no-store`였다. 운영 브라우저에서 Google 로그인 버튼과 첫 로그인 후 닉네임 설정 안내를 확인했다.
- 초기 개발 검증: Chrome 데스크톱 및 390px 모바일에서 헤더 로그인 버튼·모달·닫기·초점 복원·설정 대기 표시를 확인했다. 이후 기존 운영본에서 실제 Google 계정의 로그인 상태·새로고침 후 유지·로그아웃을 관찰했다. 기존 닉네임 최초 설정 배포 때 로컬의 실제 백엔드와 별도 테스트 계정을 사용해 닉네임 `a` 거절 → `밸류탐험가` 저장 → 새로고침 후 유지 → 로그아웃을 브라우저에서 확인했다. 운영 실계정의 닉네임 저장은 시험하지 않았으며 새 Google 계정의 전체 가입 흐름도 시도하지 않았다.
- Google 프로젝트 생성은 처음 자동 승인 검토에서 차단되었고, 이후 사용자가 새 프로젝트 생성·로그인 연결을 승인하여 `ai-value-chain`을 생성했다. 생성 시 기존 결제 계정이 자동 연결된 것을 확인해 이 프로젝트의 결제를 비활성화했다. Console의 비활성화 완료 알림과 연결 프로젝트 목록에서 제외된 상태로 확인했으며 기존 결제 계정 자체는 변경하지 않았다. 유료 전환은 실행하지 않았다.


## 연결 진행 — 2026-11-09

사용자가 결제 계정을 연결하지 않고 새 Google 프로젝트를 만든 뒤 구글 로그인을 연결하도록 승인했다. Google 프로젝트 `ai-value-chain` 생성 때 기존 결제 계정이 자동 연결되었으나, 이후 이 프로젝트의 결제를 비활성화한 상태를 확인했다. Cloudflare 무료 한도 화면(10 DB, 일 읽기 500만·쓰기 10만, 총 5GB)을 확인한 뒤 전용 D1 `ai-chain-members`를 생성하고 `0001-members.sql`의 테이블 4개·명시 인덱스 4개를 적용했다. DB 식별자는 `e979860b-4763-4b90-84a7-8c4e856ccabe`다. 이 정보는 인증 비밀이 아니다.

사용자가 지정한 지원 이메일 `khcho9642@gmail.com`으로 앱 등록과 웹 Client ID 발급을 완료했다. 기존 Google 로그인 운영 배포와 실제 계정의 로그인 상태·새로고침 후 유지·로그아웃 관찰을 마쳤다. 기존 Wrangler OAuth는 pages:write만 포함하고 d1:write는 없어 DB 생성·스키마 적용은 사용자의 로그인된 Cloudflare 대시보드에서 실행했다. 운영 D1 바인딩과 공개 Client ID·원본 설정은 wrangler env.production에 적용했고 preview에는 DB를 연결하지 않았다.

사용자는 관리자 페이지를 만들지 않기로 했다. 현재 저장하는 가입일·Google 재로그인 시각·계정 상태로 회원 수와 최근 로그인 현황을 조회할 수 있다. last_login은 방문/활동 시각이 아니다. 이번 변경부터 사이트에서는 직접 정한 닉네임으로 표시하며, 내부 Google 이메일과 이전 이름 기록은 사이트의 회원 표시·내 계정·회원 API 응답에 반환하지 않는다. 이용 정지 시 세션도 함께 폐기한다. 전용 관리 CLI·탈퇴·문의 UI는 아직 만들지 않았고, 사용자와 범위를 정한 후 구현한다.


## 공개 상태와 남은 검증

OAuth 지원 이메일·앱 등록·웹 클라이언트 발급을 마쳤다. 공개 Client ID는 `wrangler.jsonc`의 production 설정에서 관리하며 클라이언트 비밀키는 저장하거나 사용하지 않는다. `privacy.html`에서 실제 로그인 데이터 처리와 삭제 문의 주소를 안내하고 로그인 모달·사이트 하단에서 연결한다.

Google 앱은 외부 사용자용 프로덕션으로 전환했다. 공개 전환 후 추가 재로그인 시험은 컴퓨터 사용 도구 중단으로 미완료이며, 기존 닉네임 최초 설정은 운영 DB 마이그레이션·코드 배포와 로컬 테스트 계정의 가입 흐름 검증을 마쳤다. 후속 요청인 내 계정의 닉네임 직접 변경은 추가 마이그레이션 없이 구현하며 새 코드의 검증·운영 배포가 남아 있다. 운영 실계정의 닉네임은 사용자 선택을 임의로 대입하지 않아 저장 시험을 하지 않았고 새 Google 계정의 전체 가입 흐름도 시도하지 않았다. Google 앱 공개 전환과 브랜드 검증 승인은 구분한다. Google의 인증 전용 운영 안내는 운영 앱의 브랜드 검증 제출, 홈페이지·개인정보 안내 및 도메인 소유 확인을 설명한다. 공유 호스팅에서 자체 도메인 사용은 권장 사항이며 `pages.dev` 하위 도메인의 검증 승인은 아직 확인하지 않았다. 브랜드 검증과 별도 서비스 약관은 미완료다. [Google 인증 전용 운영 안내](https://developers.google.com/identity/verification/authentication-policy-compliance)
