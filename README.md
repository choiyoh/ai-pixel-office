# Orbit Works · AI Pixel Office

Pixel Agents 엔진을 그대로 사용하는 AI 개발회사 테마의 **Mock 전용 독립형 웹 앱**. P1-A 구현과 P1-B 설계 결과이며 실제 Provider 연결·Hook 설치·원격 배포는 포함하지 않는다.

## 실행

Node 22.23.3과 인접한 `/workspace/pixel-agents-p0` 원본 체크아웃이 필요하다. 원본 SHA는 `d1e007a9fdf3003c252d2973abe1999ae59aec33`이다. 이 클라우드는 이미 격리되어 있으므로 추가 worktree를 만들 필요가 없다.

```bash
export PATH=/workspace/p0-tools/node_modules/.bin:$PATH
export npm_config_cache=/workspace/.npm-cache
cd /workspace/pixel-agents-p0
HUSKY=0 npm ci --no-audit --no-fund
npm run compile
cd /workspace/ai-pixel-office
npm ci --no-audit --no-fund
npm run build
npm run lint
npm test
npm start
```

Fastify는 127.0.0.1:4173에만 바인딩한다. 내부 health 경로 `/api/health`는 `mode=mock-only`, `providersConnected=0`을 반환한다. 실제 API key나 Claude CLI가 필요하지 않다. 서버는 정적 파일과 health만 제공하며 업무 이벤트 endpoint는 없다. 작업 중 UI 개발은 `npm run dev`로 할 수 있다.

브라우저 자동 검증은 서버를 실행한 뒤 `npm run test:browser`를 실행한다. 현재 머신의 `/usr/bin/chromium`이 필요하다. 실행 결과와 데스크톱·모바일 스크린샷은 `artifacts/`에 생성된다. 원본 테스트는 `node /workspace/p0-evidence/run-isolated.cjs npm test`로 원본 checkout에서 실행해 사용자 홈과 분리한다.

## 사용

캐릭터 또는 하단 카드를 선택하고 상태 시연 버튼을 누르면 명시적인 Mock 이벤트가 적용된다. 시나리오 재생은 약 16초 동안 전체 상태를 시연하며 중지·초기화할 수 있다. 초기화는 Mock roster와 이벤트만 초기화한다. 팀·프로젝트 필터는 사무실·카드·통계·timeline에 적용되며 다른 에이전트를 종료하지 않는다.

빈 좌석을 클릭하거나 inspector의 좌석 목록을 사용하면 기존 BFS 경로로 이동하고 사무실 레이아웃과 좌석을 localStorage에 저장한다. QA·회의실·휴게실에도 좌석이 있다. 이 버전에는 가구 편집 UI가 없다. 레이아웃·좌석은 같은 origin의 브라우저에서 유지되며 서버 동기화는 없다. 개발/dev와 production origin의 저장소는 서로 다르다.

상단 완료 수는 현재 페이지 세션에서 받은 고유 완료 Mock 이벤트의 오늘 건수다. 업무·실행 시간·timeline은 시연용이며 새로고침 시 초기 roster로 돌아온다. 자동 타이머로 업무 성공을 추정하지 않는다. 연결 끊김 Mock은 캐릭터를 정지·비활성화한다. 원본 sprite cache에는 정수 배율로 렌더링한 뒤 완성된 scene을 nearest-neighbor로 화면에 맞춘다.

## 구조

- `src/App.tsx`, `style.css`: 대시보드·필터·inspector·timeline.
- `src/Canvas.tsx`, `engine.ts`: 기존 엔진 API를 호출하는 얇은 어댑터. 원본 Provider는 import하지 않는다.
- `src/layout.ts`: 팀별 floor plan·좌석·저장 검증.
- `src/model.ts`, `mock.ts`: Mock 모델과 재생기. 실제 live 데이터와 혼합하는 경로가 없다.
- `scripts/assets.ts`, `public/characters/`: 원본 커스텀 캐릭터와 에셋 생성.
- `server/app.mjs`: loopback 정적 서버.
- `tests/office.test.ts`, `scripts/browser-check.mjs`: 상태·경로·동시 실행 및 실제 브라우저 검증.

설계와 결과는 [P1-B 아키텍처](docs/P1-B-ARCHITECTURE.md), [P1 결과](docs/P1-REPORT.md), [에셋 출처](docs/ASSETS.md)를 참고한다. 이번 단계는 여기서 멈추며 실제 연결과 P2는 별도 승인 대상이다.
