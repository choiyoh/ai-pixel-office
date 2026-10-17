# Orbit Works · AI Pixel Office

Pixel Agents 엔진을 재사용하는 AI 도트 사무실. **P2-A.2 합성 Live Canvas 구현** 단계다. 실제 Claude 연결이나 모든 OS의 검증 완료를 뜻하지 않는다.

Node 22 LTS와 Git을 사용한다. `.nvmrc`는 22.23.3이며 upstream의 Node 22와 호환된다. Electron/Tauri 또는 전역 npm 패키지는 필요하지 않다.

```text
git clone https://github.com/choiyoh/ai-pixel-office.git
cd ai-pixel-office
git switch work
npm ci --no-audit --no-fund
npm run setup
npm run build
npm run doctor
npm start
```

Windows PowerShell에서는 위 `npm`을 `npm.cmd`로 실행한다. 전체 설치·빌드는 `npm run bootstrap`으로도 가능하다. 클라우드 실행 시 `ORBIT_ENVIRONMENT=cloud-development`로 환경 이름을 명시할 수 있다(표시는 인증 증거가 아니다). 기본값은 Mock, 서버는 127.0.0.1:4173에만 바인딩한다. 종료는 해당 터미널에서 Ctrl+C다. 공통 React UI를 사용하며 실제 연결 상태·OS/아키텍처·최근 수집 시각을 별도 패널에 표시한다.

- [macOS 설치](docs/install/macos.md)
- [Windows 네이티브 / WSL 설치](docs/install/windows.md)
- [Linux 설치](docs/install/linux.md)
- [P2-A.1 Windows ACL 수정·CI 검증](docs/P2-A.1-WINDOWS-CI.md)
- [P2-A.2 Live Canvas 구현·검증](docs/P2-A.2-IMPLEMENTATION.md)
- [P2-A.3 실제 Mac 검증 계획·Hook 예상 Diff](docs/P2-A.3-VALIDATION-PLAN.md)
- [크로스플랫폼 검증 결과와 남은 작업](docs/P2-A-CROSS-PLATFORM.md)
- [운영체제 의존성 조사](docs/CROSS-PLATFORM-AUDIT.md)
- [Command Code 공식 계약·로컬 설치 조사](docs/COMMAND-CODE.md)
- [P2-B.1 Provider Bridge 기반과 검증 범위](docs/P2-B.1-PROVIDER-BRIDGE.md)
- [Adapter 및 사설 원격 연결 설계](docs/ADAPTERS-AND-REMOTE.md)

`npm run hooks:plan`은 기존 설정을 읽고 **추가 예정 Diff와 hash만 출력**한다. apply/export 기능이 없으며 파일을 쓰지 않는다. 실제 대상 OS에서 다시 생성하고 별도 승인을 받기 전 Hook을 설치하지 않는다. 기존 사용자 설정·DeepSeek 위임 스크립트·OMP는 수정하지 않는다.

```text
npm run verify:vendor
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run test:smoke
npm run test:upstream
npx playwright install chromium
npm run test:browser
npm run test:connection-browser
npm run test:live-browser
```

브라우저 검사는 자체 fixture 서버를 시작·종료한다. 시스템 Chromium은 `ORBIT_BROWSER_EXECUTABLE`로 선택할 수 있다. 결과와 화면은 `artifacts/`에 저장된다. Hook fixture는 실제 Claude 세션 증거가 아니다. CI는 Windows/macOS/Linux matrix를 구성하며 실행 전에는 통과로 판정하지 않는다.

6종 캐릭터, 개발·분석·연구·운영 구역, QA·회의·휴게 공간, 상태 시연, 필터·inspector·timeline, 줌·좌석 이동을 제공한다. 엔진 BFS/애니메이션을 재사용한다. 레이아웃과 좌석은 같은 origin의 localStorage에 보존되며 Mock roster는 새로고침하면 초기화된다. 상단 LIVE OFFICE에서 인증된 SessionStart 기반 세션을 별도 Live Store/OfficeState로 표시한다. Mock 서버의 Live 탭은 연결 준비 필요·0명이다. 합성 source는 TEST FIXTURE로 구분하며 실제 Claude 실환경 검증은 P2-A.3에서 별도로 수행한다.

`vendor/pixel-agents`는 upstream `d1e007a9fdf3003c252d2973abe1999ae59aec33`의 원본 파일 381개를 hash로 검증한다. 형제 checkout이나 특정 사용자 경로 없이 실행한다. [에셋 출처](docs/ASSETS.md), [P1 아키텍처](docs/P1-B-ARCHITECTURE.md), [이전 P1 결과](docs/P1-REPORT.md), [이전 Mac 준비 결과](docs/P2-A-REPORT.md)는 이력을 보존한다. 현재 요구사항은 크로스플랫폼 문서를 우선한다.

실제 Hook 설치·외부 Provider 통합·Tailscale 설정·공개 포트·원격 배포는 이번 범위에 없다. 클라우드와 각 로컬 머신의 localhost는 별개다.
