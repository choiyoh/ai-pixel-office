# Command Code / DeepSeek Adapter 조사

2026-10-17 KST에 [공식 Hook 문서](https://commandcode.ai/docs/hooks), [CLI](https://commandcode.ai/docs/reference/cli), [headless](https://commandcode.ai/docs/headless), [설정 문서](https://commandcode.ai/docs/settings)를 읽었다. 이전 클라우드의 403 접근 제한은 이번 조사에서는 재현되지 않았다.

## 확인된 외부 계약

- POSIX CLI는 `cmd`, Windows는 `cmdc`를 쓰며 `command-code`도 지원한다. Windows의 시스템 cmd.exe를 Command Code로 취급하지 않는다.
- Hook은 SessionStart/PreToolUse/PostToolUse/Stop 네 종류다. Stop은 턴 종료이며 SessionEnd Hook은 확인된 계약에 없다.
- 도구 식별자는 read_file/write_file/edit_file/shell_command이고 tool_use_id로 호출을 구분한다. 인자·결과·cwd·transcript는 Orbit이 전달하지 않는다.
- SessionStart/Stop에는 matcher를 생략해야 한다. Claude의 12종 Hook 계획을 복사하지 않는다.
- 설정 scope는 사용자 `~/.commandcode/settings.json`, 프로젝트 `.commandcode/settings.json` 및 local 파일이다. 인증 파일은 수정 대상이 아니다.

npm public metadata에서 command-code 1.84.0, Node>=22, cmd/cmdc/command-code/commandcode alias를 확인했다. **로컬 설치 버전은 아니다.** 현재 Mac의 PATH·기존 nvm 설치·일반 앱 위치에서 CLI를 찾지 못했고, 사용자·현재 프로젝트의 Command Code 설정도 없다. `npm run doctor:command-code`가 이를 읽기 전용으로 보고한다. 전역 설치·로그인·설정 생성·위임 스크립트 변경은 하지 않았다.

## 이번 구현과 다음 경계

[P2-B.1 Provider Bridge](P2-B.1-PROVIDER-BRIDGE.md)는 공식 Hook의 순수 normalizer와 별도 인증·영속 수신 경계다. 아직 실제 sender/supervisor·producer spool·사용자 Hook 설치·기존 Live Office 병합은 없다. 실제 DeepSeek 모델 실행이나 기존 Haiku 위임자의 relay 여부를 이름/프롬프트로 추정하지 않는다.

실제 연동 전에 사용 중인 머신·실행 경로·버전·DeepSeek 선택 방식과 위임 경계를 확인해야 한다. 필요한 Hook/위임 스크립트 변경은 그 시점의 실제 Diff로 별도 검토한다. 기존 Claude 수집기의 registry/settings/ledger는 그대로 유지한다.
