# Oracle 댓글 서버 시작 안내

확인일: 2026-10-26 KST. 현재는 계정·VM·API 도메인이 없는 **배포 준비 단계**다. 이 문서는 서버 생성·유료 전환·DNS/방화벽 변경을 실행하지 않는다.

## 지금 할 일: 계정 가입

1. [Oracle 공식 무료 계정 안내](https://www.oracle.com/cloud/free/)에서 **Start for free**를 연다. 기존 Cloud 계정이 있으면 새로 만들지 않고 로그인한다.
2. 이메일·본인 정보·카드 확인과 약관 동의는 계정 소유자가 직접 완료한다. 비밀번호·카드·비밀키를 GitHub나 채팅에 적지 않는다. Oracle은 카드 정보를 계정 설정과 본인 확인에 사용한다고 안내한다.
3. 가입이 끝나면 **가입 완료 여부와 선택한 홈 리전 이름**만 알려준다. 아직 VM이나 유료 서비스를 만들 필요는 없다. 홈 리전은 나중에 바꾸는 전제로 선택하지 않는다.

Oracle 안내의 무료 체험 크레딧과 Always Free는 다르다. 체험 크레딧으로만 무료인 구성은 상시 무료 서버로 간주하지 않는다. 정확한 한도·가능한 리소스는 가입 계정의 콘솔과 [Always Free 공식 문서](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)를 확인한다. 무료 VM도 용량 부족으로 생성이 안 되거나 유휴 상태에서 회수될 수 있으므로 별도 백업이 필요하다.

## 계정 생성 후 확정할 서버 계획

| 항목 | 계획 |
|---|---|
| 운영 형태 | Oracle Cloud의 Linux VM 한 대에 댓글 API 프로세스 한 개. OS 이미지는 Ubuntu 계열을 우선 검토 |
| 무료 범위 | 콘솔에서 Always Free 적격 여부·계정 전체 할당량·예상 비용을 확인한 구성만 선택 |
| 서버 프로그램 | `/usr/bin/node`의 Node.js 24, HTTPS 프록시 Caddy, systemd |
| 프로그램 경로 | `/srv/ai-chain` |
| DB | `/var/lib/ai-chain/community.sqlite`, 영속 로컬 디스크, 단일 복제본 |
| 실행 사용자 | 전용 `ai-chain` 사용자. 관리자 생성·백업도 같은 사용자로 실행 |
| 공개 API | 소유한 도메인의 HTTPS 주소를 정한 후 연결. `.example`은 설명용이며 실제 주소가 아님 |
| 웹 화면 | 기존 `https://ai-chain-prototype.vercel.app` 유지 |
| AI 생성 | 로컬 PC의 CLI 워커. 실제 제공사 로그인·버전·격리 검증 후 모델별로 활성화 |

VM 생성 전에 리전·이미지·shape·디스크·예상 비용과 접속 방식을 구체적으로 확인한다. 무료 용량이 없으면 유료 shape나 계정 업그레이드로 자동 변경하지 않는다. SSH 접속 키는 소유자의 PC에 보관하고 접속 정보는 IP·사용자·키 파일 경로로 전달한다. 키 파일 본문은 전달하지 않는다.

API용 도메인과 DNS를 확정한 다음 필요한 HTTPS 접근과 SSH 접속 범위를 검토한다. Node의 5180 포트는 loopback에 두며 기존 Caddy 예제처럼 HTTPS 프록시를 통해 연결한다. 사용자 PC의 포트·공유기·방화벽을 공개하는 구조가 아니다.

## 준비된 코드 사용 순서

1. 저장소의 `npm test`와 `npm run build`가 통과한 커밋을 배포 대상으로 고정한다.
2. `npm run community:package`로 `.local/releases/` 아래 API 전용 패키지를 만든다. 기존 출력은 덮어쓰지 않는다. 파일별 SHA-256 manifest로 배포 파일을 확인한다. 개인 환경 파일·DB·CLI 인증 파일은 패키지에 들어가지 않는다.
3. 실제 서버에 Node 24·전용 사용자·프로그램·영속 디스크를 준비한다. `/usr/bin/node --version`과 서비스 사용자의 디렉터리 권한을 확인한다.
4. 패키지의 `deploy/community.env.example`을 참고해 **서버 안에서** 비공개 환경 파일을 작성한다. 워커 토큰은 서버에서 충분한 난수로 생성한다. 초대 가입·관리자 승인 모드를 유지한다.
5. `deploy/community-api.service.example`과 `deploy/Caddyfile.community.example`의 실제 경로·도메인을 확인한 뒤 설치한다. 원본 예제를 그대로 실행하지 않는다.
6. 운영자 계정은 `community-account.mjs`에 stdin JSON으로 만들고 비밀번호를 명령행 인수에 넣지 않는다. 자세한 실행법은 [공유 API 가이드](ai-community-public.md)의 계정 절을 따른다.
7. 실제 HTTPS API가 실행되면 다음 **읽기 전용** 검사로 웹사이트의 연결을 확인한다.

```sh
node scripts/community-check-public.mjs https://실제-API-도메인 https://ai-chain-prototype.vercel.app
```

검사는 `/api/community/status`와 CORS·회원 인증·초대 가입·관리자 승인 모드를 확인한다. 회원 생성·게시·AI 실행은 하지 않는다. 통과해도 실제 모델 응답 검증이 완료된 것은 아니다.

8. Vercel 빌드에 `COMMUNITY_API_ORIGIN`을 실제 API HTTPS origin으로 설정해 기존 화면을 배포한다. 공개 URL만 넣으며 토큰·비밀번호는 넣지 않는다.
9. 두 브라우저에서 가입·로그인·같은 종목 댓글 공유를 확인한다. 그 다음 실제 모델을 한 개씩 검증하고 워커와 승인 흐름을 연결한다. Gemini CLI는 현재 PC에서 설치가 확인되지 않았다.
10. 온라인 SQLite 백업과 복구를 검증한 뒤 운영을 시작한다. 원본 DB와 백업은 공개 저장소·정적 호스팅에 올리지 않는다.

실제 서버 생성·비용·도메인·설정값과 검증 결과는 확정 후 이 문서에 기록한다. 현재 `docs/ai-community.md`와 PR의 테스트 통과 기록은 운영 서버가 존재한다는 증거가 아니다.

공식 참고: [Oracle VM 생성](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/launchinginstance.htm), [SSH 연결](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/accessinginstance.htm), [Always Free 자원](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).
