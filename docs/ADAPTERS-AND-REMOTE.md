# 수집 Adapter와 원격 모니터링 경계

## 현재 구현과 미구현

현재 구현: 단일 Claude provider 전용 worker, 로컬 인증 intake, 민감 필드 제거 sender, 별도 read-only UI snapshot. 기존 `claudeProvider.normalizeHookEvent`를 변경 없이 호출한다. installer/team filesystem/Runtime scanners는 호출하지 않는다. 이벤트는 메모리에서 최대 100세션, IPC 대기는 최대 64개·2초 제한이다. sender는 1.5초 timeout이며 실패 시 Claude를 막지 않는다.

현재 source는 서버가 결정한다. 기본 UI 캔버스는 Mock, opt-in receiver는 live transport, 통합 테스트는 fixture다. caller의 source 문자열로 이를 바꿀 수 없다. transport가 live라고 실제 Claude 실행을 암호학적으로 증명하는 것은 아니며 `realEnvironmentVerified=false` (이전 필드 realMacVerified도 false)를 유지한다. live session은 캔버스 Mock roster와 섞지 않고 별도 수집 패널에 표시한다.

Hook raw 입력은 session id, 허용 이벤트, 제한된 tool 이름과 enum만 전달한다. prompt, cwd, transcript path, tool input/output, 임의 agent 이름은 sender에서 버리고 receiver에서 다시 제거한다. UI의 session key는 provider/session tuple의 hash다. 설치 인스턴스별 durable namespace, sequence replay/dedup, 영구 ledger, 정확한 자식별 correlation, transcript fallback은 아직 없다. 여러 머신의 동일 id를 현재 단일 collector에 합치는 구성은 지원하지 않는다.

## 수집 인터페이스

| 경계 | 현재 계약 |
|---|---|
| sender → intake | 로컬 HTTP POST `/api/hooks/claude`, Authorization Bearer. receiver registry 파일을 POSIX 0600 / Windows private ACL으로 읽는다. 원격 URL·포트 host를 payload로 받지 않는다. |
| intake → worker | 필터링된 raw, requestId. Provider는 프로세스 하나에 Claude 하나. unknown provider는 404, 잘못된 인증은 401, body는 최대 64KiB. |
| worker → projection | sessionId와 canonical kind/awaitingInput만 반환. 도구 실패는 명시된 PostToolUseFailure로만 추가 표시. raw payload를 저장·로그하지 않는다. |
| server → UI | 동일 origin의 HttpOnly SameSite=Strict 세션 cookie, `/api/connection`과 `/api/events` 2.5초 polling. 허용된 loopback Host만 수락하고 다른 Origin 거부. |

`server/receiver.mjs`는 Hook 수신 경계 준비를 위한 제한된 projection이며 P1-B의 완성된 multi-provider Bridge가 아니다. 같은 머신의 사용자 권한 프로세스를 위협 경계 밖으로 가정한다. 로컬 악성 프로세스에 대한 완전한 방어 또는 원격 사용자 인증 체계로 해석하지 않는다.

## 향후 구현 순서

1. Provider별 인증 principal/registry를 먼저 만든다. token과 providerId를 바인딩하고 unknown provider를 기본 Claude로 fallback하지 않는다. 현재 서버는 다른 Provider를 의도적으로 거부한다.
2. `(providerId, installationInstanceId, nativeSessionId)`와 logicalTaskId/executionId/delegationId/parentTaskId를 도입한다. 전송 connectionId를 세션 신원으로 쓰지 않는다. 현재 hash key를 여러 머신 공유용으로 확장해야 한다.
3. Claude를 포함해 Provider별 worker process를 고정한다. 기존 Runtime을 재사용해야 하는 경우 worker마다 하나만 생성하고 watcher/parser의 module-level 의존성 혼합을 막는다. 직접 Runtime 확장은 별도의 전역 상태 제거 작업으로 한다.
4. durable ledger, eventId dedup, execution sequence, bounded reorder, snapshot/replay·만료·unknown freshness·종료 tombstone을 구현·fault injection으로 검증한다.
5. Haiku relay와 DeepSeek executor를 delegationId로 결합하고 relay를 기본 캐릭터에서 제외한다. 이름/프롬프트 유사도로 중복 제거하지 않는다.
6. 권한·민감정보 계약을 통과한 fake Adapter 두 개로 충돌·병렬 자식·재연결을 먼저 검증한다. 이후 각 외부 Provider의 실제 API/스크립트 변경은 별도 승인한다.
7. 마지막으로 read-only live projection을 기존 Canvas와 연결한다. 현재 Mock 캐릭터를 실제 실행으로 이름만 바꾸지 않는다. CLI별 coding/analysis/testing 의미는 명시 이벤트가 있을 때만 추가한다.

DeepSeek(Command Code), OpenCode(별도 향후 대상), Hermes Adapter 구현이나 위임 스크립트 변경은 이번에 하지 않았다. 비교와 자세한 계약은 P1-B 문서에 있고, 위 목록은 P2 이후 실제 구현 순서다.

## Cloud / Local / Remote

클라우드는 코드·에셋·Mock·합성 통합 테스트를 담당한다. 실제 Claude 이벤트는 해당 Claude가 실행되는 각 OS에서 수집한다. 클라우드의 localhost, Mac의 localhost, 원격 실행 머신의 localhost는 서로 다른 주소 공간이다. 클라우드에서 Mac loopback에 직접 접근하는 경로나 공개 터널을 만들지 않았다.

기본 로컬 앱은 127.0.0.1에만 바인딩한다. 외부 host 옵션을 제공하지 않고, DNS rebinding을 막기 위해 Host도 localhost/127.0.0.1만 받는다. 인터넷 공개 포트·ngrok·Tailscale Funnel은 적용하지 않는다.

후속 모바일 접근은 **Tailscale Serve의 tailnet 내부 HTTPS + 사용자/기기 인증 + 최소 ACL**을 우선 검토한다. Tailscale 설치·로그인·Serve 설정·ACL 변경은 이번에 실행하지 않았다. 현재 Host/Origin/cookie 정책은 tailnet hostname/HTTPS proxy를 자동 허용하지 않으므로 **지금 Serve만 켜면 동작하는 상태가 아니다**.

별도 승인 단계에서 trusted hostname을 정확히 지정하고 HTTPS origin·Secure cookie·proxy 신뢰 경계를 검증해야 한다. Serve는 로컬 읽기 전용 UI 경로만 내보내고 Hook intake와 token registry에는 접근시키지 않는다. 다른 tailnet 사용자, 로그아웃 기기, 무인증 요청이 차단되는지 확인해야 한다. 인터넷 공개/Funnel은 사용하지 않는다. 수집 권한과 UI 관찰 권한도 계속 분리한다.

현재 DeepSeek 실행 도구는 Command Code다. [공식 문서 접근 결과와 launcher 경계](COMMAND-CODE.md)를 우선한다. 모든 OS의 실행 인스턴스를 분리하고 WSL을 Windows home과 합치지 않는다.
