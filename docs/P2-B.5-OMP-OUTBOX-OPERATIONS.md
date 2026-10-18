# P2-B.5 — Outbox 운영 관찰과 복구 편의

> **경계:** 이 문서는 P2-B.5의 구현(읽기 전용 상태 표시, 복구 신호, 아카이브 절차)과
> 설계 판단을 기록한다. 기존 운영 서버·Hook·전역 위임 정의·ledger는 이 단계에서
> 변경하지 않았다. 실제 운영 적용(서버 재시작, UI 반영)은 별도 승인 대상이다.

## 1. 배경

P2-B.4에서 내구 Outbox와 재전송 worker가 운영에 적용되면서 세 가지 운영 공백이 남았다.

1. queue의 pending·예약 잔여·차단 상태를 화면에서 볼 수 없다.
2. producer가 모두 끝난 뒤 Bridge가 복구되면 아무도 drain하지 않아 수동 `omp:replay`가 필요하다.
3. 예약(1024)이 소진됐을 때 기록을 지우지 않고 정리하는 절차가 없다.

P2-B.5는 이 세 가지를 다룬다. 상주 daemon·로그인 자동 시작·자동 상한 회피는
설치하지 않는다(인수인계서 제약).

## 2. P2-B.5a — 읽기 전용 queue 상태 (구현)

### 2.1 코어

`platform/omp-outbox.mjs`의 `readOmpOutboxStatus({directory, bridgeDirectory})`가
queue를 **읽기만** 한다. 전송·삭제·생성·수리하지 않는다. run 이름 수준에서만 세고,
손상된 run은 `blockedRuns`로 보고한다(수리 금지).

반환 allowlist(이 필드 외에는 어떤 payload도 나가지 않는다):

| 필드 | 의미 |
| --- | --- |
| `prepared` / `enrolled` | queue 디렉터리 존재 / binding 등록 여부 |
| `pending` | ACK 대기 canonical event 파일 수(전체 run 합) |
| `retainedRuns` / `capacityRemaining` | 사용 중 예약 수 / 남은 예약(1024 기준) |
| `blockedRuns` | 읽기·검증이 거부된 run 수(보존, 미수리) |
| `installationMismatch` | 살아있는 registry가 다른 설치를 가리킴 |
| `registry` | `missing` / `alive` / `stale` |
| `writers[]` | `{run, pid, alive}` — producer 생존 여부 |
| `lastRejection` | `{at, statusCode}` — 마지막 4xx 거부의 권고 기록 |
| `recoveryRequired` | 아래 3절의 bounded recovery 조건 |

`replayOmpOutbox`가 4xx 거부를 관찰하면 `omp-outbox/last-rejection.json`
(`{version, at, statusCode}`)에 권고 기록을 남긴다. prompt·credential·event
payload는 포함하지 않으며, 기록 실패는 replay 결과에 영향을 주지 않는다.

### 2.2 API

`GET /api/omp/outbox` — 웹 4173, 기존 쿠키 인증 목록에 포함. 응답은
`{ready:true, ...status}`이며 실패 시 503이다. registry/token/경로는 응답에 없다.
`npm run omp:replay` 계열과 달리 이 경로는 **어떤 상태도 바꾸지 않는다**.

### 2.3 화면

OMP 채널의 connection-panel에 `data-testid="omp-outbox-status"`로 표시한다:
대기 수·예약 여유·차단·설치 불일치·registry 상태·마지막 거부·복구 필요.
Claude 채널에서는 표시하지 않는다. 5초 주기 폴링이며 실패는 조용히 미표시한다.

## 3. P2-B.5b — bounded recovery 설계

### 3.1 문제

`observe-omp-durable`의 worker kick은 producer가 살아있는 동안에만 일어난다.
producer가 모두 끝난 뒤 Bridge가 복구되면 pending이 남아도 재전송 주체가 없고,
운영자가 `npm run omp:replay`를 명시적으로 실행해야 한다.

### 3.2 검토한 선택지

| 선택지 | 판단 |
| --- | --- |
| 상주 daemon / 로그인 자동 시작 | **금지**(인수인계서). 설치하지 않음 |
| Bridge 시작 시 자동 drain | 배제. Bridge는 outbox namespace를 모르며, 관찰 채널의 소유자가 아님 |
| 웹 서버 시작 시 자동 drain | 배제. 웹 서버가 queue의 소유자가 아니고 재시작마다 부작용을 만든다 |
| 상태 신호 + 명시적 복구 | **채택**. 관찰은 읽기, 복구는 운영자의 명시적 명령 |

### 3.3 채택안

`recoveryRequired`는 다음을 **모두** 만족할 때만 true다.

- `pending > 0` — 보낼 것이 남아 있고,
- `registry === "alive"` — 수신 가능한 Bridge가 있고,
- `installationMismatch === false` — 같은 설치이며,
- 모든 writer가 종료 — 진행 중 producer가 없다.

UI는 true일 때 `복구 필요 · npm run omp:replay`를 표시한다. 이는 권고 신호이며
어떤 daemon도 자동으로 행동하지 않는다. 서버 시작 시 자동 drain, wake-up hook,
queue 감시 daemon은 여전히 구현하지 않았다(향후에도 별도 승인 필요).

### 3.4 후속 검사 제안

producer 전원 종료 → Bridge 나중 복구, ACK 손실 후 프로세스 재시작,
quota/디스크·권한 오류, 부정확한 clock/과거 이벤트, concurrent drain 경합,
설치 UUID 변경, malformed/부분 batch ack, UI 민감정보 부재.

## 4. P2-B.5c — archive/복구 절차 (구현)

```sh
npm run omp:archive            # 검사만 (기본). 아무것도 옮기지 않는다.
npm run omp:archive -- --apply # 조건을 만족한 run만 private archive로 이동
```

`platform/omp-outbox.mjs`의 `archiveOmpOutboxRuns`가 수행한다.

### 4.1 이동 조건(모두 충족해야 함)

- binding이 등록된 queue이며, 살아있는 registry와 설치 신원이 일치한다.
- run에 event 파일이 0개다(전부 committed receipt 확인 후 삭제됨).
- owner pid가 종료됐다.
- `complete.json`(version/executionId/finalSequence)이 유효하다.
  **완료 marker 없는 run은 강제 종료로 관찰이 끊긴 미확인 실행이므로 옮기지 않는다.**
  가짜 `execution.end`를 만드는 cleanup은 금지다.

보류되는 run은 사유별로 보고한다: `retainedPending`, `retainedWriters`,
`retainedIncomplete`, `retainedBlocked`.

### 4.2 동작과 보존

- 이동 위치: `omp-outbox/archive/<UTC 타임스탬프>/run-NNNN` (0700/0600 유지).
- **삭제가 아니라 이동**이다. event·owner·complete 기록은 아카이브에 보존된다.
  binding과 last-rejection note는 루트에 남는다.
- 슬롯이 비워져 예약 예산이 재사용된다. 상한을 기록 삭제로 우회하지 않는다.
- 이동 후 늦은 worker의 ACK는 ENOENT로 무해하다(파일명 identity 불변).

### 4.3 종료 코드

| 코드 | 의미 |
| --- | --- |
| 0 | 이동 완료 또는 이동할 것이 없음(보류 없음) |
| 3 | 일부 run 보류(pending/writer/incomplete/blocked) — 검토 필요 |
| 2 | 거부/오류(미등록 queue, 살아있는 타 설치 신원, 권한 등) — 원본 보존 |

## 5. 검증

`tests/omp-outbox-status.integration.mjs` (7):
읽기 전용성(파일 트리 불변)·미준비 상태·registry missing/stale/설치 불일치(미수리)·
손상 run의 blocked 보고·4xx 권고 기록과 복구·recoveryRequired 조건·
쿠키 보호 라우트와 allowlist.

`tests/omp-outbox-archive.integration.mjs` (4):
전달 완료 run 이동과 pending/writer/미확인 보류·완료 marker 부재 시 보류·
미등록/타 설치 신원 거부·빈 queue no-op.

브라우저(`scripts/omp-outbox-browser.mjs`): OMP 채널에서 송신 큐 대기 수가
표시되고, replay 후 0으로 갱신되는지 확인(`outboxStatusVisible`, `outboxDrained`).

로컬 결과(2026-10-18): unit 31/31, integration 51 pass·4 skip(Windows 전용),
lint·typecheck·check:source 통과, 브라우저 6종 통과.

## 6. 운영 주의 (기존 계약 유지)

- `npm run omp:replay`는 여전히 **조회 전용이 아니다.** 인수 점검 목적으로 무심코
  실행하지 않는다. 조회는 `GET /api/omp/outbox` 또는 `omp:archive` 검사 모드로 한다.
- Bridge는 **끝난 native session의 fresh 재등장을 409로 거부**한다(실측). 재전송은
  같은 실행·같은 eventId로만 유효하며, 새 실행은 새 관찰 session을 가져야 한다.
- 서버·Hook·전역 위임 정의는 이 단계에서 변경하지 않았다. 운영 적용은 Diff 승인 후.

## 7. 다음 후보 (P2-B.5 범위 밖)

- relay/executor 실제 correlation, 동시 provider scene.
- OMP Resume / 실제 OMP Edit / Windows·Linux native 실행(미검증).
