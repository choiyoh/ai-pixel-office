# Windows 10/11 x64 설치 · PowerShell

## 1. 필수 환경

Windows 10/11 x64, Git for Windows, Windows용 Node.js 22 LTS, 브라우저, 기본 Windows PowerShell 5.1이 필요하다. Orbit 설치/빌드/Mock 실행에 Bash는 필요하지 않다. Node 관리 도구는 선택 사항이다. `.nvmrc`는 22.23.3이며 전역 npm 패키지를 설치하지 않는다. Windows ARM64는 조사 단계이고 Windows 10/11 실기 검증도 아직 없다. windows-latest CI는 Windows Server이므로 데스크톱 OS 검증을 대체하지 않는다.

## 2. 소스 다운로드

```powershell
git clone https://github.com/choiyoh/ai-pixel-office.git
Set-Location ai-pixel-office
git switch work
git rev-parse HEAD
```

## 3. 설치와 빌드

```powershell
node --version
node -p 'process.platform + "/" + process.arch'
npm.cmd ci --no-audit --no-fund
npm.cmd run setup
npm.cmd run build
npm.cmd run doctor
```

전체 설치는 `npm.cmd run bootstrap`으로도 실행한다. PowerShell의 npm.ps1 실행 정책 문제를 피하려고 npm.cmd를 명시한다. 실행 정책을 변경하거나 Bash를 설치하는 우회는 필요 없다. 내부 프로세스는 Node + npm-cli.js를 shell:false로 실행하므로 npm.cmd를 직접 spawn하지 않는다.

## 4. 서버 실행과 종료

```powershell
npm.cmd start
```

해당 터미널에서 Ctrl+C로 종료한다. 자동화 검사는 IPC 종료를 사용한다. 전체 node.exe에 대한 taskkill을 하지 않는다.

## 5. 브라우저 접속

Windows 브라우저에서 `http://127.0.0.1:4173`에 접속한다. 공개 방화벽 규칙을 만들지 않는다. Orbit은 loopback만 듣는다.

## 6. Mock 모드 확인

MOCK, win32/x64, 최근 수집 이벤트 없음, 실환경 미검증 표시를 확인한다.

```powershell
npm.cmd test
npm.cmd run test:integration
npm.cmd run test:smoke
npm.cmd run hooks:plan -- --context=windows-native
```

기본 상태 경로는 `%LOCALAPPDATA%\Orbit Works`. 새로 생성하는 Orbit private 디렉터리에만 현재 사용자/SYSTEM/Administrators SID의 ACL을 적용하며, 기존 디렉터리의 ACL이 넓으면 실패한다. 기존 사용자 ACL을 임의 변경하지 않는다. registry는 검증된 parent의 ACL을 상속한다. 재분석 지점과 symlink는 거부한다. optional override는 `$env:ORBIT_STATE_DIR = 'C:\Users\YourName\OrbitPrivate'` 같은 새 절대경로를 사용한다.

**네이티브와 WSL 구분:** Windows Node의 `~/.claude`는 Windows home이다. WSL의 Linux Node/Claude/home/.claude/node_modules는 별개다. Windows에서 --context=wsl로 다른 파일 시스템을 대신 읽지 못하게 거부한다. WSL을 쓰면 해당 distribution 안의 별도 checkout에 Linux 절차를 적용한다. Windows의 Node 실행파일·Hook 계획·token registry를 WSL에 복사하지 않는다. Windows 네이티브 Claude의 실제 Hook 호스트가 POSIX shell을 요구하는지 등은 설치된 Claude 버전의 공식 문서/실기에서 확인해야 한다. Orbit Mock에 Bash가 불필요하다는 사실로 Claude의 요구사항까지 보증하지 않는다.

Dry-run의 Windows command는 `powershell.exe ... -EncodedCommand <base64>`이며 decodedLauncher도 같이 출력한다. 이는 암호화가 아니므로 decodedLauncher의 실제 Node/sender 경로를 검토한다. UTF-8 stdin과 한글·공백·작은따옴표 경로의 전달은 fixture 테스트 대상으로 두었지만 실제 Claude Hook 호스트에서는 별도 검증해야 한다. Windows ACL backup은 모드 숫자가 아니라 원본 ACL/owner까지 보존해야 한다.

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
