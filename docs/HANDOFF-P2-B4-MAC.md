# Orbit Works 인수인계서 — P2-B.6 ③ OMP Resume·실제 Edit 검증 운영 적용 완료

**다음 에이전트는 이 문서를 먼저 읽고, 현재 상태를 읽기 전용으로 재확인한 뒤 사용자께서 지정하는 다음 작업을 진행해 주세요. 이 문서 작성 자체는 새 기능 구현이나 서버 재시작 요청이 아닙니다.**

- 최종 운영 확인: **2026-10-19 10:44 KST**.
- ③ 검증·적용 코드: **`4d1a45d`**(resume 계약·세션 신원 안정화) + **`f7f741b`**(lint 수정) + **`b8e84a0`**(durable 큐의 resume 수락). CI [39181391934](https://github.com/choiyoh/ai-pixel-office/actions/runs/39181391934)(4d1a45d/f7f741b)과 [39183152373](https://github.com/choiyoh/ai-pixel-office/actions/runs/39183152373)(b8e84a0/1d66707) 모두 3-OS success입니다. 직전 ②(`0fa83da`+`b67bd9d`)도 [39173148512](https://github.com/choiyoh/ai-pixel-office/actions/runs/39173148512) 3-OS success입니다.
- 최신 작업 브랜치: **`codex/p2-b6-relay-executor-correlation`**, origin에 push되어 있습니다.
- 이후 문서 커밋(`8f9ca39`·`0650e3f`·`35306b0`·`653893c`)에는 별도 코드 CI를 주장하지 않습니다. **코드 기준은 ③의 `4d1a45d` + `f7f741b` + `b8e84a0`입니다.**
- 프로젝트는 P2-A.4, P2-B.1~B.6 ③(운영 적용 포함)과 ④ Windows **플랫폼 경로**까지 진행했습니다. **P2-B 전체의 모든 요구가 완료된 것은 아닙니다** — Windows 실 모델 왕복(자격증명 필요)이 남아 있습니다.

## 1. 가장 먼저 알아야 할 현재 상태

| 항목 | 현재 사실 |
| --- | --- |
| 서비스 | Orbit Works: 관찰된 AI 세션을 Pixel Agents 사무실에 표시하는 로컬 앱 |
| 로컬 화면 | <http://127.0.0.1:4173> → **LIVE OFFICE → 관찰 채널 "통합 (Claude + OMP)"** (단독 채널 전환도 유지) |
| 실제 실행 경로 | **Claude Code `omp-deepseek` → 내구 관찰 래퍼 → OMP → Command Code provider → DeepSeek** |
| Claude 경로 | 기존 사용자 Hook → 별도 Claude intake/ledger → Claude 관찰 채널 |
| 화면 통합 범위 | **통합 채널에서 Claude/OMP를 한 scene에 동시 표시**(OMP engine key는 `+1_000_000` 네임스페이스, 표시 이름·palette·좌석은 채널별 원본 유지). OMP 실행에는 **검증된 실행 증명이 일치할 때만** 위임 출처(`Claude · 00N`)와 "대상 보기" 링크를 표시. 업무 단위 중복 제거(두 actor 합치기)는 하지 않음 |
| 새 OMP 송신기 | **`scripts/observe-omp-durable.mjs`가 전역 위임 정의에 적용됨**. Claude 조상 실행 증명을 OMP `session.start.parentExecution`에 부착 |
| 운영 Outbox | 실제 등록·생성·가동 완료. 더 이상 적용 승인 대기 상태가 아님 |
| 서버 | 웹4173 / Bridge4183 모두 실행 중. PID는 아래 시점별 값이며 항상 재확인 필요 |
| 마지막 관찰값 | 2026-10-19 07:57 KST 재시작·실증 직후: 활성 actor0(양 채널), Outbox pending0·blocked0·recoveryRequired false, registry alive |
| Outbox 예약 | 사용2 / 잔여1022. ACK된 event 파일은 없고 owner/complete 예약은 보존됨 |
| 현재 코드 작업 트리 | clean |
| CI | b67bd9d(39173148512) Windows/macOS/Linux 모두 성공 |
| 이번 인수인계 작업 | ② 운영 적용(웹 4173만 재시작) 후 문서/검증 근거 정리. Hook·설정·Bridge·ledger 무변경 |

**주의:** `docs/P2-B.1~4`의 일부 본문, 예전 로컬 보고서에는 작성 당시의 “미검증/미적용/승인 대기/미구현” 문구가 남아 있습니다. 현재 운영 적용에 관해서는 **이 인수인계서와 최종 적용 증거**가 우선입니다. 이미 완료된 송신기 교체나 Hook 설치를 다시 수행하지 마세요.

## 2. 사용자 지시와 승인 경계

1. 사용자께 **친근하지만 존중하는 한국어 존댓말**로 말씀드립니다.
2. 기존 Claude Code·Command Code provider·DeepSeek·OMP 환경을 유지합니다. 불필요한 재설치/업데이트/로그인/인증 재설정을 하지 않습니다.
3. 사용자의 명시적 조건: **“Hook sender 변경이나 설정 수정이 필요하면 예상 Diff를 먼저 제출하고 별도 승인을 받습니다.”** 새 변경은 구현·격리 검사·정확한 Diff를 먼저 준비해 운영 적용만 최종 승인 대상으로 만듭니다.
4. 기존 서버를 승인 없이 종료하지 않습니다. 승인받은 재시작도 실제 PID·command·cwd·registry 소유·활성 actor를 먼저 확인합니다. `killall`/넓은 `pkill`로 종료하지 않습니다.
5. 이미 승인·완료된 과거 적용을 다시 승인받거나 반복하지 않습니다. 현재 P2-B.4·B.5·B.6 ① 적용은 완료됐습니다. 향후 다른 변경의 승인까지 포괄하는 것은 아닙니다.
6. Hook은 **12종 각1개**가 설치되어 있습니다. 설치/중복 등록하지 않습니다. `settings.json`을 덮어쓰지 않습니다.
7. prompt·도구 인자·결과·파일 경로·원본 native ID·credential을 이벤트/큐/UI에 저장하거나 전달하지 않습니다. 문서의 운영 파일 경로와 승인 Diff는 이 제한의 이벤트 payload가 아닙니다.
8. `omp token`, `omp auth export`, credential DB/키 출력, 환경 변수 전체 덤프를 하지 않습니다. `~/.omp` auth DB나 private backup을 Git에 올리지 않습니다.
9. 실제 업무 상태와 시각 애니메이션은 별개입니다. fake 작업 생성, 완료/working 조작, 종료 추측, prompt/이름 유사도에 의한 신원 결합을 금지합니다.
10. PASS는 실제 검증된 범위에만 부여합니다. 합성 CI와 실제 Mac 검사를 구분합니다.

## 3. 저장소·작업 경로 — 잘못 정리하면 운영이 깨집니다

리모트: <https://github.com/choiyoh/ai-pixel-office>

| 경로 | 역할 / 주의 |
| --- | --- |
| `/Users/yohan/Documents/ChatGPT/ai-pixel-office` | 여러 checkout과 로컬 보고서를 담은 상위 작업 폴더. 최신 앱 소스 루트로 착각하지 말 것 |
| `/Users/yohan/Documents/ChatGPT/ai-pixel-office/orbit-works-p2a4` | **최신 개발/운영 웹·Bridge·OMP 래퍼 작업 디렉터리**. 이후 문서에서 `CODE`라고 부름 |
| `/Users/yohan/Documents/ChatGPT/ai-pixel-office/orbit-works-p2a3` | Claude Hook이 참조하는 설치 checkout. detached HEAD **25c4f5b** 유지 |
| `orbit-works-p2a3/.git` | **두 checkout이 공유하는 Git 저장소 본체**. 이 폴더를 없애면 A4 worktree까지 손상됨 |
| `orbit-works-p2a3/dist/claude-forwarder.cjs` | 현재 사용자 Claude Hook의 실제 등록 대상. 예전 폴더처럼 보여도 이동/삭제/재빌드/경로 교체 금지 |
| `CODE/dist`, `CODE/node_modules`, `CODE/artifacts` | 빌드/의존성/로컬 증거. Git clone으로 자동 전달되지 않음 |

검증 코드 ca627c5를 포함하는 원격 브랜치는 확인 시점에 `origin/codex/p2-b4-omp-outbox`입니다. 원격 work/main을 갱신해 확인했으며 ca627c5는 두 브랜치에 병합되어 있지 않습니다. 기본 `work`/`main`에서 시작하면 최신 구현을 놓칩니다. 초기 참조의 `HANDOFF-P2-A3-MAC.md`는 현재 브랜치에 없을 수 있으며 이 문서가 후속 인수인계 기준입니다. 기본 브랜치에 merge했다고 가정하지 마세요. 이 작업에서 PR 생성/merge는 하지 않았습니다.

같은 Mac에서 먼저 할 일:

```sh
cd /Users/yohan/Documents/ChatGPT/ai-pixel-office/orbit-works-p2a4
pwd
git status --short --branch
git rev-parse HEAD
git rev-parse --git-common-dir
git worktree list
```

새 머신에서 소스만 받는 경우:

```sh
git clone --branch codex/p2-b4-omp-outbox https://github.com/choiyoh/ai-pixel-office.git orbit-works
```

clone에는 이 Mac의 설치/인증/사용자 설정/개인 ledger/Outbox/backup이 없습니다. 다른 머신에서 이 문서의 PID·절대경로를 그대로 적용하거나 운영 연결이 되어 있다고 가정하지 마세요. 인증정보를 복사해 달라고 채팅에 요청하지 않습니다.

## 4. 환경과 실행 버전

| 항목 | 확인값 |
| --- | --- |
| OS | Darwin24.6.0 / macOS15.7.7 / arm64 |
| 장비 | Apple M1 Max(이전 Mac 실환경 검사 기준) |
| Node | 기존 nvm **22.23.3**, `.nvmrc` 동일, package engines22 |
| Node 경로 | `/Users/yohan/.nvm/versions/node/v22.23.3/bin/node` |
| Claude Code | **2.1.299**, native ARM64 |
| OMP | **18.10.0**, `@oh-my-pi/pi-coding-agent`, 기존 Bun 설치 |
| OMP 실행 파일 | `~/.bun/bin/omp` → 기존 Bun global 패키지의 `dist/cli.js` |
| 실제 native 모델 메타데이터 | provider=`commandcode`, model=`deepseek/deepseek-v4.1-flash` |
| 시간대 | Asia/Seoul |

Node 전역 기본값이나 다른 도구의 Node를 바꾸지 말고 작업 명령에서만 기존 버전을 선택합니다.

```sh
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH"
node --version
omp --version
claude --version
```

**별도 Command Code CLI를 설치할 필요가 없습니다.** 초기 B.1 조사에서 독립 CLI를 찾지 못한 것은 사실이나, 이후 사용자가 “OMP로 구동”한다고 알려주었고 실제 OMP provider 경로를 확인했습니다. `doctor:command-code`가 독립 CLI 없음으로 나와도 현재 OMP 연결 실패라는 뜻은 아닙니다.

## 5. 현재 운영 서비스와 private state

| 서비스 | 마지막 확인 PID | 포트 | 실행 |
| --- | ---: | ---: | --- |
| 웹/Claude receiver | **57593** | **4173** | Node22 `server/app.mjs`, `ORBIT_MODE=claude-local` (2026-10-19 07:55 KST 재시작, ② 적용. 직전 29448) |
| OMP Provider Bridge | **90172** | **4183** | Node22 `scripts/provider-bridge.mjs` (2026-10-19 09:12 KST 재시작, ③ 적용. 직전 28881) |

(Bridge 설치 UUID `53efa927…`는 P2-B.4·B.5·B.6 재시작을 거쳐 유지됐고, Outbox binding·등록 토큰이 계속 일치합니다. PID는 재활용될 수 있으므로 문서 값만 보고 kill하지 않습니다.)

둘 다 `CODE`를 cwd로 가집니다. 프로세스는 이 작업에서 시작한 foreground 앱의 detached 자식이며 **로그인 자동 시작/상주 서비스 설치를 하지 않았습니다**. PID는 재활용될 수 있으므로 문서 값만 보고 kill하지 않습니다.

private root:

```text
/Users/yohan/Library/Application Support/Orbit Works
```

| 상대 경로 | 내용 |
| --- | --- |
| `runtime/receiver.json` | 웹 receiver의 PID/port/token — 공개 금지 |
| `live/claude-live.json` | Claude 설치 신원·records·generation·terminal·timeline |
| `provider-bridge-omp/runtime/omp.json` | Bridge 설치 UUID/PID/port/token — 공개 금지 |
| `provider-bridge-omp/ledger/provider-bridge.json` | OMP receipt/projection·session/execution·tool 상태 |
| `omp-outbox/binding.json` | 설치 UUID와 private HMAC 키 — 공개 금지 |
| `omp-outbox/run-0000` 등 | immutable canonical event 파일과 owner/complete 예약 |
| `backups/` | 사용자 설정·원래 ledger·token registry를 포함할 수 있는 private backup — 공개 금지 |

새 디렉터리는0700, 파일0600 또는 Windows의 동등한 private ACL을 사용합니다. 기존 public/손상 파일을 조용히 초기화하거나 권한을 덮어쓰지 않고 거부합니다.

최근 운영 적용 backup:

```text
/Users/yohan/Library/Application Support/Orbit Works/backups/p2b4-activate-20261018T112353Z
```

원래 위임 파일, 두 ledger, 이전 registry, preflight/restarted/activated manifest, 새 서버 시작 로그가 있습니다. 이를 Git/공개 첨부에 복사하지 마세요.

## 6. 첫 10분의 읽기 전용 점검

1. 이 문서와 Git 상태를 확인합니다. A3 설치 checkout이나 branch를 바꾸지 않습니다.
2. 아래 명령으로 실제 LISTEN/PID/cwd를 확인합니다.
3. 설정은 내용 덤프 대신 아래 fingerprint와 비교합니다. 불일치는 사용자의 후속 변경일 수 있으므로 자동 복원하지 않습니다.
4. HTTP snapshot과 파일 개수로 actor/pending을 확인합니다. 현재0이어야 한다는 가정으로 파일을 지우지 않습니다.
5. 활성 작업/새 변경이 있으면 실제 상태를 보고하고 존중합니다. 이 문서의 정적인0 값을 강제로 재현하지 않습니다.

```sh
lsof -nP -iTCP:4173 -sTCP:LISTEN
lsof -nP -iTCP:4183 -sTCP:LISTEN
ps -p 67963,67960 -o pid=,comm=,command=
lsof -a -p 67963,67960 -d cwd -Fn
```

같은 Mac의 안전한 snapshot 조회 예시(credential은 메모리에서만 사용, 출력은 제한된 숫자만):

```sh
node --input-type=module - <<'JS'
for (const [port, api] of [[4173, '/api/live/snapshot'], [4183, '/api/bridge/snapshot']]) {
  const base = `http://127.0.0.1:${port}`;
  const response = await fetch(base);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const data = await (await fetch(base + api, {headers: {cookie}})).json();
  console.log(JSON.stringify({port, source: data.source,
    active: data.actors.length, pending: data.pendingCount ?? null,
    terminals: data.terminalCount ?? null}));
}
JS
```

`npm run omp:replay`는 조회 전용이 아닙니다. pending 이벤트를 전송하고 ACK된 파일을 삭제할 수 있으므로 단순 인수 점검 목적으로 무심코 실행하지 않습니다. 현재 파일 개수만 확인하려면 `omp-outbox/run-*/*.event.json`을 세고 본문/키를 출력하지 않습니다.

## 7. 보호 파일 fingerprint

아래 값은 이 문서 작성 시점의 실제 SHA256입니다. 정상 후속 변경이 생기면 달라질 수 있습니다.

| 파일 | SHA256 |
| --- | --- |
| `~/.claude/settings.json` | `6c3f865652edf7bb9063d83c8a1af2a5daf16886f0cda8cfff6e0cc8c7701eb9` |
| `~/.claude/agents/omp-deepseek.md` | **`38ff6939a27bae1fdfb7db46339bd89f6f4b03421bf9ed120ac6a96e612480e8`** |
| `~/.omp/agent/config.yml` | `4247ffbae51837bf43365ca77106790b116d0fd20c0367961499a9e1948bf04b` |
| `~/.omp/agent/models.yml` | `953d38be0ff56910cc145cea511072eef748ec4b8a9829ed3d0233fc42a27263` |
| A3의 등록된 `dist/claude-forwarder.cjs` | `4a75342fed3b16087638a83adf45e761d51ef177cbd2ee79878992747b5dcbe5` |

Hook12종: Notification, PermissionRequest, PostToolUse, PreToolUse, SessionEnd, SessionStart, Stop, SubagentStop, PostToolUseFailure, SubagentStart, TeammateIdle, TaskCompleted. Orbit 등록은 각1개입니다. 다른 사용자 Hook도 보존합니다.

사용자 승인으로 실제 바꾼 전역 위임 정의의 이력:

1. bare `omp -p`를 Node22 + `scripts/observe-omp.mjs`로 교체.
2. 원래 파일 맨 앞의 LF 한 바이트 때문에 agent discovery가 실패해, 별도 승인 후 그 LF만 제거.
3. P2-B.4 승인 후 파일명 한 곳을 **`observe-omp-durable.mjs`**로 교체.

현재 접두사(추가 적용할 제안이 아니라 **이미 적용된 값**):

```sh
"/Users/yohan/.nvm/versions/node/v22.23.3/bin/node" "/Users/yohan/Documents/ChatGPT/ai-pixel-office/orbit-works-p2a4/scripts/observe-omp-durable.mjs" -- -p \
```

기존 모델 `deepseek/deepseek-v4.1-flash`, `--no-session`, `--no-extensions`, `--tools read,grep,glob`, `--max-time 10m`, prompt/stdin은 유지했습니다. 전역 agent는 Haiku/Bash 위임 정의이며, Haiku와 실제 OMP executor를 자동 상관관계로 결합하지 않습니다.

## 8. 완료 이력과 정확한 검증 범위

| 단계 | 핵심 완료 | 코드 기준 / 근거 |
| --- | --- | --- |
| P2-A.3 | 실제 Claude2세션·이벤트·종료·신원 지속 확인, 짧은 애니메이션과 종료 후 Resume 문제 발견 | 이전 handoff는 역사 자료. 최신 코드가 아님 |
| P2-A.4 | 750ms 시각 scheduler, native Claude 실행 증명, generation/tombstone, 실제 새 프로세스 `--resume` 두 번 | **25c4f5b7a94d86937d4513683efe578e8386285a**, [CI39030698255](https://github.com/choiyoh/ai-pixel-office/actions/runs/39030698255) |
| P2-B.1 | 별도 Provider Bridge, provider 인증/신원, durable receipt·reorder/dedup·terminal·role/delegation 계약 기반 | **f6562b32d266683d7c59d9bc5ff8c1b54757f39b**, [CI39035643861](https://github.com/choiyoh/ai-pixel-office/actions/runs/39035643861) |
| P2-B.2 | 실제 OMP18.10.0 JSON supervisor, Command Code→DeepSeek 확인, 전역 위임 연결 | **e7ccdb62c4a5abbc395aa2f43777b7ba15937108**, [CI39050396185](https://github.com/choiyoh/ai-pixel-office/actions/runs/39050396185) |
| P2-B.3 | Live OMP 채널·신원/좌석 분리·native Read 화면·offline/reconnect/Mock 복귀 | **4f07e4c9d212d10e4980b2c4a24e1f02e9565c24**, [CI39053766035](https://github.com/choiyoh/ai-pixel-office/actions/runs/39053766035) |
| P2-B.4 | private Outbox·별도 worker·receipt 확인 재전송·원래 관찰 시각 보존·운영 송신기 교체·두 서버 재시작 | **ca627c5631d28a73cf1d680dbd1e4358f68882c5**, [최종 CI39113460790](https://github.com/choiyoh/ai-pixel-office/actions/runs/39113460790) |
| P2-B.5 | 읽기 전용 Outbox status(보존 실행·여유·blocked·설치 불일치·last rejection)·recovery 힌트·archive 도구, 웹 서버 운영 적용 | **a02aca5**+**636df55**, [CI39132147816](https://github.com/choiyoh/ai-pixel-office/actions/runs/39132147816) |
| P2-B.6 ① | relay↔executor 실제 correlation: `parentExecution`(HMAC 실행 증명) 계약·Bridge ledger v3·웹 대조·UI 위임 출처, 두 서버 재시작 후 실제 위임 실증 | **f153a2d**+**0650e3f**, [CI39135067830](https://github.com/choiyoh/ai-pixel-office/actions/runs/39135067830) |
| P2-B.6 ② | 동시 provider scene: 읽기 전용 `/api/scene/snapshot` 통합 뷰(OMP engine key `+1_000_000`), 채널 하나 장애 시 다른 쪽 유지, 위임 링크·"대상 보기", 웹 재시작 후 실제 위임 실화면 실증 | **0fa83da**+**b67bd9d**, [CI39173148512](https://github.com/choiyoh/ai-pixel-office/actions/runs/39173148512) |
| P2-B.6 ③ | OMP Resume 계약(ephemeral/stored/explicit resume)·세션 신원 안정화(설치 단위 salt)·durable 큐 resume 수락(관찰된 세션만)·실제 edit 도구 실증: 같은 actor·세대 1→2, 실 OMP E2E + 운영 스택 실증 + 계약 테스트 4종 | **4d1a45d**+**f7f741b**+**b8e84a0**, [CI39181391934](https://github.com/choiyoh/ai-pixel-office/actions/runs/39181391934)·[39183152373](https://github.com/choiyoh/ai-pixel-office/actions/runs/39183152373) |
| P2-B.6 ④ | Windows 플랫폼 경로: `omp.exe`(bun 셰임) 설치·`omp/18.12.2` 실행·**셸 없는 3형태 스폰**·옵저버가 session.start/execution.end 관찰(macOS 대조 동일), 래퍼 수정 불필요. 실 모델 왕복은 자격증명 경계 | **1159259**, [CI39186534438](https://github.com/choiyoh/ai-pixel-office/actions/runs/39186534438) |

P2-A.4의 실제 Mac PASS: ANIMATION_PASS, SESSION_RESUME_PASS, MAC_LIVE_PASS, CROSS_PLATFORM_CI_PASS. 실제 Claude Read/Edit와 generation1→2→3·좌석 유지·새로고침·서버 재시작·별도 독립 세션을 확인했습니다.

**범위 제한:** Claude Resume PASS는 **새 native 프로세스의 `--resume`**입니다. 동일 프로세스 interactive `/resume`은 근거가 부족해 지원하지 않습니다. Mac 생성 표식이 초 단위여서 종료와 같은 초의 재실행도 모호하면 거부합니다. 실제 관찰한 source는 startup/resume, end reason은 other입니다. clear/compact/fork 및 다른 reason은 계약/자동화 검사와 실제 interactive 검증을 구분해야 합니다.

P2-B 실제 Mac 검사는 OMP/DeepSeek **Read**를 검증했습니다. P2-B.6 ①에서는 실제 Claude Code 위임에서 Claude 조상 실행 증명이 OMP session.start에 부착되고, 웹 서버의 HMAC 대조로 OMP actor에 위임 출처가 표시되는 것까지 실화면으로 확인했습니다. OMP의 실제 Edit/Resume, Windows/Linux의 실제 Claude/OMP 인증·모델 실행을 검증했다고 주장하지 않습니다. CI는 그런 native 모델 실행 대신 합성 자식/fixture를 사용합니다.

## 9. 데이터 경로와 파일 지도

### 9.1 Claude

등록된 A3 `dist/claude-forwarder.cjs` → 웹4173 `/api/hooks/claude` → `server/receiver.mjs`/`server/live-projection.mjs` → `/api/live/snapshot`, `/api/live/events` → Claude Live 채널.

- `scripts/claude-forwarder.mjs`, `server/claude-worker.ts`, `platform/claude-execution.mjs`: 원본 Hook을 안전한 enum/실행 증거로 축약.
- PID와 생성 표식을 OS에서 재확인하고 현재 설치 PATH의 native Claude 링크 대상 파일명을 검증. 임의 버전명 허용 금지.
- native 논리 신원과 실제 실행 generation 구분. 명시적 resume + 새 검증 실행 + 마지막 종료 뒤 생성된 근거가 있어야 재등장.
- actorId/renderId/palette/좌석 선호 보존. 이전 generation/실행/tombstone은 현재 회차를 부활시키지 않음.
- compact는 활성 동일 실행 관찰이며 generation을 늘리지 않음. clear/fork는 새 native ID가 필요하고 종료 ID의 부활 근거가 아님.
- **Claude Hook sender에는 OMP Outbox를 추가한 것이 아닙니다.** Claude의 최초 유실/eventId/producer replay까지 해결됐다고 확대하지 않습니다.

### 9.2 OMP와 Outbox

전역 `omp-deepseek` → `scripts/observe-omp-durable.mjs` → `platform/observe-omp.mjs`가 소유 OMP 자식을 관찰 → `platform/omp-outbox.mjs`에 canonical event fsync → 별도 `scripts/replay-omp-outbox.mjs` → `platform/omp-outbox-transport.mjs` → Bridge4183.

| 파일 | 역할 |
| --- | --- |
| `server/bridge/omp.mjs` | native model enum·tool 분류·실제 자식 close를 canonical 이벤트로 변환 |
| `server/bridge/schema.mjs` | 허용된 종류/도구/UUID/role/필드만 받는 계약 |
| `server/bridge/ledger.mjs` | provider/installation 신원, execution/sequence/receipt/digest, terminal, role/delegation 기반 |
| `server/bridge/app.mjs` | per-provider Bearer 인증, batch, loopback/Origin/body/cookie 보호 |
| `scripts/provider-bridge.mjs` | **명시적** OMP provider / live source /4183 /별도 namespace 시작 |
| `platform/omp-outbox.mjs` | binding/HMAC, immutable fsynced queue, ACK 확인 후 삭제, 상한 |
| `platform/omp-outbox-transport.mjs` | fresh registry 조회, token은 메모리에만, batch/retry용 전송 |
| `platform/bridge-transport.mjs` | 이전 non-durable 경로. 운영 새 경로로 혼동하지 말 것 |
| `scripts/observe-omp.mjs` | 이전 wrapper. 현재 전역 위임의 진입점이 아님 |

native `session`→session.start, `tool_execution_start/end`→tool.start/end, `agent_end`→**turn.end**, 소유 자식의 실제 close→execution.end입니다. **agent_end/Stop을 프로세스 종료로 처리하면 안 됩니다.** exit0도 업무 성공 전체의 증거가 아닙니다.

Read/Grep/Glob은 read, Edit/Write/Bash는 edit/write/shell, 그 외 other로 분류합니다. 실제 tool call ID에는 `|` 등이 있어 printable ASCII1~512자를 받아 HMAC합니다. 예전 `[A-Za-z0-9_.:-]` 식으로 되돌리면 실제 이벤트가 다시 거부됩니다.

### 9.3 화면

웹4173 `/api/omp/snapshot` → `platform/omp-office-reader.mjs`의 같은 호스트 Bridge read-only proxy → `server/bridge/office-projection.mjs` allowlist → `src/live/store.ts`/`useLiveOffice.ts`/`LiveOffice.tsx` → 기존 Pixel Agents 엔진.

- Browser로 registry/token/원본 응답을 보내지 않음. Office cookie + loopback/Origin 보호.
- actor는 Claude/OMP provider namespace와 installation UUID를 검증. fixture/live 혼합 거부.
- 채널별 scene 재생성으로 동번호 renderId 충돌을 피함. 동시에 두 provider를 같은 scene에 합친 것이 아님.
- 좌석은 installation+actor별 `orbit.live.seats.v1.*`, 선택 채널은 `orbit.live.channel.v1`, Mock 좌석은 별도.
- 최초 snapshot/채널·epoch 전환/재연결/Mock 복귀는 baseline만 취해 과거 동작을 재생하지 않음.
- Bridge가 한 번 연결된 후 중단되면 actor를 offline으로 보존. 연결 실패를 SessionEnd로 만들지 않음.
- `vendor/pixel-agents`의 기존 Renderer·Animation 엔진 재사용. vendor381파일 고정 commit **d1e007a9fdf3003c252d2973abe1999ae59aec33** 보존.

## 10. 애니메이션·시각·업무 상태의 불변 조건

- `src/live/animation-scheduler.ts`: 정책값 **750ms**, 실제 관찰한 Read/Grep/Glob 및 Edit/Write 동작만 짧게 유지.
- 실제 tool.end는 즉시 between-tools/실패 상태. 화면의 실행 중 수치를 애니메이션 때문에 유지하지 않음.
- 최신 도구 우선, 누적 replay queue 없음. 종료·실패·승인·입력 대기·unknown·offline·hidden 탭이 우선.
- 정상 수신에서도 **2.5초 지난 관찰은 새 연출하지 않음**. actor freshness는 약30초 stale/120초 offline 또는 restored/quality 저하로 중지.
- OMP의 원래 `occurredAt`/`lastObservedAt`을 보존. 재전송 도착 시각을 새 활동 시각으로 바꾸지 않음.
- 실제 수신 시각은 별도 `receivedAt`. 과거 ledger에서 관찰 시각을 알 수 없으면 restored/stale.
- UI의 “LIVE / 미검증” 등 기존 문구는 포괄적인 실제 환경 인증 플래그가 아님. 실제 검사 보고서의 범위와 구분하며 임의로 전체 PASS 배지를 붙이지 않음.

## 11. Outbox의 정확한 보장과 상한

### 의미

1. native 관찰을 canonical enum/opaque ID로 축약. session ID는 실행별 HMAC, 도구 ID는 private 설치 키 HMAC.
2. 같은 private 부모에 완전한 JSON→fsync→atomic hardlink publish→POSIX directory fsync. 기존 event를 덮어쓰지 않음.
3. **queued는 로컬 내구 기록**, Bridge committed나 업무 성공이 아님. `durablyQueued`와 `sent`를 구분.
4. eventId/sequence/원래 시각은 한 번 만들고 재시도에서 그대로 유지.
5. committed receipt의 eventId/nextSequence/revision까지 확인한 파일만 삭제. buffered/비정상 ACK/손상/설치 변경은 보존.
6. 여러 worker의 같은 event 재전송은 receiver digest/dedup로 처리. `delivered`는 그 worker의 ACK 확인 수이며 전역 신규 이벤트 수가 아님. `duplicateReceipts` 별도.
7. batch는 **파일시스템 전체 원자 transaction이 아님**. crash/중간 오류는 committed prefix를 남길 수 있으며 원래 ID 재시도로 복구.
8. 업무 stdin/stdout과 replay worker를 분리. 내구 스풀 I/O 자체의 비용이0이란 뜻은 아니지만 네트워크 복구를 업무 응답이 기다리지는 않음.

| 항목 | 현재 상한/정책 |
| --- | --- |
| 설치별 Outbox 예약 | **1024회**. 성공·실패 뒤에도 자동 재사용하지 않음 |
| 실행별 canonical event | **128개** |
| event 파일 | **2KiB**. payload 이론상256MiB, 파일시스템 할당/metadata 별도 |
| sender/worker | 실패 시 약1→2→4→8→15초 간격, 종료 시 마지막 worker |
| 한 batch | producer8개, HTTP 서버 허용64개/기존 body64KiB |
| worker 예산 | 기본30초/256 receipt, 작업 사이에 확인. OS ACL timeout 별도 |
| batch HTTP | 10초, 응답32KiB. 기존 단건 송신1.2초 유지 |
| Bridge | execution1000, active actor100, receipt4096, pending256/실행당32 |
| Bridge 추가 | active tool64/closed tool1024, generation64, timeline128, state2MiB |
| UI timeline | 최근100개. 전체 원본 업무 journal이 아님 |

owner/complete 예약을 자동 재사용하지 않는 것은 늦은 worker ACK가 새 producer 파일을 지우는 경합을 막기 위한 선택입니다. 예약이 가득 차면 pending0이어도 유지보수가 필요합니다. **기록/키를 지워 상한을 우회하지 마세요.** pending0, producer/worker 종료, receipt/state 정합성을 확인한 private archive/복구 절차가 필요하며 그 운영 도구는 아직 없습니다.

binding을 등록한 적이 없고 Bridge도 없으면 설치 UUID를 추측하지 않습니다. 관찰 불가를 알리고 업무만 계속합니다. 다른 installation UUID를 만나도 queue를 새 설치로 옮기지 않습니다.

## 12. 복구·기동 명령과 재시작 주의

업무 producer가 모두 종료된 뒤 Bridge가 복구되면 상주 worker가 없을 수 있습니다. **자동 복구 daemon/로그인 자동 시작/Bridge 시작 시 자동 drain은 구현하지 않았습니다.** 그런 경우:

```sh
cd /Users/yohan/Documents/ChatGPT/ai-pixel-office/orbit-works-p2a4
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH"
npm run omp:replay
```

- 종료0: 해당 scan에 pending/오류/예약 소진 없음.
- 종료2: 손상/설치 불일치/예약 소진 등 검토 필요. 파일/키를 지우지 말 것.
- 종료3: pending/일시 불가/수신 거부가 남음. 원본을 보존한 채 원인 확인.
- `offline`, `rejected`, `lastStatus`, `blockedRuns`, `retainedRuns`, `capacityRemaining`을 구분.
- 격리 namespace: `npm run omp:replay -- --state-dir /absolute/test-state`.

**서버가 실제로 없고 시작 승인을 받은 경우에만**, 서로 다른 터미널에서:

```sh
# CODE에서, Node22를 선택한 뒤: Bridge
npm run bridge:start
```

```sh
# CODE에서, Node22를 선택한 뒤: 웹+Claude receiver
ORBIT_MODE=claude-local npm start
```

`npm start`만 실행하면 기본 mock 모드가 될 수 있습니다. 이미 떠 있는 서버를 중복 실행하지 않습니다. 실제 LISTEN 확인에는 `lsof`를 사용합니다. 종료 직후 단순 socket bind 사전검사는 TIME_WAIT를 점유로 오판할 수 있었습니다. 그 경우 기존 프로세스를 찾아 죽이지 말고 실제 listener와 registry를 확인합니다.

재시작/rollback 시:

1. 승인, 활성 actor, PID/command/cwd/registry hash를 재확인.
2. 사용자 파일·두 ledger·runtime registry를 private backup하고 hash 검증.
3. 정확히 확인한 owned PID에 SIGTERM, 종료/자기 registry 제거 확인. 임의 다른 PID 종료 금지.
4. 새 웹과 Bridge의 **batch + 관찰 시각 계약**을 함께 갱신.
5. 이전 설치 UUID·salt·identity·terminal·receipt 보존 확인 후 전역 위임 검증.

새 ledger optional 필드를 구버전 strict validator가 거부할 수 있습니다. 코드만 과거 버전으로 바꾸는 자동 downgrade는 하지 않습니다. 오래된 backup을 복원해 최신 receipt/terminal을 잃으면 replay 정합성도 깨질 수 있습니다. 무조건 backup 복사/ledger 삭제로 해결하지 마세요.

## 13. 테스트와 CI 실행 방법

같은 Mac의 의존성은 설치돼 있습니다. 소스 변경이 없는 인수 점검에 전체 설치/빌드/실제 API 작업을 반복할 필요는 없습니다. 새로운 clone에서만 필요에 따라:

```sh
npm ci --no-audit --no-fund
npm run setup
```

`setup`은 Node22 확인·고정 vendor의 로컬 의존성 설치입니다. 사용자 Hook/전역 패키지를 설치하는 명령은 아니지만 기존 실행 환경에서 불필요하게 반복하지 않습니다.

코드 변경 후 해당 범위와 CI 계약에 맞게 실행:

```sh
npm run check:source
npm run verify:vendor
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
npm run test:smoke
npm run test:upstream
```

브라우저(Chromium 설치가 새로 필요하면 먼저 확인):

```sh
npm run test:browser
npm run test:connection-browser
npm run test:live-browser
npm run test:p2a4-browser
npm run test:omp-office-browser
npm run test:omp-outbox-browser
npm run test:scene-browser
```

최종 코드 ca627c5의 로컬 결과: **단위31 pass, Mac 통합40 pass/Windows 전용4 skip**. 신규 Outbox 통합8개 포함. 최종 세 OS CI 전체 성공. P2-B.6 ② 기준 로컬 결과: **단위32 pass, 통합59 pass/Windows 전용4 skip**, 브라우저7종 통과(신규 `test:scene-browser`). P2-B.6 ③ 기준 로컬 결과: **단위32 pass, 통합63 pass/Windows 전용4 skip**, 브라우저7종 통과(신규 계약 테스트 4종·`scripts/omp-resume-e2e.mjs`). 운영 스택 실증: Bridge 원장에서 같은 세션(02d3449b80)·같은 actor(cbe7b6b1)가 generation 1→2로 이어지고 replay가 `delivered:5, pending:0`을 보고했습니다. `tests/omp-*`는 합성 자식/fixture를 사용하므로 이 결과를 Windows/Linux native 모델 연결 PASS로 읽지 않습니다.

워크플로: `.github/workflows/cross-platform.yml`. main/work push와 PR, workflow_dispatch에 반응합니다. codex 브랜치의 일반 push만으로 실행됐다고 가정하지 마세요.

```sh
gh workflow run cross-platform.yml --ref codex/p2-b4-omp-outbox
gh run view 39113460790 --json headSha,status,conclusion,jobs
```

새 코드 SHA를 검증할 때에는 그 SHA의 run인지 확인합니다. 문서만 고친 이번 인수인계는 코드 CI를 다시 돌릴 이유가 아닙니다.

## 14. 실제 검증 증거와 로컬 보고서

### Git으로 전달되는 근거

- [현재 상태/해시/검증 범위 요약 JSON](handoff/p2-b4-mac-status.json)
- [운영 적용 증거 JSON](handoff/p2-b4-production-activation.json)
- [실제 offline OMP→복구 검사 JSON](handoff/p2-b4-offline-validation.json)
- [실제 내구 송신기 화면](images/p2-b4-mac-read.png)
- [실제 약2MB 짧은 녹화](videos/p2-b4-mac-read.webm)
- [P2-B.4 최종 코드 CI](https://github.com/choiyoh/ai-pixel-office/actions/runs/39113460790)
- [P2-B.5 코드 CI](https://github.com/choiyoh/ai-pixel-office/actions/runs/39132147816) · [P2-B.6 ① 코드 CI](https://github.com/choiyoh/ai-pixel-office/actions/runs/39135067830) · [P2-B.6 ② 코드 CI](https://github.com/choiyoh/ai-pixel-office/actions/runs/39173148512)
- P2-B.6 ② 운영 실증(2026-10-19 07:55 KST): 웹 4173만 재시작(29448 → 57593), 신규 `/api/scene/snapshot` 무쿠키401·세션200, 두 provider ready. 실제 위임 1회에서 통합 뷰에 **Claude · 020**(engine key 20)과 **OMP · 011**(engine key 1000011)이 동시 표시되고, 카드 `← Claude · 020` · 인스펙터 `위임 출처 / Claude · 020 · 실행 증명 일치` · "대상 보기" 클릭 시 Claude actor로 선택 이동 확인. 산출물 `artifacts/scene-live-unified.png`.
- P2-B.6 ① 운영 실증(2026-10-18): Bridge ledger v2→v3, 실제 위임 2회에서 OMP actor에 `delegatedBy = Claude · 017` · `Claude · 019`(HMAC 대조 일치) 표시. 실화면에서 카드 `← Claude · 019` · 인스펙터 `위임 출처 / Claude · 019 · 실행 증명 일치` 확인. 실행 후 outbox pending0 · blocked0 · lastRejection null. 재현 절차는 `docs/P2-B.6-RELAY-EXECUTOR-CORRELATION.md` 4.2.

두 차례 전역 Claude 위임에서 새 durable wrapper, OMP/Command Code/DeepSeek Read, 반환 결과, native exit0, event5개씩, pending0을 확인했습니다. 두 번째 실행의 실제 Read 연출 약**731ms**(정책750ms), 도구 종료 상태와 working0 동시 표시, native 종료 후 제거를 확인했습니다.

P2-B.4 적용 시 활성 actor0을 확인하고 두 서버를 승인 후 정상 종료·재시작했습니다. **재시작 직후 두 ledger는 backup과 byte 동일**했고, 새 검사 실행 뒤에도 기존 Claude records와 Bridge executions/sessions/deliveries의 원래 항목을 보존했습니다. 현재 운영 Bridge는 검증 포함7 execution 모두 terminal입니다.

스크린샷에는 안전한 별칭과 허용된 상태/모델 enum만 있고 prompt/경로/credential은 없습니다. private runtime/backup/binding은 증거 묶음에 포함하지 않습니다.

### 이 Mac에만 있는 상세 자료

상위 폴더의 보고서와 `CODE/artifacts`는 대부분 Git에 없습니다. 다른 에이전트가 같은 Mac을 사용하면 읽을 수 있으나, clone만 하면 생기지 않습니다.

```text
/Users/yohan/Documents/ChatGPT/ai-pixel-office/
  MAC-P2-A4-FINAL-REPORT.md
  P2-B1-REPORT.md
  P2-B2-ACTIVATION-REPORT.md
  P2-B3-REPORT.md
  P2-B4-REPORT.md
  P2-B4-ACTIVATION-REPORT.md     ← 최신 운영 적용 상세 보고
```

`CODE/artifacts`의 주요 파일:

- `p2a4-mac-live-result.json`, `p2a4-mac-live-12s.mp4`
- `omp-outbox-real-validation.json`: 실제 OMP를 임시 서버 중단 상태에서 실행,5개 보존 후 recovery/pending0, 완료 실행 재등장 없음
- `omp-outbox-global-delegation.json`: 실제 현재 전역 agent 정의의 위임 결과
- `omp-outbox-active-browser.json`, `omp-outbox-active-live.webm`: 실제 운영 Read 화면/프레임
- `omp-outbox-production-activation.json`: 적용/역사 기록 보존 증거
- `omp-outbox-activation-path.txt`: private backup 위치만 가리킴

초기 파일/스크립트는 이전 sender hash나 단계 조건을 가정할 수 있습니다. artifact 검증기를 현재 전역 환경에 무심코 재실행하지 말고 source·baseline·수행 범위를 먼저 읽으세요.

## 15. 남은 일과 다음 권장 범위 — 아직 구현하지 않음

우선순위는 다음 작업 요청을 받은 뒤 확정하세요. 이 인수인계서만 읽고 자동 배포하지 않습니다.

### 완료됨: P2-B.5 운영 관찰/복구 편의

읽기 전용 Outbox status(보존 실행·여유·blocked·설치 불일치·last rejection)·bounded recovery 힌트·archive 도구가 코드·격리 검증·문서·**운영 웹 서버 적용**까지 완료됐습니다. 설계·보장 범위는 `docs/P2-B.5-OMP-OUTBOX-OPERATIONS.md`가 최신입니다. 상주 daemon/로그인 자동 시작은 설치하지 않았습니다.

### 완료됨: P2-B.6 ① 실제 relay/executor correlation

Claude 조상 실행 증명(pid/birth)을 OMP `session.start`에 부착하고, 웹 서버가 두 채널 공통 HMAC으로 대조해 일치할 때만 위임 출처를 표시합니다. Bridge ledger v3, 운영 적용·실제 위임 실증까지 완료했습니다. `docs/P2-B.6-RELAY-EXECUTOR-CORRELATION.md`가 최신입니다.

### 완료됨: P2-B.6 ② 동시 provider scene

읽기 전용 `/api/scene/snapshot`이 두 채널을 합쳐 **한 scene에 동시 표시**합니다(OMP engine key `+1_000_000` 네임스페이스, Bridge ledger 계약 무변경). 설계·구현·격리 검증·CI·운영 적용·실위임 실화면 실증까지 완료했고 `docs/P2-B.6-SCENE-INTEGRATION-DESIGN.md`가 최신입니다. 표시 이름·palette·좌석은 채널 원본을 유지하고, 업무 단위 중복 제거(두 actor 합치기)는 비목표로 남겨 둡니다.

### 완료됨: OMP Resume 지원과 실제 Edit 검증 (코드·격리)

관찰 래퍼가 **ephemeral fresh / stored fresh / explicit resume** 세 형태를 받고, resume 실행이 `startSource: "resume"`으로 ledger에 도달합니다. native 세션 신원 해시 키를 설치 단위 salt로 안정화해 같은 세션이 **같은 actor·세대 +1**로 이어지며(원본 native id는 계속 미전송), durable 큐도 **관찰된 세션의 resume**만 수락합니다. 실제 edit 도구 동작과 운영 스택(Bridge 4183) resume 실증까지 완료했습니다(세대 1→2, 같은 세션·같은 actor). 세부는 `docs/P2-B.6-OMP-RESUME-AND-EDIT.md`. Bridge는 2026-10-19 09:12 KST에 재시작해 ③을 적용했고(90172), 이후 outbox 수정은 클라이언트 경로라 재시작이 필요 없습니다.

### ④ Windows native 실행 — 플랫폼 경로 검증 완료, 실 모델 왕복만 남음

`docs/P2-B.6-WINDOWS-NATIVE.md`에 실측 근거를 정리했습니다(run [39186534438](https://github.com/choiyoh/ai-pixel-office/actions/runs/39186534438)).

- Windows에서 OMP는 **`omp.exe`(bun 셰임)** + `cli.js`로 설치되고 `omp/18.12.2`가 실행됩니다.
- 관찰 래퍼가 **셸 없이 3형태 모두 스폰**합니다(PATH · 절대 경로 `omp.exe` · `bun.exe`+`cli.js`) → 옵저버의 "셸 폴백 금지" 규칙과 충돌하지 않아 **래퍼 수정이 불필요**했습니다.
- 옵저버가 `session.start` → `execution.end`를 관찰합니다(macOS 대조군과 동일). `execution.end`는 자격증명 부재로 턴 시작 전 종료한 결과이며 오류가 아닙니다.
- **남은 것**: Windows에서의 실 모델 왕복. 러너에 Command Code 자격증명이 없어 `No API key found`로 끝납니다. 키 등록(CI secret)은 저장소 소유자 결정이며 이 저장소는 키를 커밋하지 않습니다. 리눅스는 사용자 지시로 우선순위가 아닙니다(매트릭스에 `ubuntu-latest` 한 줄로 재현 가능).
- 세션 import/extension/profile은 계속 미지원(거부)이며, 운영 위임 정의는 여전히 ephemeral(`--no-session`)입니다.

## 16. 다음 에이전트가 피해야 할 실수

- 기본 work/main이나 상위 빈 폴더에서 최신 소스라고 가정하기.
- A3 checkout을 “오래된 결과물”로 지우거나 A4를 임의 이동해 전역 절대경로를 깨뜨리기.
- P2-B.4의 예전 미적용 Diff를 다시 적용/원복하거나 Hook을 중복 설치하기.
- native `agent_end`/Claude Stop을 execution.end/업무 완료로 취급하기.
- queued ack를 Bridge committed/사업적 성공으로 집계하기.
- replay 때 eventId/sequence/시각을 새로 만들어 duplicate 억제를 깨뜨리기.
- raw tool ID의 `|`를 거부하거나 원문 tool args/results를 저장하기.
- 서버 장애를 session 종료로 바꾸거나 오래된 작업을 새 working 애니메이션으로 만들기.
- 예약1024/receipt4096 등 상한을 초기화·삭제로 숨기기.
- token/key/salt/private backup을 handoff/evidence/Git에 넣기.
- 다른 사용자/세션의 서버를 PID 숫자나 포트만 보고 종료하기.
- 새 code SHA가 아닌 예전 CI 성공을 최신 변경의 PASS로 보고하기.

## 17. 새 에이전트에게 그대로 전달할 시작 지시

> Orbit Works의 인수인계서 `docs/HANDOFF-P2-B4-MAC.md`를 먼저 읽어 주세요. 최신 브랜치는 `codex/p2-b6-relay-executor-correlation`, 검증 코드 기준은 `4d1a45d` + `f7f741b` + `b8e84a0`(③)와 그 이전 `0fa83da` + `b67bd9d`(②)·`f153a2d`(①)입니다. P2-B.4 내구 송신기, P2-B.5 Outbox 관찰/복구, P2-B.6 ① relay↔executor correlation, ② 동시 provider scene 운영 적용, ③ OMP Resume·실제 Edit 검증(운영 적용 포함)은 이미 완료됐습니다. 같은 Mac이면 `orbit-works-p2a4`에서 읽기 전용으로 현재 Git·프로세스·설정 fingerprint·actor/pending 상태를 재확인하고, 기존 Hook/OMP 환경과 A3 설치 checkout을 유지해 주세요. 이전 문서의 미적용 계획을 재실행하지 마세요. 다음 작업은 사용자가 지정하는 범위로 진행하며, 새 sender/설정 변경은 구현·격리 검증·정확한 Diff를 먼저 준비한 뒤 별도 승인받아 적용하세요. 한국어 존댓말을 사용하고 실제 검증된 범위에만 PASS를 부여해 주세요.
