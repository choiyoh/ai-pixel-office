# Command Code / DeepSeek Adapter 준비

사용자가 제공한 공식 문서는 https://commandcode.ai/docs 이다. 2026-10-16 KST에 이 클라우드에서 문서와 llms.txt를 요청했으나 egress proxy가 403으로 차단했다. 공식 API/Hook, CLI 명령 이름·버전·이벤트 schema·DeepSeek 선택 옵션은 **확인하지 못했다**. 문서가 없다는 뜻이 아니며, 기존 Claude Code의 Analyst/Dev 위임 스크립트도 조사 명목으로 실행하거나 수정하지 않았다.

Command Code는 향후 DeepSeek 실행 Adapter의 기준이다. Mock 운영 캐릭터도 Command Code로 명명했다. 과거 P1 문서의 OpenCode는 당시 범위를 보존한 이력이며 현재 DeepSeek 연동 대상으로 사용하지 않는다.

## 준비된 실행 경계

`platform/launch.mjs`의 `cliInvocation`은 실행 계획만 반환하며 Command Code를 실행하지 않는다. 사용자가 검증한 executable 절대경로, args 문자열 배열, cwd 절대경로, 실행 환경(native/WSL)을 받는다. POSIX executable/Windows .exe는 shell:false 인수 배열로 계획한다. Windows .cmd/.bat는 일반 shell interpolation을 하지 않고, 확인된 Node entry 경로가 있을 때만 process.execPath로 실행할 계획을 만든다. Node entry가 없는 batch는 거부한다. Windows에서 WSL을 대신 시작하는 경로 변환은 구현하지 않았다. WSL 안에 collector와 CLI를 같이 두는 것을 기본으로 한다.

실제 Adapter 단계에서는 환경변수 전체를 자식에게 전달하지 않고 필요한 key allowlist, secret 주입 경계, 타임아웃·취소·exit code, stderr 민감정보 제거, 소유 프로세스만 종료하는 정책을 추가해야 한다. 현재 launcher helper를 완성된 프로세스 supervisor로 간주하지 않는다.

## 연결 전에 필요한 공식 근거

1. 대상 OS에서 사용 중인 CLI 실행 명령·버전·절대경로와 Windows batch/Node entry 여부를 기록한다.
2. 공식 문서에서 실제 이벤트 수단이 확인되는지 검토한다. Hook/API가 없다면 승인된 wrapper의 시작·종료·명시적 phase만 수집하며 stdout 내용이나 prompt로 업무 상태를 추정하지 않는다.
3. 기존 DeepSeek Analyst/Dev 위임자의 relay/실행자 관계와 변경 가능한 경계를 사용자와 검토한다. 위임 스크립트 변경은 별도 승인한다.
4. Bridge의 인증 principal, provider namespace, eventId/sequence, task/execution/parent/delegation ID, sensitive-field allowlist가 먼저 준비되어야 한다.
5. fake Adapter fault tests 후 각 OS에서 실제 세션을 검증한다. 공식 API 확인 이전에 Hook 명칭이나 endpoint를 발명하지 않는다.

향후 envelope 제안: schemaVersion, providerId, installationInstanceId, nativeSessionId, executionId, logicalTaskId, parentTaskId?, delegationId?, eventId, sequence, occurredAt, kind, safeSummary(enum). 서버는 인증 principal과 providerId를 대조하고 수신 시각을 따로 기록한다. source/freshness는 서버가 부여한다. 아직 현재 intake에 이 envelope를 허용하지 않으며 다른 Provider 요청은 404다.

멀티 Provider는 프로세스 분리 Bridge를 권장한다. 전역 watcher/parser를 공유하는 기존 Runtime에 Adapter를 직접 추가하는 방식은 상태 혼선 위험이 크다. [구현 순서](ADAPTERS-AND-REMOTE.md) 및 [P1-B 비교](P1-B-ARCHITECTURE.md)를 따른다.
