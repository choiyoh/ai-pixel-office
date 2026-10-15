# Orbit Works · AI Pixel Office

기존 Pixel Agents 엔진을 재사용하는 커스텀 도트 사무실. 현재 버전은 **P2-A Mac 연결 준비**이며 실제 Mac·Claude 연동 검증은 아직 완료되지 않았다.

## 빠른 시작

사용자가 준비한 Node 22(.nvmrc: 22.23.3)와 Git이 필요하다. 전역 패키지나 기존 사용자 설정을 자동 변경하지 않는다.

```bash
npm ci --no-audit --no-fund
npm run setup
npm run build
npm run doctor
npm start
```

기본 실행은 Mock이고 Fastify는 127.0.0.1:4173에만 바인딩한다. `vendor/pixel-agents`에 고정 upstream을 포함하므로 형제 checkout이나 `/workspace` 경로가 필요하지 않다. `npm run verify:vendor`로 원본 파일 381개의 hash를 확인한다. 새 Mac/GitHub/bundle 절차와 검증 기준은 [MAC-SETUP.md](docs/MAC-SETUP.md)에 있다. GitHub 원격에는 아직 이 로컬 커밋을 push하지 않았다.

## 연결 준비

`npm run hooks:plan`은 **읽기 전용 Dry-run**이다. 실제 settings의 추가 구간 Diff·hash·예상 backup 위치만 출력하며 쓰기는 하지 않는다. 실제 Mac에서 검토하고 별도 승인을 받기 전에는 Hook을 설치하지 않는다. `ORBIT_MODE=claude-local npm start`는 전용 수신기를 열고 사용자 전용 runtime registry를 만들지만 Hook은 설치하지 않는다. 실제 Mac에서 이 실행도 먼저 검토한다.

기존 Claude Provider의 정규화는 별도 worker에서 재사용한다. sender와 receiver는 민감 필드를 제거한다. 수집된 세션은 Mock Canvas와 분리된 패널에 보이고 실제 환경·최근 이벤트 시각·실환경 미검증 상태를 표시한다. 실제 연결 준비의 한계와 복구 절차는 Mac 문서를 따른다.

## 검증

```bash
npm run lint
npm test
npm run test:integration
npm run test:upstream
# 선택한 브라우저를 프로젝트 캐시에 설치할 경우
export PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/ms-playwright"
npx playwright install chromium
# 별도 터미널에 Mock npm start를 켠 상태
npm run test:browser
# fixture 서버를 직접 시작·종료하는 연결 UI 검사
npm run test:connection-browser
```

시스템 Chromium을 쓸 때는 `ORBIT_BROWSER_EXECUTABLE`에 실행 파일을 지정한다. 원본 테스트는 임시 HOME에서 원본 compile 후 실행한다. 통합 테스트는 사용자 settings에 Hook을 설치하지 않으며 합성 fixture를 실제 Mac 증거로 사용하지 않는다. 화면과 JSON은 `artifacts/`에 저장된다.

## 사무실 기능

6종 캐릭터, 팀별 업무 구역, QA·회의실·휴게실, 상태 시연, 필터·inspector·timeline, 줌·좌석 이동을 지원한다. 캐릭터나 카드를 선택하고 빈 좌석을 클릭하면 기존 BFS를 따라 이동한다. layout과 좌석은 같은 origin의 localStorage에 보존된다. 에이전트/업무 이력은 페이지 내 Mock 세션 기준이고 새로고침하면 초기 roster로 돌아간다. 완료 수는 고유 완료 Mock 이벤트의 당일 건수다.

## 문서

- [P2-A 결과·커밋·검증 경계](docs/P2-A-REPORT.md)
- [Mac 설치·Hook Dry-run·복구](docs/MAC-SETUP.md)
- [Adapter 구현 순서와 사설 원격 접근 설계](docs/ADAPTERS-AND-REMOTE.md)
- [P1-B 원본 아키텍처 제안](docs/P1-B-ARCHITECTURE.md)
- [P1 구현 당시 결과](docs/P1-REPORT.md)
- [에셋 출처와 라이선스](docs/ASSETS.md)

실제 Hook 설치·다른 Provider 연결·Tailscale 설정·인터넷 공개·원격 배포는 별도 승인 범위다. Cloud localhost와 Mac localhost는 서로 연결되어 있다고 가정하지 않는다.
