# P2-B.6 ② 동시 provider scene — 설계 승인 및 1단계 구현 기록

> **상태: 옵션 A 구현·검증·운영 적용 완료 (코드 0fa83da + b67bd9d, CI 39172528184/39173148512 3-OS success).**
> 2026-10-19 07:55 KST에 웹(4173)을 재시작해 적용했고(새 PID 57593), 실제 위임 1회로
> 통합 뷰와 위임 링크를 실화면으로 확인했습니다. Bridge(4183)는 변경이 없어 재시작하지 않았습니다.
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

## 3. 충돌 지점

1. **renderId 공간 공유**: 두 채널이 각각 1부터 발급한다. 한 scene에 넣으면 `Map<number>` 키가 충돌한다.
2. **palette 중복**: 양쪽 0~5를 독립 사용하므로 색만으로 provider를 구분할 수 없다.
3. **좌석 경쟁**: 좌석 배정은 엔진 전역이다. 두 채널 actor가 같은 좌석을 원하면 한쪽이 밀린다.
4. **수명주기 회계 분리**: epoch/revision/generation/tombstone이 채널마다 별개다.
   한쪽이 offline이어도 다른 쪽 표시는 유지되어야 한다.
5. **폴링 부하**: 통합 시 두 스트림을 동시에 구독하게 된다.

## 4. 설계 옵션 (승인 결과)

### 옵션 A — 서버 통합 뷰 (채택)

새 읽기 전용 라우트 `/api/scene/snapshot`이 두 채널 스냅샷을 합쳐 반환한다.
Bridge 계약·ledger 스키마·기존 채널 경로는 변경하지 않는다(additive).

### 옵션 B — 클라이언트 합성 (미채택)

클라이언트가 두 스트림·두 정합성 규칙을 알아야 하고 폴링이 2배다. 유지비가 크다.

### 옵션 C — Bridge renderId 재발급 (미채택)

근본 해결이지만 Bridge 계약·ledger 스키마 변경과 기존 좌석/기록 마이그레이션이 필요하다.

## 5. 구현 결과 (실제 코딩 기준)

### 서버 — `server/scene-projection.mjs` (신규)

- `projectScene({claude, omp, source, environment, now})`가 두 채널 스냅샷을 합친다.
- **엔진 키 네임스페이스**: `OMP_RENDER_OFFSET = 1_000_000`.
  - actor의 `sceneId` = engine key. Claude는 `renderId` 그대로, OMP는 `1_000_000 + renderId`.
  - 클라이언트 `store.ts`는 `renderId`를 engine key로 쓰므로 **`renderId`에 sceneId를 싣고**,
    원본 채널 키는 `providerRenderId`로 보존한다.
- **표시 이름·palette는 원본 유지**: `public/characters/`에 `char_0`~`char_5` **6종만** 있어
  palette를 12종으로 확장할 수 없다. provider 구분은 이름(`Claude · 00N`/`OMP · 00N`)과
  인스펙터의 Provider 행, 위임 라벨로 한다. (설계 초안의 "OMP palette +6"은 폐기)
- **위임 링크**: OMP actor의 `delegatedBy`에 `{name, sceneId}`를 싣는다. `sceneId`는 verifier가
  인정한 Claude actor의 engine key이며, 대상이 이 스냅샷에 없으면 `null`(추정 금지).
  raw proof(pid/birth)는 여전히 서버 밖으로 나가지 않는다.
- **채널 독립**: 한 채널이 unavailable이면 `notices:[{providerId, reason}]`에 사유를 남기고
  다른 채널 actor는 계속 반환한다. **두 채널 모두 불가일 때만** `ready:false`(scene-unavailable).
- **회계**: `epoch = "<claude-epoch>|<omp-epoch>"`, `revision = "c<claude>.<omp>"`,
  `cursor`는 같은 문자열. actor 중복 키는 충돌 시 예외로 막는다.
- **timeline**: 두 채널 이벤트를 최신순으로 병합하고 `MAX_SCENE_TIMELINE = 60`으로 자른다.
- `receivedAt`은 ISO 문자열(초기 구현의 숫자 값은 store 검증에서 거부되어 수정).
- 한 채널이 보고한 적 없는 `receivedAt`은 **필드를 생략**한다(`null`은 클라이언트의 선택 필드
  검증을 통과하지 못한다). `lastEventAt`이 없으면 `observedAt`으로 대체해 항상 값을 보장한다.

### 서버 — 연결

- `server/app.mjs`: 인증 목록에 `/api/scene/snapshot` 추가, 라우트 신설.
  claude=`receiver.liveSnapshot()`, omp=`readOmpOffice({resolveDelegation})`, 실패 시 그 채널만 unavailable.
- `server/live-projection.mjs`: actor 반환에 `renderId` 추가(이미 내부 값이므로 계약 추가 아님).
- `server/bridge/office-projection.mjs`: `delegatedBy = {name, renderId}` — resolved renderId 동봉.

### 클라이언트

- `src/live/store.ts`: `parseSceneSnapshot`(scene 검증·정규화), `parseSceneNotices`,
  `SceneNotice` 타입. scene actor 검증은 provider **접두어**로 이름을 확인하고(키 기반 접미어가
  아님), `delegatedBy` 키를 `{name, sceneId}`로 제한한다(raw proof 필드 거부).
- `src/live/useLiveOffice.ts`: `LiveChannel = 'claude'|'omp'|'scene'`. scene 분기는 전체 스냅샷
  1초 폴링이고 `notices`를 함께 반환한다.
- `src/live/useOmpOutbox.ts`: 통합 모드에서도 OMP 아웃박스 상태를 표시.
- `src/live/LiveOffice.tsx`: 채널 선택에 **"통합 (Claude + OMP)"** 옵션, 제목/빈 상태/안내 문구,
  `scene-notices` 표시, 인스펙터의 "대상 보기" 버튼(위임 대상 actor로 선택 이동).
- `src/App.tsx`: 채널 상태 `'scene'` 허용 + localStorage 복원.

## 6. 검증 결과

격리(합성 fixture) — `tests/scene-projection.integration.mjs` **4/4**:
- 두 채널이 같은 renderId(1)를 가질 때 `sceneId`가 충돌하지 않는다(1 / 1000001).
- palette가 원본 그대로 유지된다(0, 2).
- 위임 링크가 해석된 대상에만 붙고, raw 증명 문자열(pid/birth/parentExecution)이 직렬화에 없다.
- 한 채널만 available이면 다른 채널 actor가 유지되고 notice가 남는다.
- 병합 timeline이 최신순 정렬되고 60개로 잘린다.

클라이언트 — `tests/live-store.test.ts` **32/32** (scene 케이스 추가):
- `c7.o3` → revision 7000003, OMP 이름 유지 + 키 1000001.
- raw proof 필드가 있는 `delegatedBy`는 파싱을 거부한다.
- 이름이 provider 접두어를 벗어나거나(PRIVATE), 같은 키가 중복되면 거부한다.

회귀:
- integration **59 pass / 4 skip / 0 fail** (기존 54 + scene 5).
- unit 31 → **32**, `lint`, `typecheck`, `check:source` 통과, `npm run build` 성공.
- 브라우저 검사 **7종** 통과 (`test:scene-browser` 신규):
  `scripts/scene-browser.mjs`가 합성 Claude 세션 1개 + OMP 세션 1개를 동시에 만들어
  ① 두 채널이 같은 renderId(1)를 발급해도 engine key가 `[1, 1000001]`로 갈라지는지,
  ② `/api/scene/snapshot`이 두 provider 모두 ready로 응답하고 raw proof를 싣지 않는지,
  ③ 단독 채널 전환 회귀가 유지되는지, ④ Claude 종료 후에도 OMP actor가 남는지를 실화면으로 확인한다.
  (산출물 `artifacts/p2-b6-scene-browser.json`, `artifacts/scene-unified.png`)

격리 Mac 실측(포트 4175, 별도 state 디렉터리, 웹 재시작 없음):
- `/api/scene/snapshot` 무쿠키 **401**, 브라우저 세션 **200** `ready:true`.
- UI: 채널 "통합 (Claude + OMP)", `● 통합 관찰 준비`, 제목 "통합 관찰 사무실 1F",
  OMP 아웃박스 상태 + `scene-notices`("OMP omp-unprepared") 표시, 빈 상태 문구 정상.
- 이 인스턴스는 별도 state 디렉터리를 쓰므로 OMP 브리지 데이터가 없어 `omp-unprepared`가 정상이며,
  **두 채널 동시 표시는 운영 적용 후 실제 위임으로 확인**한다.

## 7. 남은 단계

1. **운영 적용(승인 필요)**: 웹 4173 재시작 → `/api/scene/snapshot` 실데이터 확인.
   Bridge(4183) 재시작은 불필요하다(변경 없음).
2. **실제 동시 표시 실증**: Claude 세션 1개 + 그 세션의 omp-deepseek 위임 1회를 동시에 실행해
   통합 모드에서 두 actor·위임 링크를 실화면 캡처로 확인.
3. 이후 ③ OMP Resume·실제 Edit 검증, ④ Windows/Linux native 실행.

## 8. 승인 이력

- 옵션 A 채택 및 1단계 범위 승인 (사용자 "응 1번 흥인해").
- 변경된 결정: palette 확장(+6)은 캐릭터 아트가 6종뿐이라 **폐기**, 이름표·배지·인스펙터로 구분.
- Hook sender·설정 파일 변경 없음(무변경 확인: settings.json, omp-deepseek 정의).
