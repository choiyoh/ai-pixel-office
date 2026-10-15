# AI Pixel Office — P1-A 구현 / P1-B 설계 결과

**P1-A 구현과 P1-B 설계를 완료했다. 실제 Provider 통합·Hook 설치·DeepSeek 스크립트 변경·원격 배포·P2 작업은 수행하지 않았다.**

## 화면

![Orbit Works 데스크톱](../artifacts/office-desktop.png)

- [시나리오 종료 화면: 완료·실패·연결 끊김](../artifacts/office-scenario.png)
- [연결 끊김 상태 점검](../artifacts/office-disconnected.png)
- [390px 모바일 화면](../artifacts/office-mobile.png)
- [브라우저 검증 JSON](../artifacts/browser-result.json)

스크린샷은 실제 Chromium으로 로컬 Fastify에서 제공한 production build를 열어 촬영했다. UI의 데이터와 상태는 전부 Mock이다.

## 구현한 기능과 범위

| 항목 | 구현 내용 | 실제/Mock 구분 |
|---|---|---|
| 사무실 | 개발팀, 분석팀, 연구팀, 운영팀, 공용 회의실, QA와 커피 휴게 공간. 팀·QA·회의실·휴게실 좌석 간 BFS 접근 가능 | 실제 layout/좌석/이동 엔진. 업무 데이터만 Mock |
| 캐릭터 | 머리·의상·액세서리가 다른 원본 캐릭터 6종. 정확한 112×96 PNG / 16×32 프레임 / 7×3 규격 | 직접 제작한 실제 PNG. 공급자 공식 캐릭터는 아님 |
| 애니메이션 | 원본 엔진의 걷기·타이핑·읽기·말풍선·spawn/despawn. 완료 confetti, 실패 아이콘, offline 정지·비활성 오버레이 추가 | 모든 업무 상태는 명시적 Mock 이벤트로만 변경 |
| 업무 상태 | coding/analysis/testing/approval/idle/completed/failed/disconnected 8종. 테스트는 QA 좌석, 유휴는 휴게 좌석으로 이동 | 실제 코드와 시연 재생기. 실제 업무 성공/실패를 뜻하지 않음 |
| 대시보드 | 필터에 따른 작업 중·승인 대기·오늘 완료 Mock 이벤트 수, 실행 시간, 팀·프로젝트·현재 작업·출처 표시 | 지표와 실행 시간은 페이지 내 Mock 세션 기준 |
| 조작 | Canvas 캐릭터/카드 선택, 좌석 선택·이동, 확대/축소, 프로젝트/에이전트 필터, 타임라인, 시나리오 재생·정지·초기화·제거 | 실제 브라우저 기능 |
| 저장 | 전체 사무실 layout과 agent별 좌석을 같은 origin의 localStorage에 저장하고 새로고침 시 복구 | 실제 로컬 저장. 서버 동기화·가구 편집 UI는 없음 |
| 서버 | Fastify가 production SPA·에셋과 health 제공. loopback에만 바인딩 | 실제 서버. live 이벤트 ingress/Provider 연결 endpoint는 없음 |

실제 연결 데이터가 들어오는 경로 자체를 이번에는 만들지 않았다. 상단 `MOCK SANDBOX`와 `실제 연결 0개`, inspector의 MOCK/Mock 재생기, 타임라인의 MOCK 표시가 이를 구분한다. 실제 상태가 없는 것을 실연결로 표시하거나 도구 이름만으로 완료를 추측하지 않는다.

## 엔진 재사용과 라이선스

기존 `/workspace/pixel-agents-p0`의 커밋 `d1e007a9fdf3003c252d2973abe1999ae59aec33`에서 OfficeState, characters FSM, gameLoop, renderer, BFS, 좌석·가구 catalog·sprite decoder/cache를 직접 import한다. 업스트림의 추적 파일·Provider·Runtime·테스트·lockfile은 변경하지 않았다. 앱은 별도 `/workspace/ai-pixel-office`에 있다.

화면에 맞추는 소수 배율에서 원본 sprite cache의 개별 픽셀 경계가 흐려지는 것을 발견했다. 원본을 고치지 않고 정수 2배 scene buffer에 원본 renderFrame으로 그린 뒤 전체 장면을 nearest-neighbor로 맞추는 wrapper를 적용했다. 이동·좌석·애니메이션 로직은 계속 원본을 사용한다.

캐릭터와 두 floor 패턴은 직접 제작한 MIT 에셋이다. 가구·벽·엔진은 원본 MIT 고지를 `public/THIRD-PARTY-NOTICES.txt`에 보존했고 배포 dist에도 포함한다. 별도 유료 에셋이나 외부 CDN/font를 사용하지 않는다. 자세한 출처·캐릭터별 특징은 [ASSETS.md](ASSETS.md)에 있다.

## 검증 결과

환경은 Linux x64, Node 22.23.3, npm 11.9.0, React 19.2.5, TypeScript 5.9.3, Fastify 5.8.5, Vite 8.0.8, Chromium 154다. 로컬 일자·타임라인 기본 timezone은 클라이언트 기준 UTC+9(`Etc/GMT-9`)다.

| 검사 | 결과 |
|---|---|
| `npm run build` | 성공. 에셋 생성 + UI/테스트 타입 검사 + production Vite build |
| `npm run lint` | 성공. 커스텀 앱 오류 0, 경고 0 |
| `npm test` | 앱 수락 단위 테스트 **5개 통과**, 실패·skip 없음 |
| 원본 `npm test` | 웹 UI 86 + 서버 550 + 패키지 계약 7 = **643개 통과**, 실패·skip 없음 |
| 브라우저 자동화 | 성공. Canvas 실제 actor 6개, 8개 상태, offline 위치 고정, 필터, 줌 후 Canvas 비어 있지 않음, 제거 후 actor 5개, 복원 6개, 16초 시나리오 완료, 저장/새로고침, 데스크톱/모바일 |
| 브라우저 오류 | pageerror 0, HTTP 4xx/5xx 0, 모바일 가로 overflow 없음 |
| 경로·동시성 | 실제 engine으로 actor 6개를 60초 모의 update 후 모두 작업 상태에 도달. 팀·QA·회의실·휴게실의 좌석 접근 경로 존재 |
| 사용자 설정 | 보호 대상 Claude/OMP 경로의 실행 전후 존재·해시 snapshot 일치 |
| 재현 설치 | `scripts/setup-environment.sh`: 고정 Node, 두 checkout의 npm ci와 build 전체 재실행 성공 |

앱 테스트는 PNG 규격·서로 다른 캐릭터, 모든 가구 id 존재·좌석 연결, 6 actor의 실제 engine 작업/대기/제거, Mock lifecycle/dedup, layout 복구를 검사한다. UI 카드 개수만 확인한 결과가 아니다. 원본 전체 VS Code/Electron E2E나 실제 Claude 세션 검증을 수행했다고 주장하지 않는다.

초기 검사에서 잘못 지정한 모니터 id `MONITOR_FRONT_OFF`를 발견해 실제 catalog의 `PC_FRONT_OFF`로 수정했다. 초기 의존성 설치의 ESLint 10과 react-hooks 7.0.1 peer 충돌은 ESLint 10을 지원하는 react-hooks 7.1.1로 정정하고 lockfile에 고정했다. 원본 compile에는 P0와 같은 기존 App.tsx 의존성 경고 1개가 남지만 커스텀 앱 Lint는 경고 없이 통과했다.

상세 로그는 `/workspace/p0-evidence/p1-build.log`, `p1-lint.log`, `p1-tests.log`, `p1-upstream-tests.log`, `p1-browser.log`, `p1-setup-repeat.log`에 있고 JSON·화면은 이 프로젝트 `artifacts/`에 있다. 로그·화면·dist·생성 JSON은 git 제외 생성물이며 snapshot 파일로 보존된다.

## 새 파일 목록

기존 프로젝트가 빈 저장소여서 아래는 모두 신규 파일이다. 업스트림 파일 수정은 0개다.

| 역할 | 파일 |
|---|---|
| 앱 UI | `src/App.tsx`, `src/style.css`, `src/main.tsx` |
| 엔진 wrapper | `src/Canvas.tsx`, `src/engine.ts` |
| layout·Mock 모델 | `src/layout.ts`, `src/model.ts`, `src/mock.ts` |
| 에셋 | `scripts/assets.ts`, `public/characters/char_0.png`부터 `char_5.png`, `public/THIRD-PARTY-NOTICES.txt` |
| 실행·검증 | `server/app.mjs`, `tests/office.test.ts`, `scripts/browser-check.mjs`, `scripts/setup-environment.sh` |
| 빌드·도구 | `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `index.html`, `.nvmrc`, `.gitignore` |
| 문서·라이선스 | `README.md`, `LICENSE`, `docs/ASSETS.md`, `docs/P1-B-ARCHITECTURE.md`, `docs/P1-REPORT.md` |

## P1-B 권장 아키텍처

**Provider별 프로세스를 격리하는 Bridge 방식**을 권장한다. 현재 Runtime의 singleton Provider와 module-level watcher/parser 의존성을 그대로 둔 상태에서 같은 프로세스에 여러 Runtime을 생성하는 방식은 피한다. Bridge intake에서 인증과 strict schema를 검사하고 durable ledger에 기록한 뒤 UI projection을 만든다. 각 Provider worker는 한 context만 갖고 원본 UI 메시지/엔진 경계에 연결한다.

provider/installation/session의 tuple namespace, 재연결과 독립적인 execution 신원, Haiku relay와 DeepSeek executor의 구분, task/parent/delegation/toolCall 상관관계, sequence·dedup·snapshot/replay·unknown freshness, 인증·민감정보 allowlist 설계와 두 방식의 비교를 [P1-B 설계 문서](P1-B-ARCHITECTURE.md)에 정리했다. **이 설계의 Bridge·event API·실제 Provider 코드는 구현하지 않았다.**

## 실제 Claude 연결의 별도 승인 절차

대상 머신의 CLI·인증·실세션을 확인하고 가능한 Hook 없는 heuristic부터 검증한다. Hook이 필요하면 `~/.claude/settings.json`의 12개 이벤트 항목, `~/.pixel-agents/hooks/claude-hook.js`, 관련 Pixel Agents consent/config/registry의 정확한 변경 목록·비밀을 가린 예상 Diff·원본 bytes/mode 백업·원복 절차를 **먼저 제시하고 승인을 받는다**. 기존 다른 Hook과 OMP 설정은 보존한다.

승인 후에만 적용하고 Read/Write·입력/승인 대기·실제 foreground/background 자식·병렬 실행·Stop/SessionEnd·재연결을 서버와 화면에서 확인한다. 성공 결과는 이번 Mock 증거와 별도로 기록한다. 상세 체크·복구 절차는 P1-B 문서 마지막 절에 있다. 이번에는 실제 Hook 설치나 설정 변경을 하지 않았다.

## 잔여 제한과 P2 판정

- **P2 설계·구현 착수는 조건부 가능**하다. UI·엔진 재사용·Mock 수락 기준은 충족했다. 실제 연동이 동작한다는 운영 Go 판정은 아직 할 수 없다.
- 실제 Claude·DeepSeek·Hermes·OpenCode 연결, 실제 네트워크 장애/replay, 실제 병렬 서브에이전트는 미검증이다.
- 앱은 고정 upstream checkout에 의존한다. 단일 폴더 배포 패키지화와 업스트림 업데이트 호환 검사는 후속 과제다. build는 SHA mismatch를 거부한다.
- 레이아웃은 같은 브라우저 origin에만 보존된다. 에이전트·업무 이력·완료 통계는 세션 단위 Mock이며 공유 영구 저장은 없다. timeline은 최근 1,000개로 제한한다.
- 가구 편집·drag pan·서버 동기화·실제 live WebSocket gateway는 이번 UI에 없다. 확대·축소와 좌석 이동은 구현했다.
- 직접 제작한 16×32 그림은 요구 규격과 애니메이션을 충족하지만 아트 품질과 추가 포즈는 사용자 검토 후 다듬을 수 있다.

현재 Claude/OMP 설정은 변경하지 않았고, 원격 push·배포도 하지 않았다. 재사용 설치/시작 지침을 환경 초안에 저장하는 것은 환경 게시나 실제 외부 연동 승인이 아니다. 환경 초안의 install_script와 start_skill 저장은 성공했다. 환경 설정에서 검토·저장 후 게시해야 재사용 설정이 활성화된다. 게시와 새 태스크 복원은 아직 검증하지 않았다. P1 결과를 보고하고 멈춘다.
