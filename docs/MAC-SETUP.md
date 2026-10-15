> 이 문서는 이전 Mac 준비 이력입니다. 현재 설치는 [macOS](install/macos.md), 전체 결과는 [크로스플랫폼 보고서](P2-A-CROSS-PLATFORM.md)를 우선합니다.

# P2-A Mac 설치·실행·실환경 검증 인계

**현재 판정은 “Linux에서 준비·합성 검증 완료, Mac 실환경 미검증”이다.** macOS/Apple Silicon 실행, 실제 Claude 이벤트, 계정 인증, 모바일 접근을 성공했다고 판단하지 않는다. 아래 절차는 대상 Mac에서 별도로 실행해야 한다.

## 1. 다운로드 경로와 검증 수준

현재 GitHub `choiyoh/ai-pixel-office`에는 원격 heads가 없었다. 이 작업의 로컬 커밋을 아직 push하지 않았다. 따라서 “지금 GitHub에서 이 P2 코드를 clone해 성공했다”는 증거는 없다. 소스 공유 승인 후 해당 커밋을 GitHub에 올려야 아래 GitHub 경로가 동작한다. GitHub 게시와 앱 원격 배포는 다른 작업이며 이번에는 둘 다 하지 않았다.

공유 후 사용할 명시적 절차:

```bash
git clone --branch work https://github.com/choiyoh/ai-pixel-office.git
cd ai-pixel-office
git rev-parse HEAD
# 전달받은 P2-A SHA와 정확히 같은지 확인
```

현재 로컬 산출물을 GitHub 없이 전달할 때는 결과물의 `orbit-works-p2a.bundle`을 내려받아 사용할 수 있다. 이 bundle의 clone/install/build 경로는 Linux의 공백 포함 새 경로에서 검증한다. 이를 Mac 또는 GitHub 원격 검증으로 대신 보고하지 않는다.

```bash
git clone /다운로드한/경로/orbit-works-p2a.bundle ai-pixel-office
cd ai-pixel-office
git rev-parse HEAD
git status --short
```

원본 엔진은 별도 형제 checkout 대신 `vendor/pixel-agents/`에 포함했다. 업스트림 SHA는 `d1e007a9fdf3003c252d2973abe1999ae59aec33`, 원본 추적 파일 381개의 SHA-256은 `vendor/upstream-lock.json`에 있다. `.git`·node_modules·Linux 바이너리를 vendor하지 않았다. Mac에서는 lockfile로 해당 플랫폼 의존성을 새로 설치한다.

## 2. Mac 사전 조건

- Apple Silicon macOS, Git, 네트워크(npm registry)가 필요하다. Git/Xcode CLI·Node는 사용자가 승인한 방법으로 준비한다. 이 프로젝트는 전역 패키지·Homebrew·nvm을 자동 설치하지 않는다.
- 원본 `.nvmrc`는 Node 22, Orbit의 `.nvmrc`는 22.23.3이다. 기존 version manager에서 이 프로젝트에만 Node 22를 활성화한다. 기존 전역 기본값을 바꾸지 않는다.
- `node -p 'process.platform + "/" + process.arch'`가 **darwin/arm64**인지 확인한다. Rosetta의 x64 실행을 Apple Silicon native 검증으로 인정하지 않는다.
- 경로가 공백·한글을 포함할 수 있으므로 쉘 경로는 항상 따옴표로 감싼다. Hook 계획은 실제 Node 실행 파일과 프로젝트 절대 경로를 사용하므로 프로젝트 이동·Node 교체 후 다시 생성해야 한다.

## 3. 설정 변경 없는 기본 설치와 Mock 실행

프로젝트 루트에서:

```bash
node --version
node -p 'process.platform + "/" + process.arch'
export npm_config_cache="$PWD/.cache/npm"
npm ci --no-audit --no-fund
npm run setup
npm run build
npm run verify:vendor
npm run doctor
npm start
```

`setup`은 로컬 vendor 디렉터리에서만 frozen `npm ci`를 실행하고 Husky를 비활성화한다. 기존 사용자 설정이나 전역 패키지는 수정하지 않는다. `start`는 기본 Mock 모드의 Fastify를 **127.0.0.1:4173**에만 연다. 포트 변경은 `PORT=4174 npm start`처럼 가능하지만 외부 host 바인딩 옵션은 제공하지 않는다. API health는 `status=ok`, `mode=mock-only`, `realMacVerified=false`여야 한다. 브라우저는 이 서버의 루트 페이지를 로컬에서 연다.

검사 명령:

```bash
npm run lint
npm test
npm run test:integration
npm run test:upstream
# 별도 터미널에서 Mock 서버를 실행한 상태
export PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/ms-playwright"
npx playwright install chromium
npm run test:browser
npm run test:connection-browser
```

Playwright browser 다운로드는 선택한 프로젝트 캐시에 둔다. 이미 승인된 브라우저를 쓸 경우 `ORBIT_BROWSER_EXECUTABLE`에 그 실행 파일을 지정할 수 있다. 자동 테스트의 Hook은 합성 fixture이며 실제 settings에 설치하는 테스트가 아니다. 원본 테스트는 별도 임시 HOME에서 compile 후 실행하므로 built-artifact 테스트가 skip되지 않게 한다. 이 테스트는 실제 사용자 Hook에 대한 설치 승인을 대체하지 않는다.

## 4. 실제 Claude 연결 전 점검 — 아직 설치하지 않음

`npm run doctor`는 플랫폼·Node·vendor 검증·CLI 존재·설정 파일 존재·인증 변수 **존재 여부만** 확인한다. 값이나 credential 파일을 출력하지 않는다. Claude가 OAuth 키체인으로 인증되었을 수도 있으므로 환경 변수 부재를 인증 실패로 단정하지 않는다. 대상 터미널에서 사용자가 정상적인 짧은 Claude 세션을 실행할 수 있는지 별도로 확인한다.

`npm run hooks:plan`은 실제 대상 Mac의 `~/.claude/settings.json`을 읽고 다음을 출력한다:

- 기존 bytes의 SHA-256과 mode, 파일 존재 여부.
- 추가할 이벤트별 항목·보존할 기존 항목 수·비밀을 가린 **추가 구간 Diff**.
- 예상 backup 위치와 receiver registry 위치, 실제 Node·forwarder 경로.
- `dryRun=true`, `writesPerformed=0`. apply·export 옵션은 없다.

현재 Linux에서 생성한 `artifacts/p2-cloud-hook-plan.json`은 형식 확인용이다. Mac 경로·기존 설정과 다르므로 Mac에 그대로 적용하면 안 된다. 정확한 예상 Diff는 Mac에서 다시 생성한 계획으로만 승인받는다. 깨진 JSON·비정상 hooks 형태·다른 위치의 기존 Orbit sender·symlink settings는 쓰지 않고 거부한다. 기존 Hook command·env 값은 출력하지 않는다.

## 5. Hook 설치 시 예상 변경과 승인이 필요한 부분

**이 단계에서 실제 settings를 수정하는 명령을 실행하지 않는다.** 계획을 검토한 다음 별도 승인 단계에서만 적용한다.

| 파일 | 예상 작업 |
|---|---|
| `~/.claude/settings.json` | 12개 이벤트의 기존 배열 끝에 Orbit command 항목만 추가. 기존 Hook/permissions/env와 다른 key는 보존. 원래 파일이 없으면 승인 후에만 신규 생성 |
| `~/.orbit-works/backups/settings.<timestamp>.json` | 설치 직전 원본 bytes 백업. 원본 mode·hash, 원래 부재 여부와 설치 후 hash를 별도 기록. 권한 0600, 디렉터리 0700 |
| `<checkout>/dist/claude-forwarder.cjs` | build로 생성한 Orbit 전용 송신기. 기존 `~/.pixel-agents/hooks/claude-hook.js`를 교체하지 않음 |
| `~/.orbit-works/runtime/receiver.json` | `claude-local` 수신기 실행 시에만 생성되는 port/token/pid. 권한 0600. 정상 종료 시 본인 token의 파일만 삭제 |

추가할 이벤트는 SessionStart, SessionEnd, Stop, PermissionRequest, Notification, PreToolUse, PostToolUse, PostToolUseFailure, SubagentStart, SubagentStop, TeammateIdle, TaskCompleted다. UserPromptSubmit은 수집하지 않는다.

Diff의 한 구간은 다음 형태다. 실제 command는 dry-run의 경로를 따른다:

```diff
@@ hooks.PreToolUse; existing entries preserved @@
+{
+  "matcher": "",
+  "hooks": [{"type":"command","command":"'<Node 경로>' '<checkout>/dist/claude-forwarder.cjs'","timeout":5}]
+}
```

이 출력은 검토용 구조 Diff이며 기존 비밀을 포함한 전체 patch 파일이 아니다. 자동 apply 도구를 제공하지 않으므로 승인 후 적용 단계에서 bytes/hash 재확인·원자적 쓰기·동시 변경 거부를 구현하거나 수동 검토해야 한다. 승인 전 검토 범위를 넘겨 설치를 진행해서는 안 된다.

기존 Pixel Agents Hook이 있으면 그대로 유지한다. Orbit sender는 별도 registry로만 보낸다. 따라서 두 모니터가 각각 자기 sender에서 이벤트를 받는 구성일 수 있으며 기존 수집 범위를 Orbit가 축소한다고 주장하지 않는다. OMP와 `.claude/scripts/`, `.claude/omp/`, `~/.omp/`는 대상이 아니다.

## 6. 승인 후 실제 Mac 검증 순서

아래 명령은 receiver 준비만 하며 Hook을 설치하지 않는다. 준비 파일 생성도 Mac에서 검토한 후 실행한다:

```bash
ORBIT_MODE=claude-local npm start
```

이미 registry가 있으면 덮어쓰지 않고 실행을 거부한다. 살아 있는 기존 monitor를 임의 종료하지 않는다. crash 뒤 파일이 남았으면 pid의 명령·시작 시각·소유자·해당 프로젝트를 확인한 뒤 별도로 정리한다. 자동 stale 제거는 없다. 재시작 시 token이 바뀌며 receiver는 과거 session을 복구하지 않는다.

1. Mac의 UI에 `mac-local · darwin/arm64`, `로컬 수신 준비`, 최근 이벤트 없음, `실환경 미검증`이 표시되는지 확인한다.
2. 승인·백업·실제 Diff 확인 후 대상 Claude 설정에만 Hook 항목을 추가한다. 작업 중 Claude/다른 도구가 설정을 동시에 쓰지 않는지 확인하고 검토한 hash가 달라졌으면 중단한다.
3. 사람이 실제 Claude 세션을 실행해 Read/Write, 승인 요청, 입력 대기, Stop/SessionEnd를 발생시킨다. source live의 별도 수집 채널·수신 시각과 CLI 활동을 대조한다. HTTP 200만으로 성공으로 판단하지 않는다.
4. Stop은 턴 종료이고 작업 성공 보장이 아니다. 현재 UI는 toolStart를 일반 도구 실행으로, PostToolUseFailure를 도구 실패로 표시한다. 코딩/분석/테스트 성공으로 임의 확정하지 않는다.
5. 서브에이전트 Hook은 정규화 경계까지만 준비했다. transcript 감시와 안정된 부모 tool id 상관관계는 연결하지 않았으므로 실제 자식별 캐릭터·병렬 상관관계는 별도 후속 과제다.
6. 앱 중지/재시작·Claude 실행 중 앱 부재·timeout을 확인한다. sender는 fail-silent이고 replay queue가 없어 이벤트 유실을 복구하지 않는다. 이를 장기 모니터링 완료로 판단하지 않는다.
7. Mac 검증 기록에는 OS/arch/Node/CLI 버전, commit, 시작·종료 시각, 이벤트 종류별 관찰, 예상/실제 Diff, 설정 영향과 복구 결과를 남긴다. 민감 payload는 기록하지 않는다. 현재 UI의 `realMacVerified=false`는 자동으로 true로 바뀌지 않는다.

## 7. 원본 설정 복구

설치 직전 원본 bytes·mode·hash, 원래 파일 존재 여부와 설치 직후 hash, 이번에 추가한 정확한 command 목록을 비공개 manifest에 보존해야 한다. dry-run의 hash는 실제 설치 시점에 다시 확인한다.

- 설치 후 hash가 manifest의 hash와 같고 동시 변경이 없다면, 원본이 있었을 경우 backup bytes를 같은 디렉터리 임시 파일에 원래 mode로 쓴 뒤 atomic rename한다. hash/mode를 원본과 비교한다.
- 원래 settings가 없었다면 이번에 생성한 내용만 남았는지 확인하고 생성 파일만 제거한다. 다른 새 설정이 있으면 삭제하지 않는다.
- 설치 이후 다른 편집이 있으면 전체 backup을 덮어쓰지 않는다. **이번에 추가한 Orbit command 항목만** 비교·제거하고 나머지 Hook/permissions/env는 보존한다. empty event key도 이번 추가만으로 생긴 경우에만 제거한다.
- 수신기를 종료하고 Orbit runtime registry가 정상 제거되었는지 확인한다. checkout의 build 파일이나 private backup이 남는 것은 Hook 활성화를 의미하지 않는다. 기존 Pixel Agents와 OMP 파일은 건드리지 않는다.
- 기존 Claude Hook 정상 작동과 설정 hash/mode·실제 Diff를 재검증한다. 백업은 사용자가 보관 여부를 결정한다.

이 복구 절차 역시 아직 실제 Mac에서 실행하지 않았다.
