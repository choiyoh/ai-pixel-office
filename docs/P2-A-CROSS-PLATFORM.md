# P2-A 크로스플랫폼 준비 결과

2026-10-16 KST. 이번 결과는 크로스플랫폼 공통 실행 구조·문서·검증 체계 준비다. **Windows/macOS 실행 지원 완료 또는 Claude 실환경 연동 완료로 판정하지 않는다.** P2-B 통합, Hook 설치, 원격 접근/배포는 진행하지 않았다.

## 실행 환경과 소스

- 실제 검증: Linux x64 클라우드, Node 22.23.3, npm 11.9.0, 시스템 Chromium headless.
- 원본: pixel-agents-hq/pixel-agents `d1e007a9fdf3003c252d2973abe1999ae59aec33`. vendored 원본 381파일 hash 유지, 엔진/Provider 소스 변경 없음.
- 변경 기준 커밋: `46c0112ff8098187be08411c32a342a55fe53dec`. 최종 커밋은 `git rev-parse HEAD`, 변경 목록은 `git show --stat`으로 확인한다. 이전 GitHub 전달 때 main/work를 이 기준 커밋까지 push했으며 이번 소스 전달은 work branch를 대상으로 한다.
- 패키지 0.3.0, Node 22 LTS, Fastify 로컬 서버 + 동일 React UI. Electron/Tauri/설치 프로그램/AppImage/Docker 패키지를 구현했다고 주장하지 않는다.

## OS별 확인 수준

| 환경 | 이번 실제 실행 | 상태 및 남은 검증 |
|---|---|---|
| Linux x64 cloud | 설치/build/typecheck/lint/unit/integration/원본 compile+tests/브라우저/서버 IPC 종료 | 통과. Ubuntu/Debian 개별 배포·실제 Claude 로그인/Hook은 별도 검증 |
| macOS arm64 | 없음 | 경로/프로세스/권한 정적 분석 + CI 준비. M1 Max 실기 우선 |
| macOS Intel x64 | 없음 | 별도 Intel 실행 필요. macos-latest 한 architecture로 양쪽을 입증하지 않음 |
| Windows 10/11 x64 | 없음 | PowerShell/ACL/.cmd/WSL 분리 코드 및 tests 준비. Windows Server CI와 10/11 실기를 구분 |
| WSL Claude | 없음 | Linux Node/home/settings 사용 설계. Windows native와 공유하지 않음 |
| Windows/Linux arm64 | 없음 | Node·native optional dependency metadata 있음. 실행/브라우저/Claude 호환성 미판정 |

CI는 `.github/workflows/cross-platform.yml`에 ubuntu-latest/windows-latest/macos-latest matrix를 준비했다. 설치, vendor hash, source scan, 타입, 빌드, lint, 단위/통합, Mock 서버 시작·IPC 종료, 원본 compile/tests, Mock·수신 UI 브라우저 테스트와 OS별 artifact upload를 수행한다. push(main/work), PR, 수동 실행을 지원한다. 이 클라우드의 GitHub Actions API 요청은 proxy 403으로 차단되어 **CI 성공 결과를 관찰하지 못했다**. 파일 준비나 push 성공을 CI 통과로 보고하지 않는다. 실행 결과는 저장소 Actions에서 확인해야 한다.

## Linux 검증 증거

- 앱 build/typecheck/lint 성공. 단위 11/11, 통합 5/5, Mock startup/assets/source-isolation/IPC-shutdown smoke 성공.
- 원본 webview 86 + server 550 + package-contract 7 = 643 tests 성공. 원본 compile 성공. upstream useEffect dependency warning 1개는 기존 상태이며 custom lint 경고는 없다.
- Playwright Mock: 동시 캐릭터 6, 명시 상태 8개, 프로젝트/에이전트 필터, 배치 유지, zoom, 제거/재생성, timed scenario, desktop/mobile, JS/HTTP 오류 없음.
- 수신 패널: 합성 인증 Hook → 변경 없는 원본 Claude Provider → source=fixture, 환경/최근 시각/미검증 표시, 서버 끊김. 실제 CLI/계정/세션이 아니다.
- GitHub origin/work의 구현 커밋 `3cfabad96973feb0a2dee601bc8281bfbc1e2c6d`를 `/tmp`의 공백·한글·작은따옴표 경로에 새 clone하고 `npm run bootstrap`, Mock smoke, 단위 11개, 통합 5개를 다시 실행해 통과했다. 최종 후속 커밋은 이 검증 기록 문서만 보강한다.
- 알려진 credential/private-key 패턴과 case/Unicode 경로 충돌 검사 통과. 패턴 검사는 모든 민감정보 부재의 증명이 아니다. ignored token registry·개인 로그·node_modules·artifacts는 Git 전달에 포함하지 않는다.
- protected Claude/OMP 경로 baseline 비교 변화 없음. 기존 Claude Code/Command Code/DeepSeek/OMP 설정과 스크립트 변경 없음.

재현: `npm ci` → `npm run setup` → `npm run build` → README 검증 명령. `npm run bootstrap`은 Node 기반 설치 orchestration이다. UI/테스트 결과 JSON과 screenshot은 ignored `artifacts/`에 생성된다. `office-desktop.png`, `office-mobile.png`, `p2-connection-prepared.png`는 이번 Linux 브라우저 결과다.

## Hook 예상 변경과 복구

현재 수행한 설정 쓰기는 **0**이다. `npm run hooks:plan`은 실제 OS의 settings를 읽고 기존 값이 가려진 additions Diff/hash만 출력한다. POSIX는 실제 Node/sender 경로 quote, Windows는 PowerShell EncodedCommand와 decodedLauncher를 보여준다. 실제 Claude Hook host는 별도 검증해야 한다. 주석·JSON 오류/익숙하지 않은 구조를 자동 고치지 않는다.

향후 승인 대상 파일은 실제 `~/.claude/settings.json`(또는 CLAUDE_CONFIG_DIR 아래 settings.json), 사용자 전용 원본 backup, 승인된 sender 배포 위치다. opt-in 서버가 생성하는 Orbit registry는 OS 전용 상태 경로 아래 runtime/receiver.json이며 정상 종료 시 제거한다. 원본 Hook·OMP·위임 스크립트는 대상이 아니다. backup 예상 경로/원본 hash/제안 hash/기존 mode 또는 ACL 모델은 Dry-run에 표시한다.

복구는 앱/Claude 종료 → 현재 설정이 설치 후 예상 hash와 같은지 비교 → 같으면 원본 bytes·권한 복원, 달라졌으면 이번 Orbit entries만 제거 → 다른 Hook/JSON 검증 순서다. Windows는 원본 ACL/owner도 보존한다. 자동 apply/restore 명령은 제공하지 않는다. 상세 절차는 [macOS](install/macos.md), [Windows](install/windows.md), [Linux](install/linux.md)를 따른다.

## 권장 멀티 Provider 구조

프로세스 분리 Bridge를 권장한다. providerId와 인증 principal을 바인딩하고 `(providerId, installationInstanceId, nativeSessionId)` namespace를 확립한 후, provider별 worker/Runtime으로 전역 watcher/parser를 격리한다. eventId dedup·sequence·bounded reorder·durable replay/tombstone·freshness를 구현하고 task/execution/parent/delegation ID로 병렬 관계와 Haiku relay/DeepSeek executor를 결합한다. 이름이나 prompt로 중복 제거하지 않는다. 그 다음 fake Adapter fault tests, 실제 CLI 검증, 마지막 live Canvas 투영 순서다.

Command Code 공식 URL은 사용자에게 받았으나 proxy 403으로 내용을 확인하지 못했다. 공식 이벤트 API/Hook 존재나 CLI 이름을 가정하지 않는다. launcher helper만 준비했고 실제 Provider 통합/DeepSeek 위임 스크립트 변경은 하지 않았다. [Command Code 문서](COMMAND-CODE.md)와 [Adapter 설계](ADAPTERS-AND-REMOTE.md)를 따른다.

원격 접근은 향후 Tailscale Serve tailnet 사설 HTTPS를 검토한다. 현재는 loopback Host/Origin만 허용하며 Serve를 켜기만 해서는 동작하지 않는다. trusted hostname/Secure cookie/proxy 신뢰/관찰 권한 분리 검증이 선행되어야 한다. 공개 포트·Funnel·원격 설정은 적용하지 않았다.

## 남은 작업 및 진행 판정

공통 구조와 Linux 검증은 준비되었다. CI의 실제 Windows/macOS 결과, Mac M1 Max·Intel·Windows 10/11 실기, native Windows와 WSL 각각의 실제 Claude Hook host/세션/서브에이전트 검증은 남아 있다. 지원 완료 판정과 실제 연결 완료 판정은 보류한다. 공식 Command Code 근거 및 위 Bridge 계약을 확인한 뒤 별도 승인으로 P2-B를 진행해야 한다. 이 단계에서 멈춘다.

## 추가·수정·삭제 파일

기준 커밋 이후 목록(삭제된 mac-readiness workflow는 cross-platform workflow로 대체):

- `.github/workflows/cross-platform.yml`
- `.github/workflows/mac-readiness.yml`
- `README.md`
- `docs/ADAPTERS-AND-REMOTE.md`
- `docs/COMMAND-CODE.md`
- `docs/CROSS-PLATFORM-AUDIT.md`
- `docs/MAC-SETUP.md`
- `docs/P2-A-CROSS-PLATFORM.md`
- `docs/P2-A-REPORT.md`
- `docs/install/linux.md`
- `docs/install/macos.md`
- `docs/install/windows.md`
- `eslint.config.js`
- `package-lock.json`
- `package.json`
- `platform/launch.mjs`
- `platform/private-files.mjs`
- `platform/runtime.mjs`
- `scripts/bootstrap.mjs`
- `scripts/browser-check.mjs`
- `scripts/check-source.mjs`
- `scripts/claude-forwarder.mjs`
- `scripts/connection-browser.mjs`
- `scripts/doctor.mjs`
- `scripts/hooks-plan.mjs`
- `scripts/mock-browser.mjs`
- `scripts/setup-environment.sh`
- `scripts/setup.mjs`
- `scripts/smoke.mjs`
- `scripts/tasks.mjs`
- `scripts/test-upstream.mjs`
- `server/app.mjs`
- `server/claude-worker.ts`
- `server/receiver.mjs`
- `src/ConnectionPanel.tsx`
- `src/model.ts`
- `tests/connection.integration.mjs`
- `tests/platform.test.ts`
