# P2-B.3 — OMP Live 관찰 채널

## 범위

기존 Live 화면에 `관찰 채널: Claude Code / OMP` 선택을 추가했다. OMP의 실제 수신 자료를 기존 Pixel Agents Renderer와 LiveAnimationScheduler(750ms)에 연결한다. 두 채널은 별도 scene과 installation UUID별 좌석 저장소를 사용한다. 같은 숫자 renderId도 채널 전환 시 캐릭터·필터·선택·애니메이션을 재사용하지 않는다. 선택 채널은 로컬 설정으로 유지한다.

현재 producer에는 실제 Claude relay↔OMP executor delegation 연결 정보가 없다. 따라서 두 채널을 동시에 합치거나 업무를 중복 제거했다고 주장하지 않는다. 모델 이름이나 prompt를 이용해 합치지 않는다. OMP fresh print는 매 실행 별도 신원이며 OMP Resume는 범위 밖이다.

## 서버 경계

`GET /api/omp/snapshot`은 기존 Office HttpOnly/SameSite cookie와 loopback/Origin 검사로 보호한다. `platform/omp-office-reader.mjs`는 private OMP registry의 PID·port·installation UUID를 검증하고 loopback Bridge의 별도 session cookie로 snapshot을 읽는다. 읽기만 수행하고 Bridge state/registry/Hook/위임 정의를 변경하지 않는다. Bridge가 없으면 생성하거나 시작하지 않는다. HTTP 요청당1.2초, 응답256KiB, registry4KiB로 제한한다. 조회 전후 registry가 같아야 한다. 브라우저에 Bridge token/cookie/원본 응답을 보내지 않는다.

`server/bridge/office-projection.mjs`는 안전한 필드만 새 객체로 만든다. 이름은 OMP 숫자 별칭, 도구는 enum, 모델은 기존 native 메타데이터의 family/provider enum만 표시한다. actor와 timeline의 source/provider/역할/UUID/종류/정합성을 검사한다. relay/observer timeline은 제외한다. gap/inconsistent quality는 unknown/stale로 표시해 실행 중으로 추측하지 않는다. 원문 prompt·인자·결과·파일 경로·native ID·credential은 UI 응답에 없다. 관찰 환경은 같은 호스트 Bridge를 조회하는 서버 환경이다.

기존 `/api/live/snapshot`, `/api/live/events`, Claude Hook intake, generation, tombstone 계약은 유지한다. OMP snapshot에는 명시적 providerId를 추가해 빈 snapshot도 채널을 확인한다. mixed provider/source, 잘못된 모델/이름/도구는 거부한다. 기존 Claude delta에 OMP upsert를 적용하지 않는다.

## Polling과 애니메이션

OMP는1초 간격으로 bounded snapshot/timeline을 조회한다. 같은 Polling 사이의 tool.start/end도 timeline에서 관찰해750ms 동안 시각 동작을 재생한다. 실제 상태와 실행 중 수치는 tool.end 즉시 종료 상태다. 종료된 actor의 과거 동작은 재생하지 않는다. 최초 로드·채널 전환·Mock에서 복귀·재연결은 baseline만 취해 과거 연출을 반복하지 않는다. 이전 revision snapshot은 덮어쓰지 않는다.

처음 Bridge가 없으면 연결 준비 상태다. 한 번 관찰한 뒤 Bridge 중단/HTTP 실패/registry 제거는 마지막 snapshot을 offline으로 유지하고 엔진 동작을 멈춘다. 연결 실패를 SessionEnd로 처리하지 않는다. Bridge 재시작 후 같은 installation/actor 신원·좌석을 유지한다. 실제 execution.end만 actor를 제거한다. failure/approval/waiting/unknown은 시각 동작보다 우선한다.

## 검사

단위: projection allowlist/enum/source/relay, mixed provider 거부, 같은 Polling의 짧은 Read, 실제 종료와 stale snapshot, sequence gap 동작 중지, reconnect baseline, 실패 우선순위.

HTTP 통합: cookie/Origin, absent Bridge 무생성, fixture/live 분리, read-only ledger, Claude endpoint 분리, private/native/token 부재, terminal 제거.

`npm run test:omp-office-browser`: 합성 fixture/source 표시, Read100ms 후 실행 중0과 기존 엔진 Read 재생, 채널별 동번호 캐릭터·좌석, 새로고침, offline actor 보존, 과거 연출 미재생, Bridge 재시작, 모바일, terminal 제거, DOM/storage 민감정보 부재. 기존 브라우저 검사와 함께 세 OS CI에 추가한다. 합성 검사는 실제 OMP 검증과 구분한다.

## 남은 범위

producer durable spool/retry, 실제 relay/executor delegation 결합, 여러 provider 동시 scene, OMP Resume, Windows/Linux 실제 OMP 모델 실행은 미구현/미검증이다. 전송 전 이벤트 유실 가능성이 있으며 종료를 추측해 actor를 제거하지 않는다. OMP snapshot timeline은128개 중 최근100개만 UI에 전달하므로 Polling 사이100개 초과 이벤트는 전부 연출할 수 없다. 애니메이션은 업무 이력 보관소가 아니다.
