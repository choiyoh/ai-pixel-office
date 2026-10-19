# P2-C.1 — 동시 실행 견고성 (Concurrent Executions)

## 0. 목표와 결론

`docs/ADAPTERS-AND-REMOTE.md`의 구현 순서 6번("권한·민감정보 계약을 통과한 fake Adapter 두 개로 충돌·병렬 자식·재연결을 **먼저** 검증한다")을 코드 수준에서 이행했다. **제품 코드는 한 줄도 바꾸지 않았고**, 기존 구현이 이미 동시성 계약을 지키고 있음을 **회귀 테스트 5종으로 고정**했다.

즉 이 단계의 산출물은 기능이 아니라 **증거와 잠금(lock)**이다: "여러 AI가 동시에 일하는 사무실"이 실행 2개·프로세스 2개·서버 재기동에서도 깨지지 않는다는 사실을, 앞으로의 변경이 깨뜨리면 테스트가 먼저 알려준다.

## 1. 갭 분석 — 무엇이 이미 있고 무엇이 없었나

기존 커버리지(있음):
- 한 실행 안의 **병렬 도구**(parallel tool correlation, late call identity 거부)
- **동시 replay**(`Promise.all([replay, replay])` 중복 실행 없음)
- **resume overlap 차단**·실행 슬롯 capacity·actor capacity
- 재기동 관련: "별도 bridge 기동이 기존 registry를 덮어쓰지 않음", "receiver rejection과 offline 구분"

갭(없었음):
- 두 **실행**이 동시에 스트리밍할 때의 **인터리브** 정합(A1 B1 A2 B2 …)
- 한 실행의 terminal이 다른 실행에 **새는지**, 양쪽 서로의 부활
- **실제 프로세스 2개**가 같은 큐에 동시에 쓰는 경합
- **서버 재기동 중 진행 중 실행**의 연속성(수동 실증만 있었음)
- 같은 채널에서 **복수 actor**(좌석 키 분리·타임라인 무손실)

## 2. 추가한 테스트 5종

| # | 테스트(원문 제목) | 파일 | 검증 |
|---|---|---|---|
| 1 | two executions streaming at once never cross sequences, actors or terminals | `tests/provider-bridge.integration.mjs` | A·B를 A1B1A2B2…로 교차 전송. 중간에 **actor 2명**(renderId 상이), 종료 후 실행 기록 2개가 각자 `terminal`, `sessionKey` 2개. 두 실행이 **같은 `call-2` 네이티브 도구 ID**를 써도 실행 공간이 섞이지 않음 |
| 2 | a finished execution cannot swallow the other stream, and neither revives | `tests/provider-bridge.integration.mjs` | B가 먼저 종료해도 A는 계속 작업(actor 잔존 1). 종료된 B의 late 이벤트와 A의 종료 후 이벤트 모두 `409 terminal-execution` |
| 3 | two writers racing the same queue each reserve their own slot without losing events | `tests/omp-outbox.integration.mjs` | **실제 자식 프로세스 2개**를 동시에 spawn해 같은 큐에 기록. `run-0000`·`run-0001`로 분리 예약되고 이벤트 6건 전부 전달(`pending 0`, `blockedRuns 0`) |
| 4 | a bridge restart mid-run queues the live stream and lets a new run flow immediately | `tests/omp-outbox.integration.mjs` | 실행 A 진행 중 bridge 재기동 → A의 나머지는 **보류**, 재기동 후 **새 실행 B는 즉시 전달**, replay로 `pending 0`·`blockedRuns 0` |
| 5 | several actors per channel keep distinct scene keys and all reach the merged timeline | `tests/scene-projection.integration.mjs` | 채널당 2 actor(총 4명) 동시. scene 키 `[1, 2, 1000001, 1000002]`로 **충돌 없음**, 병합 타임라인 4건 유지, 최신 항목이 첫 번째 |

## 3. 이 테스트들이 밝힌 계약 (발견)

- **mkdir 기반 슬롯 예약은 실제 프로세스 경합에서도 원자적**이다. 두 프로세스가 동시에 시작해도 같은 슬롯을 두 번 잡지 않는다(테스트 3).
- **재기동 후 새 실행은 갱신된 transport로 즉시 전달**되고, 진행 중 실행은 옛 바인딩을 유지한 채 보류됐다가 replay로 회복된다(테스트 4). 이는 래퍼 프로세스 수명 = 실행 수명이라는 설계와 일치한다.
- **scene 타임라인의 정렬 계약**: 병합은 `at` 내림차순, 동률이면 `order` 내림차순. OMP 행은 `receivedAt`을 나르고 투영이 이를 `at`으로 매핑한다(테스트 5가 이 매핑을 문서화).
- 실행 공간 분리는 **네이티브 ID가 같아도** 유지된다(테스트 1의 `call-2`): 실행 식별이 이름·ID 유사도가 아니라 실행 키 기준임을 확인.

## 4. 검증 결과

- `npm run test:integration`: **72 tests, 68 pass, 4 skip, 0 fail** (신규 5 포함)
- `npm test` 32/32 · `npm run lint` exit 0 · `npm run typecheck` exit 0
- 3-OS CI: (이 문서 커밋 후 링크 추가)

## 5. 경계 — 이 단계가 주장하지 않는 것

- **실 네트워크 단절·지연 주입**은 다루지 않았다. 모든 경로는 loopback이며, fault injection 확장은 후속 범위다.
- UI **실화면**의 다중 actor는 P2-B.6②에서 2 actor로 실증했다. 4 actor 실화면 캡처는 이 단계에 포함되지 않는다.
- 리눅스 native 실행은 여전히 사용자 지시로 우선순위가 아니다.
- "fake Adapter 두 개"의 **실제 외부 Provider API** 단계(원문 6번의 후반부)는 별도 승인 대상이다 — 이 단계는 그 전단 검증에 해당한다.
