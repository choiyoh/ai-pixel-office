# P2-B.6 ② 동시 provider scene — 설계안 (승인용 초안)

> **상태: 제안.** 코드 변경·서버 재시작은 없습니다. 이 문서는 승인 게이트를 위한
> 설계 비교이며, 승인 후에도 1단계 구현·격리 검증·정확한 Diff 제출까지가 1차 범위입니다.
> 기존 채널 전환 모드는 그대로 유지합니다.

## 1. 목표와 비목표

**목표**: Claude 채널과 OMP 채널을 **한 사무실 scene에서 함께** 표시한다.
P2-B.6 ①에서 만든 실행 증명 correlation(`delegatedBy`)을 화면에서 위임 관계로 보여준다.

**비목표**:
- 업무 단위 중복 제거(같은 위임의 Claude actor와 OMP actor를 하나로 합치기) — 관찰된 두 실행은
  각각 사실이므로 합치지 않는다. 관계만 표시한다.
- prompt/결과/파일 경로 노출 확대 — 표시 필드는 지금과 동일한 enum·별칭 수준을 유지한다.
- 새 상주 daemon·로그인 자동 시작·설정 변경.

## 2. 현재 구조 (실측)

| 계층 | Claude 채널 | OMP 채널 |
| --- | --- | --- |
| 서버 상태 | `server/live-projection.mjs`, `nextRenderId` 1부터 | Bridge ledger `renderId` 1부터, projection이 그대로 전달 |
| 스냅샷 API | `/api/live/snapshot` + `?after=` 증분 | `/api/omp/snapshot` (전체, 1초 폴링) |
| 표시 이름 | `Claude · 00N` | `OMP · 00N` |
| palette | `(id-1)%6` | Bridge 발급 0~5 |
| UI 훅 | `useLiveOffice(active,'claude')` | `useLiveOffice(active,'omp')` |
| 좌석 저장 키 | localStorage `orbit.live.seats.v1.<installation>` + **actorId** | 동일 형식, 별도 installation |

엔진(`vendor/.../officeState.ts`): `characters: Map<number, Character>` — **키가 숫자 renderId**다.
좌석은 `seats: Map<string, Seat>` + `seat.assigned`로 엔진이 전역 배정한다.
엔진에는 `subagentIdMap`/`subagentMeta(parentAgentId, parentToolId)`가 이미 있어
"다른 실행에 딸린 관찰"을 표현할 여지가 있다.

## 3. 충돌 지점

1. **renderId 공간 공유**: 두 채널이 각각 1부터 발급한다. 한 scene에 넣으면 `Map<number>` 키가 충돌한다.
2. **palette 중복**: 양쪽 0~5를 독립 사용하므로 색만으로 provider를 구분할 수 없다.
3. **좌석 경쟁**: 좌석 배정은 엔진 전역이다. 두 채널 actor가 같은 좌석을 원하면 한쪽이 밀린다.
4. **수명주기 회계 분리**: epoch/revision/generation/tombstone이 채널마다 별개다.
   한쪽이 offline이어도 다른 쪽 표시는 유지되어야 한다.
5. **폴링 부하**: 통합 시 두 스트림을 동시에 구독하게 된다.

## 4. 설계 옵션

### 옵션 A — 서버 통합 뷰(권장)

새 읽기 전용 라우트 `/api/scene/snapshot`이 두 채널 스냅샷을 합쳐 반환한다.

- OMP renderId는 **projection 단계에서** `1_000_000 + renderId`로 옮긴다.
  Bridge ledger의 발급 값은 건드리지 않는다(계약 무변경).
- Claude actor에는 `providerSlot: 0`, OMP에는 `providerSlot: 1`, 합성 `sceneId`(= engine key)를 붙인다.
- `delegatedBy`에 해석된 Claude **renderId**를 함께 실어 클라이언트가 링크를 그린다.
  (지금은 표시 문자열만 있고 renderId가 없으므로 서버에서 채워 넣는다.)
- 좌석 저장은 이미 actorId 기반이므로 네임스페이스 변경에 안전하다. 기존 저장값이 그대로 살아난다.
- palette는 OMP actor에 `+6`(0~5 → 6~11)을 적용해 Claude와 색이 겹치지 않게 한다.
  단, 이 매핑은 표시용이며 서버 원본 palette는 유지한다.

장점: 클라이언트는 스냅샷 1개만 구독한다(폴링 단순). 정합성 판단이 서버 한 곳에 모인다.
단점: 서버에 합성 계층이 하나 늘고, 두 채널의 freshness/epoch 규칙을 합성 규칙으로 명시해야 한다.

### 옵션 B — 클라이언트 합성

서버는 그대로 두고 UI가 두 스냅샷을 합성한다.

장점: 서버 계약 무변경.
단점: 클라이언트가 두 스트림·두 정합성 규칙을 알아야 하고, scene 키 충돌·좌석 경쟁을 UI에서 처리해야 한다.
폴링도 2배다. 장기적으로 유지비가 크다.

### 옵션 C — Bridge renderId 재발급

Bridge가 Claude renderId를 함께 고려해 전역 발급한다.

장점: 근본 해결.
단점: Bridge 계약·ledger 스키마 변경 + 기존 좌석/기록 매핑 마이그레이션. 이번 범위를 넘는다.

**권장: 옵션 A.** 서버 계약은 additive(새 라우트 + 새 필드)이고, 기존 채널 전환 경로는 손대지 않는다.

## 5. 옵션 A 상세 (1단계)

- 라우트: `GET /api/scene/snapshot` (기존과 동일한 로컬 세션 쿠키 보호, `no-store`).
  - 응답: `{ready, revision, epoch, source, providers:{claude:{ready,revision,epoch},omp:{...}},
    actors:[{sceneId, providerId, renderId, palette, name, status, delegatedBy:{name, renderId}, ...}],
    timeline:[...], notices:[...]}`.
  - 한쪽이 unavailable이면 `notices`에 사유를 남기고 **다른 쪽 actor는 계속 반환**한다.
    (한 채널 장애를 세션 종료로 바꾸지 않는다는 기존 불변 조건 유지)
- UI: 채널 선택에 **"통합"** 옵션을 추가한다. 기존 Claude/OMP 단독 모드는 그대로 남긴다.
  - 통합 모드의 캔버스 키는 `sceneId`(Claude `renderId`, OMP `1_000_000+renderId`).
  - `delegatedBy.renderId`가 있으면 카드·인스펙터에 링크 라벨(`← Claude · 007 위임`)을 추가한다.
    대상 actor가 현재 스냅샷에 없으면 링크 없이 이름만 표시한다(추정 금지).
- 좌석: 기존 저장 키 규칙 유지. 통합 모드에서도 actorId로 같은 좌석을 복원한다.
- palette: OMP는 표시용 `+6`. 인스펙터에는 원본 palette 번호를 노출하지 않는다(현행과 동일).

## 6. 검증 계획

격리(합성 fixture):
- 두 채널이 같은 renderId(1)를 가질 때 scene 키가 충돌하지 않는다.
- OMP palette 매핑이 0~11 범위를 벗어나지 않고, Claude palette와 겹치지 않는다.
- 한쪽 channel만 available일 때 다른 쪽 actor가 유지되고 notice가 남는다.
- `delegatedBy.renderId`가 실제 Claude actor에만 링크되고, 없으면 링크를 만들지 않는다.
- 통합 스냅샷에서 민감 필드(prompt/경로/raw 증명)가 늘어나지 않는다.

실제(Mac): Claude 세션 1개 + 그 세션에서 omp-deepseek 위임 1회를 동시에 실행해
통합 모드에서 두 actor와 위임 링크를 실화면으로 확인한다.

회귀: 기존 브라우저 검사 6종 + 채널 단독 모드 동작 유지.

## 7. 승인 요청 사항

1. **옵션 A 채택** 여부 (서버 additive 라우트 + UI "통합" 옵션).
2. 1단계 범위(위 §5)로 진행하고, 중복 회계·subagent 표현(엔진 `subagentMeta` 재사용)은
   2단계로 분리하는 것에 대한 동의.
3. 통합 모드 palette 규칙(OMP 표시용 `+6`) 승인.

승인 후 진행 순서: 구현 → 격리 검증 → 정확한 Diff 제출 → (승인) 운영 적용 → 실제 동시 실행 실증.
