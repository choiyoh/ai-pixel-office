# Orbit Works — P2-A.3 Mac 실환경 검증 인수인계서

이 문서는 새 Mac 원격 작업 세션에 전달할 지시서다. 문서 작성 시점에는 Linux 클라우드에서만 환경을 확인했고, 실제 Mac 설치·Hook Dry-run·Claude 연결은 수행하지 않았다. **원격 접속 자체는 Claude 설정/Hook 변경 승인이 아니다.**

## 1. 대상과 현재 상태

| 항목 | 확정 내용 |
|---|---|
| 저장소 / 브랜치 | `https://github.com/choiyoh/ai-pixel-office.git` / `work` |
| 검증 기준 SHA | `71ac11650a23035bf13f8b8a6bdfe4f637629d01` |
| 대상 실기 | 사용자 MacBook Pro M1 Max / macOS Apple Silicon |
| 프로젝트 Node | `.nvmrc` = `22.23.3`, Node 22 LTS |
| 완료 범위 | P2-A.2 합성 Live Canvas, 원본 엔진/Provider 보존 |
| 실제 Claude 연결 | 미검증 |
| 이번 세션의 첫 종료 지점 | Mac 설치·Mock 확인·실제 Hook Dry-run·승인 자료 제출 후 중단 |
| 제외 범위 | P2-B Command Code/DeepSeek, Hermes, 외부 공개/원격 배포 |

기준 커밋의 전체 CI: https://github.com/choiyoh/ai-pixel-office/actions/runs/38906665253

| CI 환경 / Node 22.23.3 | 단위 | 통합 | 원본 | 전체 |
|---|---:|---:|---:|---|
| Windows x64 | 18 통과 | 11 통과 | 635 통과·기존 POSIX 전용8 skip | 성공 |
| macOS ARM64 | 18 통과 | 7 통과·Windows 전용4 skip | 643 통과 | 성공 |
| Linux x64 | 18 통과 | 7 통과·Windows 전용4 skip | 643 통과 | 성공 |

이 CI는 사용자의 Mac/실제 Claude 실행 검증을 대신하지 않는다. 마지막 클라우드 확인은 `Linux`, `linux/x64`, HEAD=위 SHA, 작업 트리 변경 없음이었다. Mac에 접근했다고 가정해 실환경 작업을 진행하지 않았다.

## 2. 먼저 읽을 문서

기준 커밋 checkout에서 다음을 읽는다.

1. `docs/P2-A.2-IMPLEMENTATION.md`
2. `docs/P2-A.3-VALIDATION-PLAN.md`
3. `docs/install/macos.md`

현재 인수인계서가 기준 커밋에 없으면 전달받은 파일을 별도로 읽는다. 이 문서의 절차는 실행 결과가 아니다.

## 3. 환경 게이트 — 설치보다 먼저

원격 IDE의 터미널이 실제로 어느 머신에서 실행되는지 확인한다. IDE 화면/접속 이름만으로 판정하지 않는다.

```sh
uname -s
uname -m
node --version
node -p 'process.platform + "/" + process.arch'
```

- 실제 macOS가 아니면 **BLOCKED로 보고하고 중단**한다. 클라우드 Linux에서 Mac의 localhost/설정/프로세스를 조작할 수 있다고 가정하지 않는다.
- 대상 기대값은 `Darwin`, `arm64`, `darwin/arm64`다. M1에서 `darwin/x64`이면 Rosetta/Node 실행 환경을 확인하고 native arm64 선택 방안을 먼저 보고한다.
- Node가 없거나 22가 아니면 기존 전역 Node를 교체하거나 전역 패키지를 설치하지 않는다. 기존 버전 관리 도구 사용 여부와 프로젝트용 Node 22.23.3 arm64 준비 방안을 보고한다. 임의로 Homebrew/nvm 설치·업데이트나 shell profile 수정을 하지 않는다.

## 4. 독립 checkout과 설치

사용자가 선택한 지속 가능한 작업 폴더에서 실행한다. 기존 프로젝트를 재사용·덮어쓰지 않는다. 이미 같은 이름이 있으면 새 디렉터리 이름을 선택한다. Hook은 절대경로를 사용하므로 나중에 삭제될 임시 폴더에 설치 경로를 두지 않는다.

```sh
git clone --branch work https://github.com/choiyoh/ai-pixel-office.git orbit-works-p2a3
cd orbit-works-p2a3
git checkout --detach 71ac11650a23035bf13f8b8a6bdfe4f637629d01
git rev-parse HEAD
git status --short

node --version
node -p 'process.platform + "/" + process.arch'
npm ci --no-audit --no-fund
npm run setup
npm run build
npm run doctor
```

각 명령의 성공/실패와 실제 버전을 기록한다. 실패한 명령을 무시하고 다음 단계가 성공했다고 보고하지 않는다. `doctor`의 CLI 존재 여부는 로그인/인증 성공을 의미하지 않는다. 출력에는 개인 경로가 포함될 수 있으므로 공개 로그/GitHub에 그대로 올리지 않는다.

선택한 실제 작업 폴더, Node 실행 파일, sender 경로를 로컬에서 확인한다. 보고용 사본은 `<CHECKOUT>`, `<NODE22>`, `$HOME` 등의 별칭으로 개인 부분을 가린다. Hook 적용에 사용할 실제 경로는 대상 Mac에서만 검토한다.

## 5. 기본 Mock 실행

```sh
npm start
```

Mac 자신의 브라우저에서 `http://127.0.0.1:4173`에 접속한다. 다음을 확인하고 민감정보가 없는 화면만 저장한다.

- MOCK SANDBOX의 캐릭터6명, 이동/애니메이션, 상태 시연, 확대·축소.
- LIVE OFFICE 선택 시 아직 수집기가 없으므로 연결 준비 필요/캐릭터0명.
- Mock과 Live 집계가 섞이지 않음.

자신이 실행한 서버를 해당 터미널의 Ctrl+C로 정상 종료한다. 포트가 사용 중이면 기존 프로세스의 주체를 확인하며 임의로 종료하지 않는다.

필요한 회귀 검사:

```sh
npm test
npm run test:integration
npm run test:smoke
```

`npm run test:live-browser`는 추가 합성 검증이며 실제 Claude 연결 증거가 아니다. 실행하려면 프로젝트 Playwright Chromium이 필요하다. 없으면 `npx playwright install chromium`을 사용하며 시스템/전역 패키지 설치로 확대하지 않는다.

## 6. 실제 설정의 읽기 전용 조사와 Dry-run

다음 사용자 환경을 보호한다: Claude Code CLI, Command Code+DeepSeek, deepseek-analyst/deepseek-dev 위임, OMP, Hermes. 해당 설정·인증정보·위임 스크립트를 변경하거나 초기화하지 않는다.

1. 실제 `CLAUDE_CONFIG_DIR` 설정 여부와 Claude 실행 scope를 확인한다. 없으면 기본 `~/.claude/settings.json`이다. 사용자/프로젝트/local 설정 등 실제 Claude가 로드하는 범위와 기존 Hooks의 중복 가능성도 읽기 전용으로 조사한다. 현재 planner는 선택된 사용자 설정 파일 하나를 대상으로 하므로 모든 scope 충돌을 자동 보장하지 않는다.
2. 대상 파일 존재, 일반 파일 여부/symlink, 권한, SHA256, JSON/Hook 구조를 확인한다. 전체 settings, 환경 변수 값, 인증정보, 원본 command/matcher를 공개 출력하지 않는다. 기존 Hook 보고는 이벤트명·개수·유형·충돌 판단 위주로 하고 민감한 command는 가린다.
3. 실제 Mac의 Node와 빌드된 `dist/claude-forwarder.cjs`가 존재하는지 확인한다.
4. 아래 읽기 전용 계획을 실행한다.

```sh
npm run hooks:plan -- --context=posix
```

`dryRun=true`, `writesPerformed=0`을 확인한다. 실행 전후 settings의 SHA256/권한이 같은지도 대조한다. 파일이 원래 없었다면 생성되지 않았는지 확인한다. 출력의 원래 설정값은 가려지지만 경로는 남을 수 있으므로 공개 공유 전 추가로 가린다.

planner는 설정을 적용하거나 backup을 생성하지 않는다. JSON 오류·symlink·다른 Orbit sender 경로/중복 충돌을 거부하면 원인을 보고하고 임의로 수정하지 않는다. Claude 인증 상태는 기존 사용자 흐름으로 확인하며 재로그인/인증 초기화는 하지 않는다.

## 7. 필수 승인 자료 — 제출 후 반드시 중단

다음을 실제 Mac 조사 결과로 채운다. 예제/클라우드 값으로 대신하지 않는다.

- OS/arch, Node 버전, checkout SHA, Mock 실행 결과.
- 실제 적용할 설정 scope와 대상 파일의 안전한 별칭.
- 기존 Hook 이벤트·개수·유형, OMP/위임 Hook과의 충돌 가능성.
- 실제 Node/sender 경로의 로컬 확인 결과와 보고용 경로 별칭.
- 추가할 이벤트와 기존 항목을 보존한 민감정보 제거 Diff.
- 변경 전 SHA256/권한, `writesPerformed=0`, 검사 전후 동일 여부.
- 예정된 개인 backup 위치와 생성·검증 방식. 아직 backup 생성/설정을 수정하지 않았음을 명시.
- 설치 실패·기능 오류 시 복구 절차.

기존 계획은 12종이다: SessionStart, SessionEnd, PreToolUse, PostToolUse, PostToolUseFailure, Stop, PermissionRequest, Notification, SubagentStart, SubagentStop, TeammateIdle, TaskCompleted. 이미 동일 Orbit 항목이 있으면 Dry-run의 실제 changes를 기준으로 한다. 별도 Hook 종류나 `.claude/scripts` 파일 설치는 필요하지 않다.

예상 append 형식은 아래와 같지만, 실제 승인 자료는 대상 Mac에서 재생성한다.

```diff
@@ hooks.SessionStart; N existing entries preserved @@
+ {"matcher":"","hooks":[{"type":"command","command":"'<NODE22>' '<CHECKOUT>/dist/claude-forwarder.cjs'","timeout":5}]}
```

**이 자료를 제출한 뒤 `WAITING_HOOK_APPROVAL`로 멈춘다. 사용자에게 실제 적용을 별도로 승인받기 전 backup 생성·settings 쓰기·Hook 설치·실제 Live 세션 검증으로 넘어가지 않는다.** 이번 P2-A.3 지시나 원격 접속 허용을 Hook 설치 승인으로 해석하지 않는다.

## 8. 별도 승인 후에만 실행할 단계

승인된 파일/항목만 대상으로 한다. 원본 bytes·SHA256·POSIX mode를 개인 전용 backup에 저장하고 복원 가능성을 확인한다. 권장 위치는 Orbit private root의 `backups/settings.<timestamp>.json`이며 디렉터리0700/파일0600을 적용한다. 백업 후 원본 hash를 다시 비교해 동시 수정이 있으면 중단한다.

기존 Hook 값과 배열 순서를 가능한 한 보존하고 필요한 Orbit 항목만 append한다. 기존 항목을 교체하지 않는다. 현재 저장소에는 apply 명령이 없다. 파일 전체를 재직렬화하면 서식 Diff도 발생할 수 있으므로 실제 적용 방식/전체 Diff를 승인 범위와 대조한다. 적용 후 JSON·기존 Hook 보존·Diff·hash를 확인한다.

그 다음에만 다음을 실행한다.

```sh
ORBIT_MODE=claude-local npm start
```

Mac 브라우저의 LIVE OFFICE에서 새 실제 Claude CLI 최상위 세션을 시작한다. 도구 작업은 별도 테스트용 디렉터리와 무해한 파일에만 수행한다. 기존 프로젝트를 수정하지 않는다.

| 실제 관찰 | 기대 화면 |
|---|---|
| SessionStart | 캐릭터1명 생성 |
| Read/Grep/Glob | 읽기 애니메이션 |
| Edit/Write | 타이핑 |
| Bash | 도구 실행 중, 중립 자세 |
| PermissionRequest | 승인 요청 말풍선 |
| Stop | 턴 종료, 캐릭터 유지, 업무 완료로 집계하지 않음 |
| SessionEnd | 활성 집계 제외·좌석 반환·퇴장 |

안전하게 발생시키기 어렵거나 실제 버전에서 확인하지 못한 이벤트는 미검증으로 남긴다. 합성 이벤트를 실제 Claude 관찰의 대체 증거로 쓰지 않는다. UI의 실환경 미검증 표시는 현재 코드에서 자동 해제되지 않으므로 표시를 임의로 바꾸지 않는다.

추가 안정성 검증은 **독립 실제 세션2개 이상** 구분, 새로고침 중복 없음, 서버 재시작 후 stale, 종료 후 지연 이벤트, 서버 장애 시 Mock 전환 없음, 기존 Claude 명령·인증 유지, Orbit 종료 상태에서도 Claude 작업 지속이다. 자신의 테스트 세션과 Orbit 프로세스만 제어한다.

## 9. 반드시 인계할 기술적 제약

- 원본 Pixel Agents381파일은 upstream `d1e007a9fdf3003c252d2973abe1999ae59aec33`에 고정·hash 검증된다. 엔진/Claude Provider를 새로 쓰지 않는다.
- Live 경로는 기존 sanitize sender → 인증 intake → 격리 Claude Provider worker → private 영속 projection → epoch/revision Snapshot/Delta → 독립 Live Store → 기존 OfficeState/BFS/renderer/gameLoop다.
- sender에 producer eventId·sequence·재전송/replay 보장이 없다. 서버 수신 순서와 UI Delta 정합성은 원래 발생 순서/최초 유실 복원 보장이 아니다.
- identity는 provider+installationInstanceId+nativeSessionId+generation1이다. native ID는 private HMAC으로 보존하고 UI에는 UUID/numeric mapping과 안전한 별칭만 쓴다.
- **종료된 동일 native ID의 SessionStart도 차단한다.** 실제 resume/clear/compact에서 ID 재사용 여부와 정상 재개 차단 여부를 조사하되 임의로 정책을 풀지 않는다. P2-A.4 필요 여부를 별도 판단한다.
- SessionStart 없는 toolStart는 생성 근거가 아니다. 일반 이벤트의 명시적 agent_id/parent_session_id는 root 지원 범위에서 거부한다. 실제 Claude root 이벤트에도 해당 필드가 붙는지 확인하고, 발견 시 계약 문제로 보고한다. 가짜 자식 캐릭터를 만들지 않는다.
- 기본 private root는 `~/Library/Application Support/Orbit Works`. runtime registry에는 token/port/PID가 있고, `live/claude-live.json`에는 mapping/상태/tombstone이 있다. 이 파일들을 공개하거나 오류 해결 목적으로 임의 삭제하지 않는다.
- 활성100/전체 identity·tombstone1000/Delta128/timeline100/file2MiB 제한이다. 새 세션 정원이 찼다고 tombstone을 지워 우회하지 않는다.
- 30초 stale/120초 offline은 관측 freshness이며 실제 업무 종료/프로세스 생존 판정이 아니다. 실제 업무 성공·완료·프로젝트를 추정하지 않는다.

## 10. 문제 발생 시 복구

자신이 시작한 Orbit을 정상 종료한다. 설치 직후 hash와 현재 settings hash를 비교한다. 다른 변경이 없으면 승인된 backup의 bytes/mode로 복원할 수 있다. 다른 변경이 있으면 오래된 backup으로 덮어쓰지 않고 이번 Orbit command만 제거해 타 Hook과 사용자 편집을 보존한다.

원래 settings가 없었어도 다른 새 항목이 생겼다면 파일 전체를 삭제하지 않는다. JSON과 기존 Hooks 동작을 확인한다. 기존 OMP/Command Code/DeepSeek/Hermes 설정·스크립트는 변경하지 않았으므로 원복 명목으로 건드리지 않는다.

stale registry가 있어도 덮어쓰거나 PID를 무조건 종료하지 않는다. 해당 프로세스 소유와 종료 여부를 확인한다. ledger 삭제는 namespace/tombstone 보장을 초기화하므로 임의 복구 수단으로 쓰지 않는다. 실패·변경·복구한 범위를 민감정보 없이 보고한다.

## 11. 결과 보고 양식

| 판정 | 이 문서 작성 시점 |
|---|---|
| MAC_INSTALL_PASS | 미검증 — 실제 Mac 설치 전 |
| HOOK_DRY_RUN_PASS | 미실행 — 실제 Mac 조사 전 |
| WAITING_HOOK_APPROVAL | 미도달 — 실제 승인 자료 제출 전 |
| CLAUDE_LIVE_PASS | 미검증 — 실제 연결 없음 |
| CROSS_PLATFORM_CI_PASS | 위 기준 SHA의 기존 CI 성공, 이번 Mac 작업 결과와 분리 |
| BLOCKED | 현재 Linux 클라우드여서 Mac 실환경 작업 중단 |

새 Mac 세션은 실제 결과로 표를 갱신하고, SHA/환경/실행 명령·종료 결과/Hook 영향/민감정보 제거 Diff·hash/스크린샷/검증한 이벤트/실패·미검증/복구 여부/P2-A.4 판단을 보고한다. 승인 전이면 승인 자료를 제출하고 멈춘다. 실제 연결이 없으면 CLAUDE_LIVE_PASS를 선언하지 않는다. P2-B로 진행하지 않는다.
