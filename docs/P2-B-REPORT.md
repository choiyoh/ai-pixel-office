# P2-B 최종 보고 — OMP Provider 통합과 동시 관찰

## 0. 결론

**P2-B.1 ~ P2-B.6 ④ 전 항목이 완료**됐다. 한 대의 Mac에서 Claude Code와 OMP(DeepSeek)가 **동시에 같은 사무실에 표시**되고, 둘 사이의 **실제 위임 관계**가 암호학적 증명으로 연결되며, OMP 실행은 **내구성 있는 큐**를 거쳐 손실 없이 전달되고, **세션이 실행 간 이어지고**(resume), **Windows에서도 실 모델 왕복까지** 동작한다.

이 문서는 마일스톤 단위 요약과 검증 범위(그리고 **주장하지 않는 범위**)를 남긴다. 세부 근거는 각 항목의 개별 문서가 우선한다.

## 1. 마일스톤 요약

| 항목 | 내용 | 코드 | CI |
|---|---|---|---|
| B.1 | 별도 Provider Bridge, provider 인증/신원, durable receipt·reorder/dedup·terminal·role/delegation 계약 기반 | `f6562b32` | [39035643861](https://github.com/choiyoh/ai-pixel-office/actions/runs/39035643861) |
| B.2 | 실제 OMP 18.10.0 JSON supervisor, Command Code→DeepSeek 확인, 전역 위임 연결 | `e7ccdb62` | [39050396185](https://github.com/choiyoh/ai-pixel-office/actions/runs/39050396185) |
| B.3 | Live OMP 채널·신원/좌석 분리·native Read 화면·offline/reconnect/Mock 복귀 | `4f07e4c9` | [39053766035](https://github.com/choiyoh/ai-pixel-office/actions/runs/39053766035) |
| B.4 | private Outbox·별도 worker·receipt 확인 재전송·원래 관찰 시각 보존·운영 송신기 교체·두 서버 재시작 | `ca627c56` | [39113460790](https://github.com/choiyoh/ai-pixel-office/actions/runs/39113460790) |
| B.5 | Outbox 운영: 읽기 전용 status·recovery 힌트·archive 도구, 웹 적용 | `a02aca5`+`636df55` | [39132147816](https://github.com/choiyoh/ai-pixel-office/actions/runs/39132147816) |
| B.6 ① | relay↔executor correlation: `parentExecution`(pid/birth HMAC) · ledger v3 · UI 위임 출처 | `f153a2d`+`0650e3f` | [39135067830](https://github.com/choiyoh/ai-pixel-office/actions/runs/39135067830) |
| B.6 ② | 동시 provider scene: 읽기 전용 `/api/scene/snapshot`(OMP engine key `+1_000_000`), 위임 링크·"대상 보기" | `0fa83da`+`b67bd9d` | [39173148512](https://github.com/choiyoh/ai-pixel-office/actions/runs/39173148512) |
| B.6 ③ | OMP Resume·실제 Edit: 3모드 착수 계약·세션 신원 안정화(설치 단위 salt)·durable 큐 resume 수락 | `4d1a45d`+`f7f741b`+`b8e84a0` | [39181391934](https://github.com/choiyoh/ai-pixel-office/actions/runs/39181391934)·[39183152373](https://github.com/choiyoh/ai-pixel-office/actions/runs/39183152373) |
| B.6 ④ | Windows native: `omp.exe`(bun 셰임)·셸 없는 3형태 스폰·**실 모델 왕복 성공** | `1159259`+`cffae79` | [39186534438](https://github.com/choiyoh/ai-pixel-office/actions/runs/39186534438)·[39218889897](https://github.com/choiyoh/ai-pixel-office/actions/runs/39218889897), 3-OS 회귀 [39219185410](https://github.com/choiyoh/ai-pixel-office/actions/runs/39219185410) |

## 2. 실제로 실증된 것 (운영 스택)

- **동시 표시**: 한 화면에 Claude actor와 OMP actor가 동시에 뜨고, 위임 링크(`Claude · 020` → `OMP · 011`, "대상 보기" 이동)가 실화면에서 확인됨(B.6②, `artifacts/scene-live-unified.png`).
- **위임 증명**: Claude의 조상 실행 증명과 OMP `session.start`의 `parentExecution`이 같은 HMAC으로 대조될 때만 위임 출처가 표시됨(이름·프롬프트 유사도 사용 안 함).
- **무손실 전달**: Bridge가 거부한 이벤트는 outbox에 남고 replay로 전달됨(실측: `delivered:5, pending:0`).
- **세션 연속성**: 저장 실행 → resume이 **같은 세션·같은 actor**로 이어지고 generation 1→2가 Bridge ledger에 기록됨(운영 4183).
- **실제 편집**: resume 실행에서 OMP의 edit 도구가 파일을 실제로 수정함(`orbit resume works` → 2줄).
- **Windows**: OMP가 `omp.exe`(bun 셰임)로 설치·실행되고, 옵저버가 셸 없이 3형태 모두 스폰하며, 실 Command Code 키로 **왕복 성공**(4/4 스폰 + 2/2 직접 실행: `exit 0`, `[session.start, turn.end, execution.end]`, 출력 `OK`). macOS 대조군도 동일.

## 3. 운영 적용 상태

| 서비스 | PID | 포트 | 적용 시점 |
|---|---:|---:|---|
| 웹/Claude receiver | **57593** | 4173 | 2026-10-19 07:55 KST (② 적용) |
| OMP Provider Bridge | **90172** | 4183 | 2026-10-19 09:12 KST (③ 적용, ledger `53efa927` 유지) |

- 워크플로우 정의: Claude Code `omp-deepseek` → `scripts/observe-omp-durable.mjs` → OMP → Command Code → DeepSeek. **ephemeral(`--no-session`) 유지** — 저장/resume은 지원되지만 위임 기본값은 아직 아니다(정의 변경은 별도 승인 범위).
- Hook·전역 설정·자격증명: 무변경(해시 불변 유지).

## 4. 검증하지 않은 것 (경계)

- **리눅스 native**: 우선순위 아님(사용자 지시). 프로브 매트릭스에 `ubuntu-latest` 한 줄을 더하면 같은 증거가 나온다.
- **실 Windows 데스크톱 사용자의 로그인 셸·전역 설정**: 러너의 Windows 커널에서 검증했고, 개인 워크스테이션 조건은 주장하지 않는다.
- **세션 import/extension/profile**: 의도적 미지원(거부) — 계약이다.
- **업무 단위 중복 제거**(두 provider actor를 하나로 합치기): 비목표로 남김(② 문서).
- **상주 daemon/로그인 자동 시작**: 미설치.
- **원격/다중 머신 모니터링**: 미구현(loopback 전용 유지) — `docs/ADAPTERS-AND-REMOTE.md` 참조.

## 5. 재현

```bash
# 로컬 전체 회귀 (단위·통합·lint·typecheck·build)
npm test && npm run test:integration && npm run lint && npm run typecheck && npm run build

# 브라우저 7종 (dist를 서빙하므로 build 후)
npm run build && npm run test:browser && npm run test:connection-browser && npm run test:live-browser \
  && npm run test:p2a4-browser && npm run test:omp-office-browser && npm run test:omp-outbox-browser \
  && npm run test:scene-browser

# 3-OS CI (기본 브랜치에 워크플로우가 있으므로 dispatch 가능)
gh workflow run cross-platform.yml --ref <branch>

# Windows/macOS native OMP 프로브 (자기 파일을 건드리는 push로 트리거)
gh run download <run-id> -n omp-native-probe-windows-latest -D ./probe-win
```

## 6. 남은 선택지 (참고)

1. 다중 adapter 병렬/충돌/재연결 검증(fake adapter 2개) — `ADAPTERS-AND-REMOTE.md` 구현 순서 6번.
2. 원격 모니터링 경계 설계(다른 머신의 에이전트 표시).
3. 저장/resume을 위임 기본값으로 승격(정의 Diff + 승인).
4. 리눅스 native 검증(프로브 한 줄).
5. 정리: outbox archive, fault injection 보강, vendored upstream 갱신.
