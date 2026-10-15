# OS 의존성 조사 및 변경 근거

대상은 Orbit 소스·scripts·server·tests와 vendored Pixel Agents의 package scripts/Provider/Runtime/watcher/UI이다. upstream `d1e007a9fdf3003c252d2973abe1999ae59aec33` 파일 381개는 변경하지 않는다.

| 항목 | 조사 결과와 처리 | 검증 경계 |
|---|---|---|
| npm scripts / Bash | app test의 shell glob을 Node 파일 열거로 대체. npm bootstrap은 Node orchestration. .sh는 선택 POSIX wrapper로만 남김. upstream의 cd/&&/npm-run-all은 원본 유지 | Linux 실행, Windows/macOS CI 준비 |
| npm.cmd | Node 공식 child_process 문서상 batch 직접 exec 불가. 내부 npm은 process.execPath + npm-cli.js, shell:false로 호출 | simulated Windows + Linux 실제 설치 |
| CLI .exe/.cmd/.bat | doctor는 PATH/확장자 존재만 조사. 미래 launcher는 batch를 verified Node entry 없이는 거부 | Command Code 실제 실행 없음 |
| 사용자/작업 경로 | 런타임은 import.meta.url, os.homedir, path 사용. /workspace나 특정 /Users 경로에 실행 의존 없음. docs의 클라우드 이력/fixture 경로는 실행 의존 아님 | GitHub 공백/한글/apostrophe 경로 clone/install/build/smoke 통과 |
| 설정 경로 | Windows LOCALAPPDATA/Orbit Works, macOS Library/Application Support/Orbit Works, Linux XDG_STATE_HOME 또는 ~/.local/state/orbit-works | 세 OS simulated 경로 tests |
| Claude / WSL | 실제 프로세스의 home 또는 명시 CLAUDE_CONFIG_DIR. native Windows와 WSL 자동 공유/변환 금지 | 실 Claude와 WSL 미검증 |
| 파일 권한 | POSIX uid/mode, Windows SID 기반 ACL 어댑터. 새 Orbit 디렉터리만 보호하고 기존 ACL은 검사·거부 | Windows 실제 ACL은 CI/실기 필요 |
| 경로 quoting | Hook POSIX quote, Windows PowerShell EncodedCommand + decodedLauncher. 한글/공백/apostrophe fixture. 새 settings는 쓰지 않음 | Linux shell 실제, Windows encoding 정적/CI 대상 |
| 파일 대소문자 | Hook sender 탐지를 case-insensitive로 하고 경로·case가 다른 기존 Orbit Hook은 수동 검토 요구. Git 경로 case collision도 전달 검사 | Linux 정적 검사; case-insensitive volume 미검증 |
| 프로세스 | 자식은 Node fork/IPC로 시작·종료. 소유 자식만 종료하고 timeout 시 강제 종료. CLI Ctrl+C SIGINT/SIGTERM 처리 | 실제 Linux IPC/shutdown, Windows console는 실기 필요 |
| watcher | Orbit Hook-only 경로는 transcript watcher를 시작하지 않음. 원본 fileWatcher는 fs.watch의 macOS/WSL 불안정 때문에 polling 사용. layoutPersistence는 fs.watch+polling. 전역 의존성 유지 | 원본 테스트 유지, OS별 실제 Claude transcript 감지 미검증 |
| Provider / 엔진 | 기존 Claude normalizeHookEvent와 Canvas/BFS/animation을 재사용. 원본 installer 자동 호출 없음 | hash381 및 원본 tests |
| HTTP / UI | loopback Host/Origin 제한, same-origin cookie, source 분리. UI 상태 poll은 OS 공통 | Linux Playwright; 공개 포트 없음 |

## ARM64 조사

Node 22.23.3 공식 SHASUMS256 목록에서 macOS arm64/x64, Windows arm64/x64, Linux arm64 배포물을 확인했다. root lockfile의 esbuild 0.28.0, rolldown 1.0.0-rc.15, lightningcss 1.33.0은 darwin/win32/linux arm64 optional binary 항목을 갖는다. upstream lock도 esbuild 0.28.1, rolldown 1.1.5, tailwind oxide 4.3.3, lightningcss 1.32.0의 해당 arm64 항목을 포함한다.

따라서 Windows ARM64와 Linux ARM64는 **의존성 metadata상 가능성 있음 / 실행 지원 미판정**이다. 실제 frozen install, native binding 로드, Node/PowerShell/ACL, Chromium 자동화와 Claude CLI 호환성을 각각 검증해야 한다. Linux는 glibc 기반 Ubuntu/Debian을 우선하며 musl 배포 지원을 주장하지 않는다. macOS arm64와 x64 역시 하나의 runner 성공으로 양쪽을 검증했다고 보지 않는다. node_modules를 다른 OS/arch에서 가져오지 않는다.

## 공식 근거와 접근 제한

- Node child process: https://nodejs.org/docs/latest-v22.x/api/child_process.html (조회 성공)
- Node 배포 목록: https://nodejs.org/dist/v22.23.3/SHASUMS256.txt (조회 성공; 다운로드 검증을 우회하지 않음)
- Claude 공식 저장소 README: https://github.com/anthropics/claude-code (Windows 배포 명령 존재 확인)
- Claude Hook/설치 문서: https://code.claude.com/docs/en/hooks 및 /setup (이 클라우드 proxy 403)
- Command Code: https://commandcode.ai/docs (사용자 제공, 이 클라우드 proxy 403)

Claude 공식 README에 Windows 설치 경로가 있다는 사실은 native Hook 실행 호스트나 특정 Claude 버전의 세션 동작 검증이 아니다. 실제 대상 머신에서 공식 문서와 설치 버전을 확인해야 한다.

원본 전체의 확장 개발/e2e 도구에는 POSIX mock wrapper와 macOS `security` keychain fixture가 남아 있다. Orbit 실행이나 이번 CI에서는 해당 VS Code/e2e keychain 도구를 실행하지 않는다. 원본의 OS 전용 보조 도구 전체를 이식한 것으로 보고하지 않는다. upstream codegen은 Windows quote 분기를 이미 포함한다.
