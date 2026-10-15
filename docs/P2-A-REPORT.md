> 이전 Mac 준비 단계의 보고서입니다. 이후 GitHub push 및 크로스플랫폼 변경 결과는 [현재 보고서](P2-A-CROSS-PLATFORM.md)를 우선합니다.

# Orbit Works P2-A — Cloud 준비 결과와 Mac 인계

판정: **클라우드에서 Mac 실행·Claude 연결을 준비하는 코드와 합성 검증을 수행했다. 실제 Mac 설치·Claude 연결·모바일 원격 접근은 미완료/미검증이다. 전체 실환경 연동 완료로 판정하지 않는다.**

## 준비한 것

- 고정 Pixel Agents 소스를 `vendor/pixel-agents/`에 포함했다. 원본 SHA `d1e007a9fdf3003c252d2973abe1999ae59aec33`, 381개 원본 파일 SHA-256을 검사한다. 엔진과 원본 Provider 코드는 변경하지 않았다.
- 형제 checkout과 `/workspace` 참조를 제거했다. Node 22, 프로젝트 로컬 `npm ci`·vendor setup·build로 설치하며 전역 패키지·런타임을 자동 설치하지 않는다. macOS arm64용 native dependency는 Mac 설치 시 lockfile의 플랫폼별 패키지를 선택한다. Linux node_modules는 전달하지 않는다.
- 기본 Mock 서버와 opt-in `claude-local` 수신기를 분리했다. 기존 Claude Provider 정규화는 별도 worker에 하나만 배치했다. sender는 Orbit 전용이고 기존 Pixel Agents Hook/registry를 교체하지 않는다.
- Hook 계획 도구는 기존 settings를 읽고 추가 구간 Diff·hash·mode·backup 위치만 제시한다. `dryRun=true`, `writesPerformed=0`, apply 옵션 없음. 기존 Hook/비밀 값을 출력하거나 settings에 쓰지 않는다.
- UI에 실행 환경, 수집 모드, 최근 이벤트 시각, 연결 끊김, 별도 수집 세션을 표시했다. 캔버스는 계속 Mock이며 fixture/live transport도 실Mac 검증 여부와 구분한다.
- Mac 설치·백업·설정 Diff 검토·복구·실세션 검증, Adapter 구현 순서, Tailscale Serve의 후속 사설 접근 설계를 문서화했다. Tailscale은 적용하지 않았다.

## 설치와 실행

전체 절차: [MAC-SETUP.md](MAC-SETUP.md).

```bash
# 사용자가 Node 22와 Git을 준비한 상태에서 저장소 루트
npm ci --no-audit --no-fund
npm run setup
npm run build
npm run verify:vendor
npm run doctor
npm start
# 실제 Mac에서 검토만 할 때
npm run hooks:plan
```

기본 서버는 127.0.0.1:4173 Mock 모드다. `ORBIT_MODE=claude-local npm start`는 수신기와 소유자 전용 registry만 열고 Hook을 설치하지 않는다. Mac에서의 실행도 준비 파일 영향을 검토한 후 진행해야 한다. 클라우드에서 Mac localhost로 접속하는 경로는 만들지 않았다.

## 클라우드 검증

환경: Linux x64, Node 22.23.3, npm 11.9.0, Chromium 154. macOS arm64에서 실행한 결과는 없다.

| 검사 | 결과/증거 |
|---|---|
| UI·worker·sender build와 타입 검사 | 통과, `/workspace/p0-evidence/p2-build.log` |
| 앱 Lint | 오류·경고 없이 통과, `p2-lint.log` |
| 앱 단위 테스트 | 5개 통과, `p2-unit.log` |
| 수집·보안·Hook 계획 통합 테스트 | 5개 통과, `p2-integration.log` |
| vendored 원본 compile·회귀 테스트 | UI 86 + server 550 + package 7 = 643개 통과. `p2-upstream.log`. 원본의 기존 React hook 경고 1개는 유지 |
| Mock 브라우저 | 기존 6캐릭터·8상태·필터·줌·제거/복원·좌석 저장 검증 통과. `p2-mock-browser.log`, `artifacts/browser-result.json` |
| 연결 UI 브라우저 | 합성 fixture 수신, 출처 분리·미검증 문구·수신 시각·서버 종료 표시 검증. `p2-connection-browser.log`, `artifacts/p2-browser-result.json` |
| 깨끗한 clone 재현 | 공백 포함 새 경로에 **로컬 Git clone** 후 frozen 설치·vendor setup·build·앱 단위/통합 검사를 실행하는 증거를 `artifacts/p2-clean-clone.json`에 보존. GitHub/Mac 증거와 구분 |
| 사용자 설정 | cloud Claude/OMP 보호 경로 존재·해시 일치. `artifacts/p2-settings-check.json` |
| Mac/실제 Claude | CLI·계정·실제 세션과 Mac 접근 없음. 미실행, `artifacts/p2-doctor.json` |

원본의 built-artifact 테스트 17개가 최초 vendor 시험에서 skip되는 것을 발견했다. 원본 compile을 원본 테스트 runner에 선행하도록 수정하고 재실행해 643개가 실제 실행되었다. 또한 통합 fixture mode를 명시해 host umask에 따른 잘못된 권한 기대를 수정했다. skip을 pass로 집계하지 않았다.

![합성 수집과 환경 구분](../artifacts/p2-connection-prepared.png)

합성 데이터는 인증된 HTTP → 격리 worker의 실제 원본 normalizer → 별도 UI projection으로 전달했다. 패키지의 실제 forwarder 실행 파일도 fixture stdin과 private registry로 검사했다. 이를 실제 Claude Hook 호출·Mac 실행 성공으로 해석하지 않는다.

## Hook 예상 변경과 복구

읽기 전용 `hooks:plan`은 실제 대상 Mac에서 다시 실행해야 한다. 현재 Linux 예시는 `artifacts/p2-cloud-hook-plan.json`에 있다. 경로가 다르므로 그대로 Mac에 적용하지 않는다.

예상 변경: `~/.claude/settings.json`의 12개 이벤트 배열에 Orbit command를 추가하고 기존 항목을 보존한다. 별도 승인 후 설치 직전 원본을 `~/.orbit-works/backups/settings.<timestamp>.json`에 bytes/mode/hash와 함께 백업해야 한다. 전용 sender는 `<checkout>/dist/claude-forwarder.cjs`, 수신기 registry는 `~/.orbit-works/runtime/receiver.json`이다. 이번에는 settings·backup 파일을 생성하지 않았다. 기존 `.claude/scripts/`, `.claude/omp/`, `~/.omp/`나 `.pixel-agents` Hook을 교체하지 않았다.

원본 파일이 있으면 설치 직후 hash와 현재 hash가 일치하는 경우에만 원본 bytes/mode의 원자적 복구를 검토한다. 이후 다른 편집이 있으면 전체 backup으로 덮어쓰지 않고 이번에 추가한 정확한 Orbit 항목만 제거한다. 원래 파일이 없었더라도 다른 새 설정이 있으면 파일을 지우지 않는다. 상세 절차·승인 게이트는 Mac 문서에 있다. **실제 install/apply/restore 도구는 제공하지 않으며 설치·복구는 아직 실행하지 않았다.**

## Commit과 배포 상태

P1까지의 파일이 전부 untracked이고 저장소가 unborn이었으므로 P1 기준을 `bb039cb893a8dc88d28ce0a597880b7190c2ffea`로 먼저 기록했다. P2 변경은 별도 커밋으로 남긴다. 정확한 전달 SHA·로컬 clone 재현 SHA는 `git log`와 `artifacts/p2-clean-clone.json`을 확인한다. 전달용 `artifacts/orbit-works-p2a.bundle`에는 로컬 커밋 이력을 포함하며 dependencies·credentials는 포함하지 않는다.

GitHub HTTPS 읽기는 가능했지만 원격 heads는 비어 있었다. 이 작업은 **원격 push하지 않았다**. 따라서 GitHub에서 현재 P2 SHA를 내려받는 검증은 원격 게시가 선행되어야 한다. Mac용 수동 CI workflow도 준비했으나 GitHub에서 실행하지 않았다. CI runner의 실제 architecture는 로그로 확인해야 하며 workflow 파일 존재가 Apple Silicon 검증을 뜻하지 않는다.

## 변경 파일

| 역할 | 추가·수정 파일 |
|---|---|
| 의존성·이식 | `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`, `vendor/upstream-lock.json`, 원본 381파일 `vendor/pixel-agents/**` |
| 설치·무결성 | `scripts/setup.mjs`, `setup-environment.sh`, `verify-vendor.mjs`, `assets.ts`, `test-upstream.mjs` |
| 수집 준비 | `server/app.mjs`, `server/receiver.mjs`, `server/claude-input.mjs`, `server/claude-worker.ts`, `scripts/build-worker.mjs`, `scripts/claude-forwarder.mjs` |
| 진단·계획 | `scripts/doctor.mjs`, `scripts/hooks-plan.mjs` |
| UI | `src/ConnectionPanel.tsx`, `src/App.tsx`, `src/style.css`, 기존 엔진 import 경로를 바꾼 `Canvas.tsx`, `engine.ts`, `layout.ts` |
| 검증·CI | `tests/connection.integration.mjs`, 기존 경로를 바꾼 `tests/office.test.ts`, `scripts/browser-check.mjs`, `scripts/connection-browser.mjs`, `.github/workflows/mac-readiness.yml` |
| 문서 | `README.md`, `docs/MAC-SETUP.md`, `docs/ADAPTERS-AND-REMOTE.md`, `docs/ASSETS.md`, 이 보고서 |

전체 목록은 `git diff --name-status bb039cb HEAD`, 원본 vendor 파일별 hash는 manifest로 확인한다. 테스트 로그·스크린샷·bundle·생성 dist는 git 제외 산출물이다.

## 남은 작업과 중단 지점

1. 새 Mac의 darwin/arm64, Node 22 설치·build·브라우저를 실제 검증한다.
2. Mac의 실제 settings에서 다시 생성한 Dry-run·backup·복구 계획을 검토하고 **별도 승인**을 받는다. 아직 설치하지 않는다.
3. 승인 뒤 실제 Claude 세션과 수집 패널을 대조하고 실패·재시작·복구 결과를 기록한다.
4. 현재 수신기는 hook-only 준비 단계다. transcript fallback·자식별 상관관계·persistent namespace·dedup/replay·장기 상태 복구는 미구현이다. source live는 전송 분류이며 실제 실행의 증명이 아니다.
5. DeepSeek/OpenCode/Hermes는 실제 Adapter나 위임 스크립트를 변경하지 않았다. 구현 순서는 [ADAPTERS-AND-REMOTE.md](ADAPTERS-AND-REMOTE.md)를 따른다.
6. 모바일 Tailscale Serve는 설계만 했다. 현재 Host/Origin 정책은 tailnet hostname을 거부하므로 실제 적용 전 별도 인증·TLS·ACL·proxy 경계를 검토해야 한다. 공개 포트/Funnel은 허용하지 않는다.
7. GitHub 원격 게시, Mac 실환경, 환경 snapshot 게시·새 태스크 복원은 아직 검증하지 않았다.

클라우드에서 준비할 작업 결과를 제출하고 여기서 멈춘다. 실제 연결을 검증 완료로 표시하지 않는다.
