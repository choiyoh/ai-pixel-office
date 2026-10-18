# P2-B.6 — relay↔executor 실제 correlation

> **경계:** 이 문서는 "Claude가 위임한 OMP 실행"을 실제 실행 증명으로 연결하는
> 구현과 검증을 기록한다. Hook sender·전역 위임 정의(`~/.claude/agents/omp-deepseek.md`)·
> OMP/Command Code 설정은 변경하지 않았다. 이름·프롬프트 유사도로 연결하지 않는다.
> Bridge·웹 서버 재시작(운영 적용)은 별도 승인 대상이다.

## 1. 문제

P2-B.4까지 Claude 채널과 OMP 채널은 각각 정확히 관찰했지만, **어느 Claude 세션이
어느 OMP 실행을 위임했는지**는 어떤 경로로도 연결하지 않았다. Bridge에는
`delegationId` 사전 등록 계약이 있었지만 운영에서 등록 경로가 없었고,
이름/프롬프트 유사도 기반 결합은 금지되어 있다(추정 금지).

## 2. 실측 근거 (2026-10-18, 실제 Mac)

1. **relay 증명은 이미 전달된다** (P2-A.4): `scripts/claude-forwarder.mjs`가 Hook payload에
   실행 중 Claude 조상 프로세스의 `orbit_execution: {version:1,pid,birth}`를 붙이고,
   `server/receiver.mjs`가 이벤트마다 `verifyClaudeExecution`으로 live 검증한 뒤
   `executionKey = HMAC(salt, JSON.stringify([platform,pid,birth]))`만 보존한다(raw 미보존).
2. **executor는 같은 증명을 스스로 얻을 수 있다**: 실제 Claude Code 세션의 Bash 실행에서
   `findClaudeExecution()` → `{"version":1,"pid":13877,"birth":"Sun Oct 18 13:53:09 2026"}`.
   같은 시각 웹 서버 Claude ledger는 revision 130→135, records 12→13으로 **검증된 실행을
   신규 등록**했다. 즉 래퍼가 보는 조상 신원과 서버가 검증한 relay 신원이 같은 물리 프로세스다.
3. **운영 위임 정의는 래퍼를 경유**하므로(`omp-deepseek.md` 20행) 래퍼가 증명을 자동
   부착하면 **전역 설정 변경 없이** correlation이 성립한다.

## 3. 설계

```
Claude Code ─ Hook(orbit_execution 증명) ─→ 웹 수신기(검증, executionKey)
     │
     └ Bash ─→ observe-omp-durable ─ findClaudeExecution()
                                    └→ OMP session.start.parentExecution {version,pid,birth}
                                        └→ Bridge ledger (executor actor에 보관)
                                            └→ 웹 office projection: resolveDelegation(proof)
                                                └→ HMAC 재계산 → Claude record.executionKey 일치?
                                                    → actor.delegatedBy = {name:"Claude · 00N"}
```

- `parentExecution`은 **session.start에만** 실린다(이후 이벤트가 재진술·교체하지 못한다).
- Bridge는 raw 증명을 보관하되 **UI로 내보내지 않는다**. projection은 대조에 성공한
  표시 라벨(`Claude · 00N`)만 노출한다. raw는 여전히 서버 경계 안에만 있다.
- 대조는 웹 서버가 두 채널을 모두 보는 위치(Claude live-projection + OMP reader)에서
  수행한다. Bridge의 `delegationId` 사전 등록 계약은 그대로 유지된다(별개 계층).

### 3.1 필드 계약

`parentExecution = {version:1, pid, birth}` — `pid > 1`, `birth` 1~80자,
`/^[A-Za-z0-9 .:+-]+$/`. 잘못된 형식·session.start 이외의 kind에 있으면 **422**로 거부.
증명이 없으면 필드는 `null`이고 결합도 없다(추정하지 않음).

### 3.2 저장 스키마

Bridge ledger state `version: 3`. 기존 v1/v2 파일은 로드 시 순차 업그레이드되고
(`v1→v2`: model 필드, `v2→v3`: `parentExecution: null`), 업그레이드 시각에는
파일을 다시 쓰지 않는다(다음 커밋에서 반영). 기존 actor 매핑은 보존된다.

## 4. 검증

`tests/relay-executor-correlation.integration.mjs` (3):
- Bridge가 증명을 actor에 보관하고, 이후 이벤트에 위조해 실어 보내면 422로 거부하며,
  형식 오류 6종을 모두 거부하고, 증명 없는 실행은 null로 남긴다.
- projection이 검증된 라벨만 노출하고(미검증·불일치·비정상 라벨은 null),
  actor에 raw가 남지 않으며, 형식 오류 증명은 fail-closed 한다.
- live-projection `matchExecution`이 자기 HMAC으로만 일치시키고(다른 pid/birth/platform 불일치),
  잘못된 입력 7종에 null을 반환한다.

기존 회귀: Bridge v1 업그레이드 테스트가 v1 스키마를 정확히 재현하도록 갱신
(`delete e.parentExecution`). unit 31/31, integration 53 pass·4 skip(Windows 전용).

### 4.2 운영 실증 (2026-10-18, 실제 Mac)

Bridge(4183)·웹(4173)을 새 코드로 재시작한 뒤 **실제 위임 3회**로 확인했다.

- Bridge ledger **v2 → v3 자동 업그레이드**, actor에 Claude 조상 증명 저장
  (실측 pid `31660` · `36538` · `43407`).
- OMP 채널 actor `delegatedBy = Claude · 017` / `Claude · 019` — 이름·시간 근접이 아니라
  HMAC 실행 증명 대조 일치로만 연결됐다.
- UI 실화면 캡처: 카드 `← Claude · 019`, 인스펙터 `위임 출처 / Claude · 019 · 실행 증명 일치`.
- outbox `pending 0 · blocked 0 · lastRejection null` — 거부 없이 전부 수용됐다.

재현 절차(운영 위임 실증):
1. `claude -p "Use the omp-deepseek subagent through the Task tool to delegate this to OMP: <작업>" --allowedTools Task Bash`
   - `--allowedTools "Task"`만 주면 subagent의 Bash가 거부되어 OMP가 실행되지 않는다.
     Task와 Bash를 **함께** 허용해야 한다.
   - `claude --agent omp-deepseek -p …` 경로도 OMP 호출에 성공한 사례가 있다(실행 4, 16초).
     다만 같은 방식의 재시도 1회는 10분간 OMP를 호출하지 못하고 표류했다. Task 위임 경로가
     3/3 성공으로 더 일관적이므로 실증·자동화에는 Task 경로를 쓴다.
2. OMP 실행은 위임 시작 후 수십 초 안에 나타난다. actor는 live일 때만 목록에 남으므로
   표시를 확인하려면 **실행 중에** 조회해야 한다(폴링). 짧은 실행은 시작·종료만 timeline에 남는다.

## 5. 운영 적용 (2026-10-18 완료)

- **래퍼는 즉시 적용된다**: `omp-deepseek.md`가 CODE의 `scripts/observe-omp-durable.mjs`를
  직접 실행하므로 다음 위임부터 새 필드가 실린다.
- **Bridge·웹 서버 재시작 완료**: 구버전 Bridge는 `parentExecution` 키를 모르는 allowlist라
  이벤트를 422로 거부하고, 그 사이 위임 이벤트는 삭제되지 않고 durable outbox에 남는다(무손실).
  재시작은 P2-B.5와 같은 승인 절차로 수행했다: 활성 actor 0 확인 → 소유 PID만 SIGTERM
  (Bridge 67960 → **28881**, 웹 10302 → **29448**) → 새 코드 기동 → 라우트·UI 실검증.
  재시작 사이 `installationInstanceId`(`53efa927…`)가 유지되어 outbox binding·등록 토큰이
  계속 일치했다.

## 6. 한계 (남은 범위)

- 실제 위임 1회의 end-to-end 실증(재시작 후)이 완료 조건이다.
- 동시 provider scene(같은 scene에서 Claude·OMP를 함께 그리기)은 여전히 미구현이며,
  actor/render namespace·좌석·종료·중복 회계 설계가 선행되어야 한다. 이번 작업은
  correlation 표시까지만이며 "통합 scene 완료"가 아니다.
- Claude subagent의 논리적 신원(agent id)은 여전히 저장하지 않는다. 연결 근거는
  OS 실행 증명이며, 여러 OMP 실행이 같은 Claude 실행 아래 있으면 각각 같은 출처로 표시된다.
