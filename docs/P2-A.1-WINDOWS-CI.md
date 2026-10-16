# P2-A.1 Windows ACL 수정 및 CI 검증

기준 커밋 5993dd9, work branch. 이전 로컬 커밋 ebfbd6f는 클라우드 복원 과정에서 checkout/ignored bundle과 함께 유실되어, 사용자의 push·CI 승인 후 원격 5993dd9에서 같은 수정 의도를 복구했다. 새 커밋 SHA는 최종 보고 및 git log에서 확인한다. 강제 push/원격 reset은 하지 않는다.

## 원인과 수정

기존 run 38825287804: 사용자 제공 결과 macOS arm64/Ubuntu 전체 성공, Windows build/type/lint/unit11 성공·integration3/5 성공. 두 실패는 ensurePrivateDirectory→runPowerShell 경로의 일반 메시지였다. 원래 하위 예외/exit code는 일반화되어 정확한 native 실패 지점을 기존 stack만으로 확정할 수 없었다.

확인된 코드 문제는 새 디렉터리에 빈 DirectorySecurity를 만들고 SetOwner 후 Set-Acl로 전체 descriptor를 쓰는 것이다. DACL 제한에 필요 없는 owner/group/audit 쓰기를 피하기 위해 Get-Acl의 기존 descriptor에서 Access section만 변경하고, 새 Orbit 디렉터리에만 현재 사용자/SYSTEM/Administrators FullControl을 설정한다. 기존 폴더 ACL은 검사만 하고 넓으면 거부한다.

Windows PowerShell 5.1은 DirectoryInfo/FileInfo.SetAccessControl, PowerShell7은 FileSystemAclExtensions.SetAccessControl을 호출한다. owner/group/audit를 유지하며 관리자 상승·시스템 정책 변경·공개 권한 fallback을 하지 않는다. 재조회 ACL에서 owner/Allow SID/reparse/null DACL을 검사한다. registry는 private parent 상속과 wx 생성으로 기존 파일을 보호한다.

runPowerShell은 고정 stage/reason/예외 type, exitCode/spawnCode/signal, HRESULT/nativeCode, PS version/edition만 기록한다. raw stdout/stderr/예외 message/경로/command/환경/토큰은 출력하지 않는다. script catch는 ORBIT_ACL_FAILURE JSON과 exit1을 내보내고 JS는 allowlist 외 내용을 폐기한다. parser/startup 실패는 stage=engine이다. stage는 path/identity/read-acl/owner/protect-dacl/clear-dacl/create-sid/create-rule/add-rule/write-acl/verify-acl이다.

## 회귀 검증

이전 승인 직전 환경에서는 Linux unit12, 기존 integration5, Windows 전용4 skip, 원본643, build/type/lint·Mock smoke·Mock/수신 브라우저가 통과했다. 복원된 환경에서도 설치·로컬 검사를 다시 실행하고, 승인된 push 이후 **새 커밋의 GitHub Actions 세 OS 전체 성공을 실제 확인해야** CROSS_PLATFORM_CI_PASS로 판정한다. 이전 결과나 push 성공만으로 CI 성공이라고 기록하지 않는다. 실제 실행 URL과 결과는 최종 보고를 따른다.

추가 Windows 전용 tests/windows-acl.integration.mjs 네 항목은 기존 task에서 자동 발견한다: PS5.1과 PS7 각각 owner/group 보존·private DACL·파일 상속·exclusive overwrite 거부, 기존 Everyone Allow fixture를 변경하지 않고 거부, 실제 missing-path 오류의 안전한 stage/exit 진단. Windows에서는 기존5+추가4=9개가 실행되어야 한다. Linux/macOS는 전용4개 skip을 성공으로 세지 않는다. 기존5개는 무인증/다른 provider/과대 payload 거부, 격리 Provider, packaged PowerShell launcher, registry 보존과 Mock/fixture 분리를 유지한다.

## 잔여 실기 검증과 범위

Windows Server CI는 Windows10/11 일반 사용자 실기를 대체하지 않는다. 실기에서는 관리자 상승 없이 NTFS ACL·owner·상속, 한글/공백 경로, 기존 ACL/registry 보존, PS5.1 UTF8 Hook stdin, Ctrl+C/registry 정리, 실제 Claude native Hook/session/subagent를 별도 승인 후 검증한다. WSL은 별도 Linux Node/home/settings다. macOS arm64 성공으로 Intel 검증을 주장하지 않는다.

Claude/Command Code/OMP 설정, Hooks, DeepSeek 위임 스크립트는 수정하지 않는다. 원본 엔진/Provider 격리/Mock UI도 유지한다. [P2-A.2 Live Canvas](P2-A.2-LIVE-CANVAS-DESIGN.md)는 설계만이며 구현/P2-B/원격 배포는 진행하지 않는다.

변경 파일: platform/private-files.mjs, platform/runtime.mjs, tests/platform.test.ts, tests/windows-acl.integration.mjs, 이 문서, P2-A.2-LIVE-CANVAS-DESIGN.md, README.md.
