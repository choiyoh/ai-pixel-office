# P2-B.4 — OMP 내구 Outbox와 재전송

## 상태와 활성화 경계

새 경로는 `scripts/observe-omp-durable.mjs`다. 기존 `scripts/observe-omp.mjs`와 전역 위임 명령은 유지한다. 기존 observeOmp에 추가한 queued ack 분기는 `transport.durable === true`인 새 경로에서만 사용한다. 기존 Hook·Claude·OMP 설정을 설치/재등록하지 않는다. 구현/검사는 임시 private stateDir에서 수행하며 운영 활성화는 아래 Diff 별도 승인 후 진행한다.

## 저장 계약

관찰 시 canonical enum/UUID/sequence/eventId/occurredAt만 기록한다. session ID는 기존 supervisor에서 실행별 HMAC, 도구 호출 ID는 outbox의 private 설치 키로 HMAC 처리한다. prompt·도구 인자·결과·경로·원본 tool ID·API credential은 queue에 기록하지 않는다. 처음 신원 등록은 유효한 private Bridge registry가 있어야 한다. 등록 후 Bridge가 없어도 cached installation UUID와 HMAC 키로 기록한다. 설치 UUID가 바뀌면 임의 재연결/재귀속하지 않는다.

새 기본 namespace는 `Orbit Works/omp-outbox`다. binding에는 installation UUID와 임의 HMAC 키만 있으며 token/port는 저장하지 않는다. 디렉터리0700/파일0600 또는 기존 Windows private ACL 상속을 사용한다. 새 파일은 같은 private 부모에 완전한 canonical JSON→fsync→atomic hardlink publish→POSIX directory fsync 순서로 공개한다. 기존 event 파일을 덮어쓰지 않는다. 임시 파일의 원문도 canonical metadata뿐이다. 실패한 temp는 정리하고, 이미 publish된 이벤트는 보존한다.

`queued`는 로컬 내구 기록 ack이며 Bridge `committed`와 다르다. observeOmp 결과의 durablyQueued/sent를 분리한다. 디스크 오류·상한·프로토콜 오류는 관찰을 중단하되 native 업무 응답/종료 코드를 바꾸지 않는다. fsync 이전 또는 supervisor 자체의 강제 종료 이전에 관찰하지 못한 이벤트는 보장하지 않으며 SessionEnd를 추측하지 않는다.

## 순서·ACK·동시 복구

실행별 eventId/sequence/발생 시각을 한 번 생성하고 그대로 재전송한다. 실행당 sequence1/session.start부터 시작하며 fresh startup만 허용한다. 별도 Node worker가 같은 호스트 registry를 매 시도 읽어 새 port/token을 사용한다. OMP 자식에게 intake credential 또는 outbox 경로를 넘기지 않는다.

worker는 immutable event 파일을 실행별 순서대로 최대64개씩 `/api/bridge/omp/batch`로 전송한다. 각 이벤트의 committed receipt와 eventId/nextSequence/revision을 확인한 뒤에만 해당 파일을 지운다. buffered/비정상 ack/전송 오류는 파일을 보존한다. 응답 유실 시 원래 bytes를 재전송하고 receiver의 eventId digest dedup를 사용한다. 여러 worker가 동시에 같은 파일을 읽어도 동일 이벤트가 되며 ACK 후 ENOENT는 이미 처리된 것으로 본다. 통계의 delivered는 이 worker가 확인한 receipt 수이며 전역 신규 이벤트 수가 아니다. duplicateReceipts를 별도로 표시한다.

batch는 개별 내구 receipt들의 묶음이며 **파일시스템 전체 원자 transaction이 아니다**. 중간 오류/서버 crash로 prefix만 commit될 수 있다. 클라이언트는 전부 같은 ID로 재시도하며 이미 commit된 prefix는 duplicate ack를 받는다. 정상적인 작은 종료 실행은 한 HTTP 처리 안에서 끝까지 반영돼 중간 캐릭터를 노출하지 않는다. 큰 실행/중단 복구에서는 마지막으로 알려진 actor가 종료 이벤트까지 남을 수 있으며 현재 실행으로 추정하지 않는다.

worker는 업무 stdin/stdout과 분리되고 producer의 응답을 기다리게 하지 않는다. 실행 중 재시도 간격은 실패에 따라 약1→2→4→8→15초로 늘며 종료 시 별도 마지막 worker를 시작한다. HTTP 전송 deadline은1.2초/응답32KiB다. worker는 기본10초/256개 receipt 예산을 검사하며 개별 파일/ACL 작업은 기존 OS 검증 timeout도 적용받는다. 스풀 I/O와 ACL 확인 자체의 비용이 0이라는 뜻은 아니다.

## 보존과 상한

설치당1024개의 실행 예약, 실행당128개의 canonical 이벤트, 이벤트 파일2KiB 상한이다. payload의 이론상 상한은256MiB이며 파일시스템 할당 단위/metadata는 별도다. owner/complete marker는 실행당 작고 고정된 형식이다.

ACK된 event 파일만 자동 삭제한다. 예약 slot과 owner/complete marker는 재사용하지 않는다. 이는 늦게 돌아온 다른 worker의 ACK가 새 producer 파일을 지우는 경합을 막기 위한 보수적인 정책이다. 1024회 후 자동 초기화하지 않고 관찰이 fail closed한다. retainedRuns/capacityRemaining을 복구 명령에서 확인할 수 있다. 예약이 가득 차면 pending0이어도 종료2로 알린다. pending0과 producer/worker 종료를 확인한 뒤 운영자가 private archive/재등록하는 유지보수가 필요하다. 현재 Bridge도 별도로 execution1000/receipt4096 상한이 있다. 자동 archive/GC/상한 회피는 구현하지 않는다.

## 지연 이벤트와 화면

Bridge는 원래 occurredAt을 timeline과 lastObservedAt에 보존한다. Live projection의 freshness와 시각 scheduler는 수신 시각이 아닌 관찰 시각을 사용한다. 지연된 Read를 현재 작업처럼 새로 애니메이션하지 않는다. 실제 최근 수신 시각은 receivedAt으로 별도 표시한다. 이전 ledger 자료에서 관찰 시각을 알 수 없으면 restored/stale로 표시한다. 기존 구버전 Bridge snapshot에는 호환 fallback이 있지만 새 재전송 경로 활성화 시 웹 서버와 Bridge를 함께 갱신해야 한다.

새 persisted 필드는 optional이며 기존 자료를 지우지 않는다. 구버전의 strict validator는 새 필드를 거부할 수 있으므로 자동 코드 downgrade를 하지 않는다. 되돌릴 때 queue/receipt를 임의로 폐기하지 않는다.

## 복구 명령

```sh
npm run omp:replay
```

명령은 현재 private namespace를 한 번 조회/전송한다. 없으면 만들지 않는다. 테스트/다른 namespace는 `-- --state-dir /absolute/state`를 명시한다. 종료0은 그 scan에서 pending/오류 없음,2는 손상/신원 불일치 등 검토 필요,3은 미전송/오프라인/거부가 남았다는 뜻이다. 원본 에러/credential은 출력하지 않는다.

아직 상주 daemon이나 로그인 자동 시작은 설치하지 않는다. producer가 모두 끝난 뒤 서버가 복구되면 위 명령이 필요할 수 있다. 자동 UI queue monitor, 운영자의 archive/repair 도구, OMP Resume와 relay/executor correlation은 후속 범위다.

## 검증

자동 검사: offline business 응답/exit 보존, filesystem queue와 새 worker 복구, ACK 유실/receiver restart/token 교체, concurrent replay와 duplicate 억제, 손상/foreign installation 보존, per-run/설치 slot 상한, fresh-only, batch 인증/크기/committed prefix, malformed ACK 보존. 브라우저:60초 전 작업이 stale/실행 중0/도구 애니메이션 없음으로 표시되고 마지막 terminal replay 뒤 제거되는지 확인한다. 기존 Claude/OMP UI와 세 OS CI를 유지한다.

실제 Mac 검사는 별도 temp namespace에서 신규 durable CLI와 실제 OMP/Command Code/DeepSeek Read를 사용한다. 실제 운영 global agent 연결 활성화와 구분한다.

## 운영 활성화 제안 — 미적용

현재 `~/.claude/agents/omp-deepseek.md` SHA256은 `e50957755abb543a47198d7b9b0ff3843a02bfe2a5606f0c9bdfd4f767282253`다. 실행 접두사에서 파일명 한 곳만 바꾸고 나머지 prompt·모델·tools·max-time·stdin은 유지한다.

```diff
-"/Users/yohan/.nvm/versions/node/v22.23.3/bin/node" "/Users/yohan/Documents/ChatGPT/ai-pixel-office/orbit-works-p2a4/scripts/observe-omp.mjs" -- -p \
+"/Users/yohan/.nvm/versions/node/v22.23.3/bin/node" "/Users/yohan/Documents/ChatGPT/ai-pixel-office/orbit-works-p2a4/scripts/observe-omp-durable.mjs" -- -p \
```

승인 후 현재 hash와 실행 중인 owned 서버 PID/경로·활성 세션을 확인하고 private 백업한다. 웹 서버4173과 Bridge4183을 새 코드로 순서대로 재시작해 batch/관찰 시각 계약을 함께 적용한다. binding을 확인한 뒤 위 한 곳만 변경하고 전역 Claude 위임의 정상 수신·종료와 pending0을 검증한다. 필요 시 설치 키/queue를 폐기하지 않고 기존 접두사로 복귀한다. 기존 Hook settings/OMP config/models/auth는 변경 대상이 아니다. 현재 실행 중인 운영 서버는 이 단계에서 종료하지 않았다.
