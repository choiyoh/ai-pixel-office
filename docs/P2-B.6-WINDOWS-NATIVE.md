# P2-B.6 ④ — Windows native 실행 검증

## 0. 요약

- Windows(GitHub Actions `windows-latest`, win32/x64)에서 **OMP가 설치되고 실행되며, 관찰 래퍼가 셸 없이 스폰해 이벤트를 관찰**한다. macOS 대조군과 동일한 결과다.
- **래퍼 수정이 필요 없다**: Windows에서도 `omp`는 `.cmd`가 아니라 **`omp.exe`**(bun 셰임)로 설치되어, 옵저버의 "셸 폴백 금지" 규칙과 충돌하지 않는다.
- 남은 미검증은 **실 모델 왕복 하나**다: 러너에 자격증명이 없어 OMP가 `No API key found`로 종료한다(macOS 대조군과 동일한 지점). 이는 별도 승인(CI secret) 또는 실 Windows 머신이 필요한 범위다.

## 1. 방법

- 워크플로우 `.github/workflows/native-omp-probe.yml` — dispatch 전용(+자기 자신을 건드리는 push에만 반응). windows-latest와 macos-latest를 함께 돌려 **차이를 플랫폼 탓으로 귀속**시킨다.
- 스크립트 `scripts/omp-native-probe.mjs` — OMP 설치 형태·bun 위치·`omp` 해석을 기록하고, 옵저버로 3가지 스폰 형태를 시도한 뒤 자식의 stdout/stderr를 직접 캡처한다.
- 안전: transport를 넘기지 않으므로 **outbox·Bridge에 아무것도 쓰지 않는다**. `PROBE_SKIP_RUNS=1`로 OMP 실행 없이 해석 파트만 로컬 검증할 수 있다(자격증명 있는 머신에서 실 호출을 내지 않기 위한 장치).

## 2. 실측 결과 (run [39186534438](https://github.com/choiyoh/ai-pixel-office/actions/runs/39186534438), v5)

Windows:

```
binEntries               : bun.exe, bunx.exe, omp.bunx, omp.exe
candidates.omp           : C:\Users\runneradmin\.bun\bin\omp.exe
candidates.bun           : C:\Users\runneradmin\.bun\bin\bun.exe
direct  omp.exe --version : status 0, "omp/18.12.2"
direct  omp.exe -p …     : status 1, "error: No API key found for openrouter. …"
spawns (shell: false)
  executable=omp (PATH incl. ~\.bun\bin) → exitCode 1, observedKinds [session.start, execution.end]
  executable=C:\…\.bun\bin\omp.exe       → exitCode 1, observedKinds [session.start, execution.end]
  executable=C:\…\.bun\bin\bun.exe + cli.js → exitCode 1, observedKinds [session.start, execution.end]
```

macOS 대조군(같은 run): `omp/18.12.2`, 동일한 `[session.start, execution.end]`, 동일한 `No API key found` 오류.

해석:

- `session.start`가 **관찰된다** = 옵저버가 프로세스를 띄우고 JSON 스트림을 파싱했다.
- 이어서 `execution.end`로 끝난다 = 자격증명이 없어 턴이 시작되기 전에 종료했다(예상된 결과, 오류 아님).
- 세 형태 모두 성공 = 사용자 로그인 셸(PATH), 절대 경로, bun 런타임 직접 실행 중 어느 것을 쓰든 된다.

## 3. 도중에 드러난 두 가지 함정 (다음 실행자를 위해)

1. **npm의 bun은 OMP 셰임이 찾는 bun이 아니다.** `npm i -g bun`은 `%PATH%`의 `bun.exe`를 만들지 않아 OMP가 `error: bun is not installed in %PATH%`(exit 255)로 즉시 죽는다. 공식 설치기(`irm bun.sh/install.ps1 | iex` / `curl -fsSL https://bun.sh/install | bash`)로 `~/.bun/bin/bun.exe`를 만들어야 한다.
2. **러너에는 `~/.bun/bin`이 PATH에 없다.** 프로브는 로그인 셸을 흉내 내 그 디렉터리를 PATH 앞에 붙이고, 동시에 절대 경로 후보도 시도한다.

## 4. 재현 절차

```bash
# CI (권장): 자기 파일을 건드리는 push 또는 기본 브랜치에 병합된 뒤 dispatch
gh workflow run native-omp-probe.yml --ref <branch>
gh run download <run-id> -n omp-native-probe-windows-latest -D ./probe-win

# 로컬: 해석 파트만 (OMP를 실행하지 않는다)
PROBE_SKIP_RUNS=1 node scripts/omp-native-probe.mjs
```

## 5. provider 라우팅 — 러너에서는 형태가 provider를 결정한다 (run 39190586169, v6)

| 형태 | 러너의 해석 | 결과 |
|---|---|---|
| `-p --model deepseek/deepseek-v4.1-flash …` (**위임 정의 그대로**) | openrouter | `No API key found for openrouter` |
| `-p --provider commandcode --model deepseek/deepseek-v4.1-flash …` | **commandcode** | `No API key found for commandcode` |

- 운영 Mac에서 같은 인자가 commandcode로 가는 이유는 러너에 없는 **`~/.omp/agent/agent.db` 로그인**이 provider를 정해 주기 때문이다. 무설정 러너에서 실 왕복을 만들려면 **`--provider commandcode`를 명시**해야 한다.
- 키 이름은 OMP 번들에서 확인했다: `commandcode` provider의 `env.vars` = `["COMMAND_CODE_API_KEY","COMMANDCODE_API_KEY"]`. 따라서 저장소 secret 이름은 **`COMMAND_CODE_API_KEY`** 하나면 되고, 워크플로우는 그 값을 러너 환경변수로만 주입한다(값은 저장소에 남지 않는다).
- 두 형태 모두 `session.start → execution.end`를 관찰했다(4/4) — 옵저버 경로는 자격증명과 무관하게 정상이다.

## 6. 남은 것과 경계

- **실 모델 왕복(Windows)**: secret(`COMMAND_CODE_API_KEY`) 등록 후 provider 고정 형태가 실 응답을 받는지 확인하는 것이 남은 한 걸음이다. 키 등록은 저장소 소유자 결정이며 이 저장소는 키를 커밋하지 않는다. OMP가 실제로 답하면 artifact에 응답 일부가 남으므로 프롬프트는 무해한 문장으로 유지한다.
- **리눅스**: 우선순위 아님(사용자 지시). 매트릭스에 `ubuntu-latest` 한 줄을 더하면 같은 증거가 나온다.
- **이 문서가 주장하지 않는 것**: Windows 데스크톱 사용자의 로그인 셸·전역 설정·실 자격증명에서의 동작. 검증된 것은 **플랫폼 경로(설치·기동·스폰·이벤트 관찰)**까지다.
