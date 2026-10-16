# P2-A.1 Windows CI 정상화 결과

기준: work / 5993dd9. 구현 검증 커밋: 8c69332. 검증 실행: https://github.com/choiyoh/ai-pixel-office/actions/runs/38881681326. 이 문서는 직전 검증된 구현 커밋을 기록하며, 문서·첫 snapshot null 처리 보완을 포함한 최종 커밋의 실행 결과는 완료 보고의 최신 CI 링크를 따른다.

**CROSS_PLATFORM_CI_PASS — 세 OS 전체 workflow 성공 확인**. 다음 표는 해당 커밋의 실제 GitHub Actions 결과다. 이전 커밋의 성공이나 로컬 Linux 결과를 다른 OS의 성공으로 대체하지 않았다.

| CI 환경 | 앱 단위 | 앱 통합 | 원본 테스트 | 전체 workflow |
|---|---|---|---|---|
| ubuntu-latest / Linux x64 | 16 통과 | 5 통과, Windows 전용4 skip | webview86 + server550 + contract7 = 643 통과 | 성공 |
| macos-latest / macOS arm64 | 16 통과 | 5 통과, Windows 전용4 skip | 643 통과 | 성공 |
| windows-latest / Windows x64 | 16 통과 | 기존5 + Windows 전용4 = 9 통과 | webview86 + server542 + contract7 = 635 통과, 원본 POSIX 전용8 skip | 성공 |

설치·build·typecheck·lint, Mock 서버 시작/IPC 종료, Mock 브라우저 및 fixture 수신 브라우저 검사를 포함한다. Node 22.23.3이다. Windows Server 러너는 Windows10/11 실기, macOS arm64는 Intel 실기를 대체하지 않는다. 실제 Claude 연결 성공을 뜻하지 않는다.

## 실제 원인과 수정

확인된 장애는 Windows PowerShell 5.1의 보안 cmdlet 모듈 자동 로딩 실패였다. 기준5993dd9는 Set-Acl/Get-Acl을 사용했고, 안전한 진단을 추가한 실행에서는 Get-Acl 읽기 단계에서 재현되었다. 원래 일반 메시지에 버려진 하위 ErrorRecord를 직접 확인했다고 주장하지 않는다. 공개 안전 진단에서 stage=read-acl, reason=module-resolution, System.Management.Automation.RuntimeException, HRESULT=-2146233087, Desktop5.1이 확인되었다. 같은 fixture를 읽는 기존 Get-Acl 호출도 실패하는 비교 검사를 남겼다. PS7에서 상속된 특정 모듈 경로의 원문은 수집·공개하지 않았으며, 확정된 장애 지점은 PS5.1 보안 cmdlet의 자동 로딩이다. 기존 runPowerShell이 모든 하위 실패를 일반 permission 메시지로 치환해 원인이 가려졌다.

PS7 러너에서 시작한 PS5.1 하위 프로세스의 모듈 환경을 초기화하는 접근은 모듈 탐색 시간 초과를 남겼다. 최종 구현은 Get-Item/Get-Acl/Set-Acl/ConvertTo-Json 자동 로딩 의존성을 제거하고 .NET DirectoryInfo/FileInfo, DirectorySecurity/FileSecurity API를 직접 사용한다. PS5.1은 instance SetAccessControl, PS7은 FileSystemAclExtensions.SetAccessControl로 DACL만 persist한다. 기존 owner/group/audit를 다시 쓰지 않는다.

새 Orbit 디렉터리에만 현재 사용자/SYSTEM/Administrators SID의 제한된 DACL을 설정한다. 기존 디렉터리는 검증만 하고 넓은 권한이면 거부한다. private parent 상속, reparse/owner/Allow/null DACL 검사, registry wx 생성과 덮어쓰기 거부를 유지한다. 관리자 상승·OS 보안 설정 변경·공개 권한 fallback이 없다.

Hook launcher의 392바이트 출력 문제는 process-local ProgressPreference로 비대화형 진행률 출력을 억제한 뒤 무출력 검사 통과를 확인했다. 실제 exit0·무출력·인증된 승인 이벤트 도착 검사는 그대로 유지한다. Node sender는 계속 실패 시 무출력이다. Hook 설치 기능은 추가하지 않았다.

오류 공개 정보는 고정 단계/이유/예외 종류, 숫자 HRESULT/native/exit 코드와 PS 버전뿐이다. raw stderr/예외 메시지/명령줄/환경 값/사용자 경로/토큰을 공개 annotation에 쓰지 않는다. 브라우저는 고정 검사 단계와 안전한 scalar 값만 공개한다. 실패 종료 코드를 보존하고 테스트 기준을 느슨하게 만들지 않았다. 브라우저 단계 진단 추가 후 전체 성공을 확인했다. 첫 Canvas snapshot이 null일 때 expect.poll callback이 TypeError로 즉시 종료될 수 있는 점도 확인해 null을 빈 배열로 처리하도록 보완했다. 필요한 actor 수·좌석·상태 검사는 그대로 기다려 검증한다. 앞선 일시적 브라우저 실패가 이 race 때문이었다고 단정하지 않는다.

## 추가로 드러난 원본 Windows fixture 문제

앱 통합 통과 후 원본 서버 테스트에서 23개 실패가 발견되었다(run 38879190021). 일부 fixture는 HOME만 바꾸지만 Windows os.homedir는 USERPROFILE을 사용했다. CLI path를 JSON 문자열과 비교하는 검사와 mock command의 Windows quoting에도 표현 문제가 있었다.

`patches/windows-upstream-test-fixtures.json`에 보정을 분리하고 `scripts/upstream-workspace.mjs`가 Windows 임시 복사본에만 적용한다. 대상은 configPersistence, consentFlow, clientMessageHandler, mockClaudeRunner, cli의 테스트 fixture 5개 파일이다. HOME/USERPROFILE을 함께 저장·격리·복구하고, mock native command quoting과 JSON path needle의 표현을 보정한다. 테스트 삭제·새 skip·assertion 비활성화는 없다.

고정 commit/hash와 patch occurrence 수를 먼저 검증하며, 보호된 vendor 경로·작업공간 밖 파일·source drift를 거부한다. 원본 381파일 hash는 유지한다. default/Allure 리포터를 유지하고 JSON 리포터를 추가해 전체 suite를 실행한다. Windows의 8개 skip은 원본에 이미 있던 POSIX 권한/관련 검사다. overlay가 추가한 skip이 아니다. 엔진·Provider 구현을 변경한 것으로 보고하지 않는다.

## 구현/검증 경계

- 원본 upstream: d1e007a9fdf3003c252d2973abe1999ae59aec33 / 381파일 hash 유지.
- Linux 로컬 build/type/lint, 단위16, 통합5, Windows 전용4 skip, Mock smoke, 원본643, Mock/수신 브라우저 검증을 수행했다. Windows용 fixture 복사본도 Linux에서 타입·Lint를 검사했다. 이를 Windows 실제 실행으로 세지 않았다.
- 공식 SHA256을 검증한 portable PowerShell7 Linux 도구로 script parser/안전한 오류 protocol을 보조 확인했다. Windows ACL 검증은 실제 Windows CI 결과를 사용했다.
- 실제 Claude·Command Code·OMP 설정, 사용자 Hooks와 DeepSeek 위임 스크립트 변경 없음. 테스트의 fake settings/hooks는 임시 HOME에서만 생성·삭제했다.
- 첫 승인 직후 클라우드가 이전 snapshot으로 복원되어 로컬 ebfbd6f와 ignored bundle이 남아 있지 않았다. 원격5993dd9에서 수정안을 복구해 새로운 SHA로 전달했다. 강제 push/원격 reset은 하지 않았다.

## P2-A.2 및 남은 실기

[P2-A.2 Live Canvas 설계](P2-A.2-LIVE-CANVAS-DESIGN.md)만 작성했다. Mock/Live 독립 store·OfficeState, 인증된 SessionStart/authoritative snapshot 기반 생성, stable identity/render ID, 종료 tombstone, freshness와 업무 상태 분리, snapshot/delta revision, 기존 BFS/animation 재사용을 제안한다. 현재 sender의 eventId/sequence/replay와 자식 identity 부족으로 보장할 수 없는 부분도 명시한다. App/Canvas Live 통합이나 P2-B는 구현하지 않았다.

Windows10/11 일반 사용자 계정에서 NTFS ACL·owner·상속, 한글/공백 경로, 기존 ACL/registry 보존, PS5.1 UTF8 Hook stdin, Ctrl+C/registry 정리, native Claude Hook host·세션·서브에이전트 검증이 남았다. 실제 설정/Hook 변경은 별도 승인 후 수행한다. WSL은 별도 Linux Node/home/settings로 검증한다. Mac Intel과 Windows/Linux ARM64도 별도 검증 대상이다.

## 기준 이후 변경 파일

- `README.md`
- `docs/P2-A.1-WINDOWS-CI.md`
- `docs/P2-A.2-LIVE-CANVAS-DESIGN.md`
- `patches/windows-upstream-test-fixtures.json`
- `platform/launch.mjs`
- `platform/private-files.mjs`
- `platform/runtime.mjs`
- `scripts/browser-check.mjs`
- `scripts/browser-diagnostics.mjs`
- `scripts/ci-diagnostics.mjs`
- `scripts/connection-browser.mjs`
- `scripts/tasks.mjs`
- `scripts/test-upstream.mjs`
- `scripts/upstream-diagnostics.mjs`
- `scripts/upstream-workspace.mjs`
- `tests/connection.integration.mjs`
- `tests/platform.test.ts`
- `tests/windows-acl.integration.mjs`

GitHub Actions API는 cloud proxy403으로 접근하지 못했으나 공개 matrix graph/annotation에서 job 상태와 안전한 진단을 직접 확인했다. ignored artifacts는 보조 증거이며 새 환경에서 보존을 보장하지 않는다. 재현 가능한 소스와 patch는 work에 push했다. 이 단계에서 멈추며 실제 Hook 설치·외부 Provider·원격 배포로 진행하지 않는다.
