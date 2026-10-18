# P2-B.1 — Provider Bridge 기반

> **현재 운영 상태(2026-10-18):** 이 문서는 B.1 작성 당시의 범위입니다. 이후 OMP 경유 DeepSeek 실제 위임·Live 채널·내구 송신기 운영 적용까지 완료했습니다. 독립 Command Code CLI를 새로 설치할 필요는 없습니다. 최신 상태·승인 경계·검증 근거는 [P2-B.4 Mac 인수인계서](HANDOFF-P2-B4-MAC.md)를 먼저 확인하세요.

상태: 코드와 합성 검증. 실제 Command Code/DeepSeek 연결은 미검증이다. P2-A.4 운영 경로를 교체하지 않는다.

## 범위와 분리

공식 계약 확인 → Provider 인증/신원 → durable event 처리 → relay/executor 상관관계를 먼저 구현했다. 외부 CLI·Hook을 설치하거나 실제 DeepSeek 작업을 실행한 단계가 아니다. 현재 Mac에는 Command Code 실행 파일과 설정을 찾지 못했으므로 실제 사용자 환경 정보를 기다린다.

새 코드는 `server/bridge/`에 있고 기존 Claude worker·sender·수집기·Canvas 엔진을 import하거나 변경하지 않는다. `npm run bridge:start`는 **명시적 opt-in** 전용 API 수집기이며 기본 포트4183이다. 기존 4173 Live Office와 별도이고 기존 Claude registry를 공유하지 않는다. 이번 작업에서는 실제 사용자 stateDir로 이 명령을 실행하지 않았다. 테스트는 임시 stateDir/source=fixture/포트0만 사용했다.

## 인증·자료 계약

`POST /api/bridge/:providerId`는 Provider별 다른 Bearer token과 고정 installation UUID를 사용한다. 다른 Provider의 token 또는 body 신원은403, 모르는 경로는404, 잘못된 인증은401이다. 새 기본 등록 Provider는 command-code 하나다. 두 Provider 검사는 source=fixture에서 claude/command-code를 명시적으로 등록한 합성 검사다.

입력은 schemaVersion/providerId/installationInstanceId/nativeSessionId/executionId/logicalTaskId/actorRole/eventId/sequence/occurredAt/kind와 필요한 typed 필드만 허용한다. tool 이벤트는 nativeToolCallId와 read/write/edit/shell/other 분류가 필요하다. 세션/실행/도구 식별자는 private HMAC으로 변환하고, raw Hook·prompt·인자·결과·경로는 저장하지 않는다. 공개 snapshot은 안전한 actor UUID/숫자 ID와 제한된 상태·종류만 내보낸다.

`GET /api/bridge/snapshot`은 별도 HttpOnly/SameSite cookie가 있어야 한다. loopback Host와 같은 Origin만 허용하며 body64KiB/응답 no-store/로그 비활성화를 적용한다. registry는 새 전용 runtime 하위 Provider별 파일이며 기존 파일을 덮어쓰지 않는다. 정상 종료 시 자신과 token이 같은 파일만 제거한다.

새 Bridge는 **승인된 producer가 제공한 실행 UUID/역할을 신뢰하는 계약**이다. 아직 native Command Code 프로세스 확인이나 실제 producer 등록을 구현하지 않았으며, 합성 source나 live transport만으로 실제 DeepSeek 실행을 증명하지 않는다.

## 순서·중복·영속화

Provider+installation+eventId별 내용 digest로 중복을 판별한다. 동일 이벤트는 원래 receipt에 duplicate=true를 반환한다. 같은 ID의 다른 내용, 같은 실행 sequence 재사용은409다.

실행별 sequence1부터 연속 구간만 반영한다. start 전에 도구가 와도 actor를 만들지 않고 bounded pending에 보존한다. 빠진 번호가 오면 원자적으로 이어서 반영한다. receipt의 buffered는 저장된 수신이라는 뜻이며 실제 상태 반영/작업 성공 ack가 아니다. producer는 missing nextSequence를 재전송해야 한다. producer-side spool/retry는 다음 단계다.

기본 상한은 실행1000/활성 캐릭터100, 배달4096, 전체 pending256/실행당32, 열린 도구64/닫힌 도구1024, generation64, timeline128, 파일2MiB다. gap은5초 후 gap-expired로 표시하되 임의 성공·실패나 상태를 만들지 않는다. 오래된 버퍼를 무조건 버리거나 기록을 지워 정원을 우회하지 않는다. 실제 상태와 quality를 분리한다.

실제 parallel 도구의 HMAC 호출 ID별 active set을 관리한다. 한 도구가 끝나도 다른 도구가 남으면 working이다. 닫힌 호출 ID 재사용과 알 수 없는 tool end는 거부한다. Stop은 turn-ended이며 execution.end만 wrapper가 실제 프로세스 종료를 관찰했을 때 사용하는 Orbit 내부 이벤트다. 종료0은 process outcome일 뿐 업무 완료로 집계하지 않는다.

private 파일은 owner/mode 또는 Windows ACL을 검사하고 새 private temp 생성→fsync→rename→POSIX directory fsync 후에 receipt를 반환한다. 손상 자료는 자동 초기화하지 않는다. event receipt·buffer·terminal·매핑은 재시작 후 유지된다. 이는 내구 receipt+projection 저장소이며 모든 원본 이벤트를 영구 보관하는 replay journal은 아니다. timeline은128개로 제한되므로 전체 과거 업무를 재구성할 수 있다고 주장하지 않는다.

## 신원·위임·Resume

논리 신원은 provider/installation/nativeSession, 실행 신원에는 execution UUID를 추가한다. 종료된 실행은 새 late event로 부활하지 않는다. 새 execution의 명시적 resume만 기존 actorId/renderId/palette를 유지하며 generation을 늘린다. 동시에 같은 logical session을 점유하거나 startup을 resume로 추측하는 경우는 거부한다. 이는 실제 producer가 실행 UUID를 고정한다는 계약이며 기존 Claude P2-A.4의 OS 프로세스 증명을 대체하지 않는다.

relay/observer는 감사 기록만 남기고 캐릭터를 만들지 않는다. delegation UUID·logicalTask UUID·허용된 relay/executor Provider를 **서버에 사전 등록**해야 결합한다. 이름/프롬프트 유사도는 사용하지 않는다. 부모는 먼저 관찰되고 같은 principal 소유여야 한다. 자기 참조·cycle·타 principal 참조는 거부한다. 부모보다 자식이 먼저 오면409로 재전송을 요구하며 자동 pending-parent join은 다음 단계다.

## 검증과 남은 작업

신규 통합 검사는 같은 native/execution/event ID의 Provider 충돌, 재시작, 중복/conflict, reorder/gap/overflow, terminal 후 지연, resume/overlap, relay 중복 억제, 부모 소유/cycle, parallel 도구, 공식 Hook mapping, 개인정보 제거, HTTP 인증/Origin/body/cookie, registry 소유권을 확인한다. 기존 단위·통합·엔진·브라우저 검사와 세 OS CI를 유지한다.

아직 하지 않은 것: 실제 CLI 설치/로그인, DeepSeek 모델 실행 확인, sender/supervisor와 producer spool, Hook/위임 스크립트 변경, 기존 Live Canvas와 병합, 실제 Windows/macOS/Linux Command Code 세션 검증. 실제 사용 위치가 확인되면 P2-B.2에서 실행 경계와 변경 Diff를 구체화한다.

공식 외부 근거와 로컬 탐지는 [Command Code 조사](COMMAND-CODE.md)를 따른다.
