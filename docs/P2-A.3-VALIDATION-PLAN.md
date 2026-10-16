# P2-A.3 실제 Claude 검증 계획 — 실행하지 않음

P2-A.2는 합성 수집 경로까지만 검증한다. 아래 작업은 대상 Mac의 별도 승인 후 수행하며, 이 문서로 설치를 승인한 것으로 보지 않는다. Command Code/DeepSeek/Hermes·원격 접근은 범위 밖이다.

## MacBook Pro M1 Max 사전 점검

1. work의 완료 보고 SHA로 checkout하고 `git rev-parse HEAD`를 기록한다. `node --version`=22.23.3, `node -p 'process.platform+"/"+process.arch'`=darwin/arm64를 확인한다. `npm ci --no-audit --no-fund`, `npm run setup`, `npm run build`, `npm run doctor`를 실행한다. CLI 존재는 로그인/Hook 호환성 성공이 아니다.
2. `npm test`, `npm run test:integration`, `npm run test:smoke`, `npm run test:live-browser`를 실행한다. 브라우저 검사는 필요하면 `npx playwright install chromium`으로 프로젝트 Playwright Chromium을 준비한다. 이 검사는 여전히 synthetic fixture이며 실제 Claude 실행과 별도로 기록한다.
3. 실제 Claude Code 버전/로그인/실행 호스트·설정 scope·CLI 경로를 사용자가 확인한다. 비밀·프롬프트·transcript를 채팅이나 Git에 올리지 않는다. 기존 OMP/DeepSeek delegation 설정과 Hooks의 bytes/hash/권한을 읽기 전용으로 기록한다.
4. 설치 전 `npm run hooks:plan -- --context=posix`를 실행한다. 출력 `writesPerformed=0`과 기존 항목 보존, 중복/경로 충돌, original/proposed hash, 송신 Node/forwarder의 실제 절대경로를 검토한다. `CLAUDE_CONFIG_DIR`가 설정되어 있으면 그 scope가 대상이다. cloud/Linux의 Hook command를 Mac으로 복사하지 않는다.

## 예상 변경 파일과 Diff

이 저장소는 Hook 설치/apply 명령을 제공하지 않는다. **P2-A.2가 새 Hook 종류를 추가할 필요는 없다**. 기존 계획의 12개 이벤트를 그대로 사용한다. 실제 Mac에 기존 Orbit sender가 이미 있으면 command/path/hash 확인 후 추가 변경이 없을 수 있다.

| 파일 | 승인 후 예상 영향 |
|---|---|
| `~/.claude/settings.json` 또는 대상 `CLAUDE_CONFIG_DIR/settings.json` | 기존 hooks 배열 항목을 보존하고 없는 Orbit command만 append |
| Orbit private root의 `backups/settings.<timestamp>.json` | 변경 전 bytes/hash/POSIX mode의 private backup. 실제 생성은 별도 승인 |
| 저장소 `dist/claude-forwarder.cjs` | 빌드 산출물. 별도 `.claude/scripts` 또는 `.pixel-agents` Hook 파일 설치 불필요 |
| `~/Library/Application Support/Orbit Works/runtime/receiver.json` | opt-in 서버의 임시 token/port/PID, 종료 시 자신의 registry만 제거 |
| 같은 root의 `live/claude-live.json` | private 설치 UUID/HMAC mapping·상태·tombstone·최근 구조 timeline. 실제 실행 후 생성 |
| `.claude/scripts/`, `.claude/omp/`, `~/.omp/`, Command Code/DeepSeek 스크립트 | 변경 없음 |

Mac Dry-run의 추가 형식 예시(실제 경로·hash·Diff는 **대상 Mac에서 재생성**):

```diff
--- ~/.claude/settings.json (existing values redacted)
+++ proposed (not written)
@@ hooks.SessionStart; N existing entries preserved @@
+ {"matcher":"","hooks":[{"type":"command","command":"'<TARGET_NODE_22>' '<CHECKOUT>/dist/claude-forwarder.cjs'","timeout":5}]}
```

같은 append 형식의 대상: SessionStart, SessionEnd, PreToolUse, PostToolUse, PostToolUseFailure, Stop, PermissionRequest, Notification, SubagentStart, SubagentStop, TeammateIdle, TaskCompleted. PreToolUse 등 도구 필터 matcher는 빈 문자열로 전체를 수신하고 allowlist로 도구 이름만 전달한다. 다른 Hook을 대체하지 않는다. 원본 값과 비밀은 보고용 Diff에서 가린다.

실제 적용 전: 원본 bytes/SHA256/mode를 private backup에 보관 → JSON·기존 Hook shape 확인 → 대상별 Dry-run Diff 제출 → **별도 사용자 승인** → 동시 편집 없는지 original hash 재확인 → 승인된 append만 수행 → 변경 후 Diff/hash 확인 순서다. 이 문서는 적용 도구를 구현하거나 실행하지 않는다.

## 실제 수집 → Canvas 검증

승인된 설치 후 대상 Mac에서 `ORBIT_MODE=claude-local npm start`로 loopback 서버를 실행한다. 브라우저는 **그 Mac**에서 접속한다. cloud localhost는 Mac localhost가 아니다. LIVE OFFICE 선택 후 SessionStart 전 actor0, LIVE TRANSPORT / 실환경 미검증 표시를 확인한다.

새 실제 root Claude 세션에서 다음 관측과 Canvas를 대조한다. 임의 프롬프트/출력 전문을 증거로 저장하지 않고 허용된 kind/tool/수신 시각과 화면만 기록한다.

1. SessionStart →1명, 같은 session 재수신/새로고침 →중복 없음.
2. Read/Grep/Glob →기존 읽기 animation. Edit/Write →typing. Bash →중립 도구 실행. 실제 도구 호출과 일치하는지 확인한다.
3. 실제 PermissionRequest/idle_prompt →승인/입력 대기. PostToolUseFailure →도구 경고. Stop →턴 종료이며 actor 유지/업무 완료 집계 없음.
4. 독립 root5세션 이상 →고유 actor/render ID, 클릭 inspector·시각·freshness 확인. 자식 이벤트로 가짜 독립 자식이 생기지 않는지 확인한다. explicit child marker가 실제 버전의 root에도 붙는지 조사하고, 해당 경우 자동 완화하지 말고 스키마 계약을 재검토한다.
5. SessionEnd →활성 집계 제외·좌석 반환·despawn. 종료 뒤 늦은 이벤트/SessionStart →부활 없음. 실제 clear/resume/compact가 같은 native ID를 재사용하는지 확인한다. 현재는 generation 판별 근거가 없어 해당 ID 재개가 표시되지 않는 제약이다.
6. 서버 종료 →offline이며 Mock 전환 없음. 재시작/새로고침 →같은 actor/render/palette/좌석, 재관측 전 stale. SessionEnd가 누락되면 실제 종료를 추정하지 않는지 확인한다.
7. sender/서버 불능이 실제 Claude 작업을 막지 않는지 확인한다. 무인증/잘못된 Host/Origin 요청은 거부되어야 한다. ledger·DOM·로그에 raw session ID/prompt/path/입출력/token이 새지 않는지 안전한 sentinel로 별도 검사한다.

Windows native/WSL과 Mac Intel은 각 실행 호스트·Node·home·settings·private root를 분리해 같은 절차를 수행한다. Windows10/11 일반 계정에서는 PS5.1 launcher/UTF8 stdin, private ACL/owner/inheritance, 한글·공백 경로, Ctrl+C/registry 보호도 확인한다. 현재 Actions Windows Server 결과로 이를 대신하지 않는다.

## 원복

Claude/Orbit의 자신이 시작한 프로세스를 종료한다. 현재 settings hash가 설치 직후 hash와 같은지 확인한다. 같으면 private backup의 bytes/mode를 복원할 수 있다. 다르면 오래된 backup으로 덮어쓰지 않고 이번 Orbit command 항목만 제거해 다른 편집/Hook을 보존한다. 원래 파일이 없었어도 새 타 항목이 있으면 파일 전체를 삭제하지 않는다. JSON 파싱·기존 Hooks 동작을 재검증한다.

자신이 생성한 registry/Orbit live state만 소유권·private 권한과 내용을 확인해 별도 정리한다. ledger를 삭제하면 namespace/mapping/tombstone 보장이 초기화되므로 서버 가동 중 삭제하지 않는다. 삭제를 단순 오류 해결법으로 권장하지 않는다. 백업은 비밀을 포함할 수 있어 private하게 보관한다. 기존 OMP·Command Code·DeepSeek 스크립트는 복구 대상 변경 자체가 없다.
