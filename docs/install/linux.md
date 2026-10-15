# Linux 설치 · Ubuntu / Debian x64

## 1. 필수 환경

Ubuntu/Debian x64, Git, Node.js 22 LTS, 브라우저를 준비한다. `.nvmrc`는 22.23.3이고 upstream의 22와 호환된다. 시스템 패키지 설치나 전역 npm 설치는 자동 실행하지 않는다. Linux arm64는 의존성 metadata 조사 단계로 별도 검증이 필요하다.

## 2. 소스 다운로드

```sh
git clone https://github.com/choiyoh/ai-pixel-office.git
cd ai-pixel-office
git switch work
git rev-parse HEAD
```

## 3. 설치와 빌드

```sh
node --version
node -p 'process.platform + "/" + process.arch'
npm ci --no-audit --no-fund
npm run setup
npm run build
npm run doctor
```

`npm run bootstrap`은 위 설치·setup·build를 Node로 순서대로 실행한다. Bash helper는 필수가 아니다.

## 4. 서버 실행과 종료

```sh
npm start
```

실행 터미널에서 Ctrl+C로 종료한다. 백그라운드 서비스나 시스템 daemon을 설치하지 않는다.

## 5. 브라우저 접속

동일 Linux 머신에서 `http://127.0.0.1:4173`에 접속한다. headless 클라우드에서는 로컬 HTTP/Playwright 테스트로 확인한다. 포트 공개·SSH/Tailscale 터널을 이번에 만들지 않는다.

## 6. Mock 모드 확인

MOCK 개발 모드, linux/x64(WSL이면 wsl-local), 최근 수집 이벤트 없음, 실환경 미검증 표시를 확인한다.

```sh
npm test
npm run test:integration
npm run test:smoke
npm run hooks:plan
```

상태 저장은 `${XDG_STATE_HOME}/orbit-works` 또는 `~/.local/state/orbit-works`이며 절대경로 `ORBIT_STATE_DIR`로 지정할 수 있다. private 디렉터리 0700/registry 0600을 검사한다. 기존 사용자 권한을 자동 변경하지 않는다. WSL에서는 Linux Node·Linux home·Linux Claude 설정을 사용하고 Windows와 별개로 실행한다.

## 7. Claude Code 연결 전 점검

`doctor`는 PATH의 CLI 존재 여부만 확인하며 CLI 실행·인증·버전 조회는 하지 않는다. 실제 Claude 로그인과 버전, 실행 환경, 설정 파일 위치를 사용자가 대상 머신에서 확인해야 한다. 기존 Provider의 `normalizeHookEvent`는 격리 worker에서 재사용한다. 원본 installer/Runtime watcher는 호출하지 않는다.

기본 Mock는 사용자 상태 디렉터리를 생성하지 않는다. 후속 승인된 `claude-local` 실행은 전용 receiver registry에 임시 token·port·PID를 기록한다. Hook 파일을 설치하거나 settings를 쓰지 않는다. 이 registry와 로그를 공유하지 않는다. 기존 설정·OMP·DeepSeek 스크립트는 이번 단계에서 변경하지 않는다.

## 8. Hook Dry-run과 별도 승인 후 검증 순서

`hooks:plan`은 `~/.claude/settings.json`을 기본으로 읽는다. `CLAUDE_CONFIG_DIR`가 이미 설정되어 있으면 해당 디렉터리를 사용한다. 기존 값은 가리고 추가 항목·원본/제안 SHA256·예상 backup 위치를 출력한다. **writesPerformed=0**, apply/export 기능이 없다. 설정이 없으면 계획만 만들고 디렉터리도 생성하지 않는다. JSON 오류·symlink·중복 Orbit 경로 충돌은 거부한다. 다른 Hook 항목은 보존한다.

예상 변경은 settings의 hooks 12종에 Orbit sender command를 추가하는 것이다: SessionStart, SessionEnd, PreToolUse, PostToolUse, PostToolUseFailure, Stop, PermissionRequest, Notification, SubagentStart, SubagentStop, TeammateIdle, TaskCompleted. 실제 목록은 출력의 changes를 기준으로 검토한다. 변경 전 백업과 실제 Diff를 사용자에게 제시하고 별도 승인받아야 한다. 이 저장소에는 설치 명령이 없다.

승인 후의 수동 검증 계획: 서버를 `claude-local`로 실행 → 정상/권한 거부 요청 검사 → 실제 Claude 새 세션과 도구 실행·승인 대기·서브에이전트·종료를 각각 발생 → 수집 패널에서 source=live, 세션/상태/시각과 원본 증거 비교 → sender 실패가 Claude를 막지 않는지 확인 → 종료 후 registry 제거 확인. 코딩/분석 같은 의미는 Hook만으로 확정하지 않는다. 합성 fixture는 이 절차를 대체하지 않는다. UI의 미검증 표시를 자동으로 성공으로 바꾸지 않는다.

## 9. 문제 해결

Node 24 등 다른 major이면 사용자 관리 도구로 Node 22를 선택한다. 의존성 오류는 OS별 별도 checkout에서 `npm ci`를 다시 실행한다. 다른 OS의 node_modules를 복사하지 않는다. port 충돌 시 기존 프로세스를 무조건 종료하지 말고 Orbit 자신의 터미널을 확인한다. 기존 runtime registry가 있으면 자동 덮어쓰지 않는다. 해당 PID의 실행 주체와 서버 종료를 확인한 뒤 사용자 소유 stale registry만 별도 정리한다.

Hook 수신이 없어도 Mock Canvas는 동작한다. Mock를 live 증거로 해석하지 않는다. Hook 실행 호스트·설정 범위·Claude 버전이 확인되지 않았으면 실제 연결은 미검증이다. UI 필터/배치가 남는 것은 origin별 localStorage이며 브라우저 개발자 도구로 해당 Orbit origin만 초기화할 수 있다.

## 10. 삭제와 원복

이번 설치는 Claude/Command Code/OMP 설정을 바꾸지 않으므로 해당 설정 복구는 필요 없다. Orbit 프로세스를 종료한 후 checkout을 삭제하면 의존성·빌드가 제거된다. opt-in으로 생성한 Orbit 상태 디렉터리는 내용과 소유자를 확인한 뒤 그 디렉터리만 삭제한다. 오래된 `~/.orbit-works`는 자동 이전·삭제하지 않는다. Node/Git 등 기존 도구나 다른 앱 설정은 지우지 않는다.

향후 승인된 Hook 설치 시에는 변경 전 원본 bytes·SHA256·권한(Windows ACL)을 별도 backup으로 확보한다. 복구는 Claude/Orbit 종료 → 설치 직후 hash와 현재 hash 비교 → 다른 변경이 없으면 원본 bytes와 권한 복원 → 다른 변경이 있으면 이번 Orbit command 항목만 수동 제거하고 다른 Hook 보존 → JSON 파싱·원본 Hook 작동 확인 순서다. 원래 settings가 없었던 경우에도 타 항목이 생겼으면 파일 전체를 삭제하지 않는다. backup은 민감정보를 포함할 수 있어 사용자 전용으로 보관한다.
