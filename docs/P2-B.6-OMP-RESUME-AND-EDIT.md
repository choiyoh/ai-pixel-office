# P2-B.6 ③ OMP Resume 지원과 실제 Edit 검증

> **상태: 코드 구현·격리 검증 완료. 운영 Bridge 적용은 별도 승인 대기.**

## 0. 요약

- OMP 18.10.0의 실제 계약을 읽기 전용으로 실측했다: `--resume`, `--session-dir`, 세션 JSONL 저장, 그리고 **resume 시 동일 `session.id` 유지**.
- 관찰 래퍼 `platform/observe-omp.mjs`의 착수 계약을 **3모드**(ephemeral fresh / stored fresh / explicit resume)로 확장하고, 이벤트 변환 `server/bridge/omp.mjs`가 `startSource: "resume"`을 통과시키게 했다. Bridge ledger는 이미 `resume` 시맨틱(세대 증가·actor 유지)을 갖고 있어서 손대지 않았다.
- 결손 하나를 추가로 고쳤다: native 세션 신원 해시 키가 **실행마다 랜덤**이라 같은 세션도 매번 다른 actor가 됐다. 설치 단위 salt로 안정화했다(원본 native id는 계속 전송되지 않는다).
- 실증(래퍼 경유 실 OMP E2E): `session.start(startSource=resume)` → **같은 actor**, **generation 1→2**, 그리고 실제 **edit** 도구가 파일을 `orbit resume works` → `orbit resume works\nresumed ok`로 수정.
- **운영 스택**까지 실증(실 OMP + durable outbox + 실 Bridge 4183): 저장 실행과 resume이 **같은 세션 키·같은 actor**로 이어지고 generation 1→2가 Bridge 원장에 기록됐다. 이 과정에서 큐의 fresh 전용 게이트 2곳을 찾아 고쳤다(§3.5).

## 1. OMP 18.10.0 실제 계약 (실측)

`omp --help`에서 확인한 관련 플래그:

- `-c, --continue` / `-r, --resume=<value>` — "Resume a session (by ID prefix, path, or picker if omitted)"
- `--session-dir=<value>` — 세션 저장·조회 디렉터리
- `--no-session` — 세션 미저장(휘발성)
- `--mode=json` — 이벤트 스트림

세션 저장 형식(실측):

```
<sessions>/<ISO timestamp>_<uuid>.jsonl    # 예: 2026-10-19T00-29-27-586Z_01a15190-34a2-7596-b950-1328d27620d7.jsonl
```

- 같은 세션을 재개하면 **파일을 새로 만들지 않고 이어 쓴다**(파일 1개 유지).
- `session` 이벤트의 `id`는 항상 같은 값으로 나온다: 직접 CLI 실험에서 run1/run2 모두 `01a1518a-…`(동일)였다. 즉 **resume 여부는 이벤트 텍스트에 없고, 착수 인자로만 알 수 있다**.
- 이벤트 종류: `session`, `agent_start`, `turn_start/end`, `message_*`, `tool_execution_start/update/end`, `agent_end`, `advisor_cost_changed`.
- `tool_execution_start/end`의 `toolName`에는 `read`, `write`, `edit`이 그대로 온다(실측: write 1회 + edit 1회).

## 2. 발견한 결손 2가지

1. **래퍼 계약이 resume을 거부했다**
   - `printContract`가 `--no-session`을 필수로 요구하고, `--resume|-r|--continue|--session-dir`를 "Unreviewed OMP observer launch option"으로 거부했다.
2. **세션 신원 해시 키가 실행마다 랜덤이었다**
   - `const identityKey = randomBytes(32);` → 같은 native 세션도 실행이 바뀌면 다른 `nativeSessionId`가 되어, Bridge가 서로 다른 actor/세션으로 기록했다. 그 결과 resume 실행이 "새 actor"로 나타났다(E2E 1차 실패에서 실측).

## 3. 구현 변경 (4곳)

### 3.1 `platform/observe-omp.mjs` — 착수 계약 3모드

| 모드 | 인자 | `startSource` |
| --- | --- | --- |
| ephemeral fresh(기존) | `-p … --no-session --no-extensions --max-time …` | `startup` |
| stored fresh(신규) | `-p … --session-dir <dir> --no-extensions --max-time …` | `startup` |
| explicit resume(신규) | 위 + `--resume <id|path>` | `resume` |

- resume는 `--no-session`과 함께 쓸 수 없고, `--session-dir`와 id/경로가 **모두 명시**되어야 한다. id 자리에 다른 플래그가 오면 거부한다(대화형 picker 금지).
- 금지 목록은 유지: `--api-key`, `--profile`, `--from-claude`, `--from-codex`, `--continue`(-c), `--config`, `--hook`, `--extension`, `--plugin-dir`, `--alias`, `-e`.
- `startSource`는 **착수 인자에서만** 판정한다(이벤트 텍스트에 resume 표시가 없으므로).

### 3.2 `platform/observe-omp.mjs` — 세션 신원 안정화

```js
const identityKey =
  typeof transport?.installationInstanceId === "string" && transport.installationInstanceId
    ? Buffer.from(`omp-observer-v1:${transport.installationInstanceId}`)
    : randomBytes(32);
```

- 설치 id는 검토된 비밀 아님(비밀번호 아님) salt다. 원본 native id는 여전히 관찰자 밖으로 나가지 않고, 나가는 것은 키 있는 다이제스트뿐이다.
- 설치 id가 보고되지 않는 경우(테스트/비정상)에는 기존 동작(실행별 랜덤)을 유지한다.

### 3.3 `server/bridge/omp.mjs` — 이벤트 변환 허용 확장

```js
const startSource = context.startSource ?? "startup";
if (!["startup", "resume"].includes(startSource)) throw bridgeError(422, "omp-fresh-print-only");
event.startSource = startSource;
```

### 3.4 `platform/omp-outbox.mjs` — 큐가 resume을 이해하게 (운영 경로에서 발견)

E2E(fixture bridge)는 통과했지만 **운영 스택**에서는 resume 이벤트가 큐에서 거부됐다. 두 게이트를 고쳤다.

- `canonical()`이 `session.start`의 `startSource`를 `startup`만 허용했다 → `startup|resume`으로 확장.
- 무조건 허용하지는 않는다: run을 여는 시점에 **이 큐가 이미 관찰한 세션**의 resume만 받는다(`observedSession`, 기존 run의 `owner.json` 대조). 처음 보는 세션을 resume으로 시작하면 예전과 동일하게 거부된다(테스트로 고정).
- 큐잉 이벤트의 기록 규칙(이벤트 파일·소유자·완료 마커·전송 재시도)은 그대로다.

### 3.5 변경하지 않은 것 (서버 측)

- `server/bridge/ledger.mjs`: 이미 `sessionKey = hash(providerId, installationInstanceId, nativeSessionId)`와 `resume` 재사용 규칙(이전 execution이 terminal일 때만, `generation++`, 64 세대 상한)을 갖고 있다.
- `server/bridge/schema.mjs`: `startSource` enum이 이미 `startup|resume|clear`다.
- Hook·전역 설정·`omp-deepseek` 위임 정의·자격증명: **무변경**.

## 4. 검증 (실측)

### 4.1 직접 CLI 프로브 (래퍼 미경유)

- fresh 저장 실행 → `--resume <session file>` 재개: **같은 `session.id`**, `hello.txt`가 `orbit works` → `orbit works\nverified`(edit 도구).
- 즉 OMP 자체는 이벤트에 resume 마커를 넣지 않는다(착수 인자 판정 근거).

### 4.2 래퍼 경유 E2E (실 OMP + 실 Bridge ledger, `scripts/omp-resume-e2e.mjs`)

```
A session.start startSource=startup native=cc6297c55e
B session.start startSource=resume  native=cc6297c55e
VERDICT {sameNative:true, sources:["startup","resume"], generations:[1,2], distinctActors:1, liveActors:0}
hello-e2e.txt: "orbit resume works\nresumed ok"
```

- 같은 native 신원 → **actor 1명 유지**, 세대 1→2(resume 재사용 경로), 종료 후 활성 actor 0.
- 실제 edit 도구가 파일을 수정(내용 증거 위).

### 4.3 운영 스택 실증 (실 OMP + durable outbox + Bridge 4183)

```
revision 137  cbe7b6b1  gen 1  execution.end     ← 저장 실행(09:46)
revision 138  cbe7b6b1  gen 2  session.start     ← resume(09:56)
revision 139…142 cbe7b6b1 gen 2 tool/turn/end
session 02d3449b80 → actor cbe7b6b1, generation 2
replay 보고: {"delivered":5,"pending":0,"blockedRuns":0,"rejected":false}
```

- 같은 세션·같은 actor로 이어졌고, 큐가 비었으며(pending 0) 거부도 없었다.
- 같은 수정 뒤 실제 위임(fresh ephemeral) 1회가 정상적으로 위임 링크(`Claude · 0NN` → `OMP · 0NN`)를 만들었다 — fresh 경로 회귀 없음.

### 4.4 자동 회귀

- 단위 **32/32**, 통합 **63 pass / 4 skip(Windows 전용) / 0 fail**.
- 신규 테스트 4종:
  - resume 계약 수락/거부(ephemeral·session-dir·id 누락·`--continue`·`--profile` 거부, 수락 시 `startSource=resume`이 ledger까지 도달).
  - 세션 신원이 실행 간 안정·설치 단위 scoped이며 원본 id 미노출.
  - 설치 id 미보고 시 기존 실행별 랜덤 동작 유지.
  - 큐가 **관찰한 세션의 resume만** 수락(미관찰 resume은 계속 거부).
- `lint`, `typecheck`, `check:source` 통과.

## 5. 재현 절차

```sh
# 저장(fresh) — 새 세션 파일을 만든다
node scripts/observe-omp-durable.mjs -- -p "Create a file named hello-e2e.txt whose content is exactly: orbit resume works" \
  --no-extensions --max-time 3m --session-dir /path/to/sessions --tools read,write,edit --auto-approve

# 재개 — 같은 세션 파일을 명시해 이어서 실행한다(같은 actor, 세대 +1)
node scripts/observe-omp-durable.mjs -- -p "Read hello-e2e.txt and append a second line containing: resumed ok" \
  --no-extensions --max-time 3m --session-dir /path/to/sessions --resume /path/to/sessions/<session>.jsonl \
  --tools read,write,edit --auto-approve

# 래퍼+실 Bridge 통합 재현(실 모델 호출 2회, 수동 실행 전용)
node scripts/omp-resume-e2e.mjs [work-root]
```

## 6. 운영 적용 상태

- 2026-10-19 09:12 KST에 Bridge(4183)를 재시작해 서버 측 변경(`server/bridge/omp.mjs`)을 적용했다 — 새 PID **90172**, ledger 설치 id `53efa927` 유지, outbox 정상.
- 이후 추가 수정(`platform/omp-outbox.mjs`)은 **클라이언트(래퍼) 경로**다: 래퍼는 실행마다 최신 파일을 읽으므로 재시작이 필요 없고, 서버는 outbox의 읽기 경로만 쓴다.
- 웹(4173)·Hook·전역 설정·자격증명: **무변경**. 운영 위임 정의는 계속 ephemeral(`--no-session`)이다.

## 7. 남은 것

- Windows/Linux native 실행(실 OMP·DeepSeek 연결).
- 저장 모드의 세션 누적 정책(디렉터리 위치·정리)은 실제 사용을 시작할 때 정한다.
