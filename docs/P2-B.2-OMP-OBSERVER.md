# P2-B.2 — OMP 관찰 어댑터

> **현재 운영 상태(2026-10-18):** 이 문서의 미적용 제안은 과거 기록입니다. 전역 위임 정의는 후속 승인으로 적용됐고 현재는 observe-omp-durable.mjs를 사용합니다. 최신 상태·승인 경계·검증 근거는 [P2-B.4 Mac 인수인계서](HANDOFF-P2-B4-MAC.md)를 먼저 확인하세요.

## 확인한 실행 경로

2026-10-18 Mac ARM64에서 설치된 `@oh-my-pi/pi-coding-agent` 18.10.0을 확인했다. 실제 독립 print 실행의 assistant 메타데이터는 provider=`commandcode`, model=`deepseek/deepseek-v4.1-flash`였다. 현재 사용 경로는 **OMP → Command Code provider → DeepSeek**다. 별도 Command Code CLI 설치는 필요하지 않다.

설치 패키지의 공개 소스 `src/extensibility/shared-events.ts`, `src/extensibility/extensions/types.ts`, `src/modes/print-mode.ts`와 실제 NDJSON 출력을 대조했다. upstream: <https://github.com/can1357/oh-my-pi>. 모델 요청 플래그나 응답 문장에서 모델을 추측하지 않는다.

## 구현 범위

`platform/observe-omp.mjs`는 자신이 시작한 OMP 프로세스의 `--mode json` 스트림만 관찰한다. fresh print, `--no-session`, `--no-extensions`, 1초~1시간의 `--max-time`을 요구한다. 기존 실행을 attach하거나 프로필·인증·확장을 설치하지 않는다. shell 없이 실행하며 필요한 런타임/Command Code/DeepSeek 환경 변수만 자식에게 전달한다. `scripts/observe-omp.mjs`는 stdin과 최종 assistant 텍스트를 기존 업무 입출력으로 전달하고 실제 종료 코드를 보존한다. JSON 전체·stderr·도구 인자·결과는 저장하지 않는다. 이 래퍼는 OMP의 모든 대화형/확장 기능을 대체하는 범용 실행기가 아니다.

`server/bridge/omp.mjs` 매핑:

| 관찰 근거 | Bridge 이벤트 |
| --- | --- |
| session 헤더 | session.start |
| tool_execution_start | tool.start |
| tool_execution_end + isError | tool.end + toolFailed |
| agent_end | turn.end |
| 소유 자식의 실제 close | execution.end |

read/grep/glob은 read, edit/write/bash는 각각 edit/write/shell, 나머지는 other다. OMP 호출 ID는 `|` 등을 포함하므로 제어문자·공백을 제외한 ASCII 1~512자로 받으며 ledger에서 HMAC 처리한다. native session ID도 실행별 임시 키로 먼저 HMAC 처리한다. modelProvider/modelFamily는 제한된 enum만 전달한다. 종료 코드 0은 프로세스 결과이며 업무 성공 증명이 아니다. tool failure도 별도 상태이며 실패 내용을 보내지 않는다.

프로세스 취소는 소유 자식에게만 TERM→2초 후 KILL을 보낸다. max-time에 5초 유예를 둔 supervisor watchdog도 있다. Bridge 장애는 OMP 종료 코드·최종 업무 응답을 바꾸지 않는다. parser 1MiB/line, 관찰 queue128, 전송1.2초, 종료 drain2초로 제한한다. 관찰 손상/overflow/전송 오류 이후에는 추가 전송을 중단하며 누락 종료를 성공으로 꾸미지 않는다.

## 저장소와 운영 분리

명시적 `npm run bridge:start`는 별도 포트4183, `provider-bridge-omp` namespace, provider `omp`만 사용한다. 기존 Claude 수집기·4173 Live Office·Hook을 변경하지 않는다. `platform/bridge-transport.mjs`는 private registry를 읽고 loopback으로만 전송하며 인증을 OMP에 넘기지 않는다. Bridge ledger v1은 기존 신원을 보존해 메모리에서 v2로 이행하고 다음 정상 쓰기까지 원본 파일을 변경하지 않는다.

현재 사용자 namespace에는 Bridge를 시작하지 않았다. 실제 검사는 별도 임시 private stateDir/포트0에서 실행했다. 기존 Live Office Canvas와 합치지 않았으므로 **OMP 캐릭터가 운영 화면에 나타나는 단계는 아직 아니다**.

## 검증

실제 OMP Read 1회에서 session.start→tool.start(read)→tool.end→turn.end→execution.end 5개가 모두 committed, 모델 commandcode/deepseek, native exit0, 최종 activeActors0/terminalCount1이었다. 원문·경로·token 부재를 확인했고 Claude settings/omp-deepseek 위임 정의/OMP config/models의 전후 해시가 같았다. 상세 로컬 증거: `artifacts/omp-live-validation.json` (원문 미저장).

자동 검사는 모델 근거, 실패/종료 구분, private content 제거, Bridge outage와 업무 응답 보존, parser 상한/지원하지 않는 실행 거부, 환경 변수 분리, 실제 HTTP principal, v1 migration, 실제 호출 ID 문자와 상한, 소유 프로세스 취소를 포함한다. 실제 DeepSeek의 Edit/재개, Windows/Linux 실제 OMP 실행은 검증하지 않았다. 세 OS CI는 가짜 OMP 자식으로 프로토콜·운영체제 호환성을 검사한다.

## 남은 보장 한계

producer durable spool/retry는 미구현이다. 수신된 이벤트는 Bridge가 내구 기록하지만 전송 전 장애는 유실될 수 있다. 장애 후 active actor가 남을 수 있으며 자동 완료/삭제하지 않는다. 기존 Ledger의 bounded reorder/dedup를 사용하지만 이 producer가 재전송을 보장하지는 않는다.

fresh `--no-session` 실행마다 독립 신원이다. OMP resume/동일 업무 반복 실행의 신원 보존, Claude relay와 OMP executor의 실제 delegation 연결, Live Canvas 결합은 후속 범위다. prompt 유사도나 이름으로 기존 Claude 캐릭터와 합치지 않는다.

## 기존 위임 정의에 대한 미적용 제안

사용자 요청에 따라 기존 `~/.claude/agents/omp-deepseek.md` 변경은 별도 승인 전 적용하지 않는다. 현재 SHA256 `d084ae172744a25bc9cbcd4b670f36667c08ec4db75b66f20b1a76a4a5a64ac6`, launch는 21행이다. 다음 **실행 접두사만** 교체하고 기존 prompt, stdin, 모델, `--max-time 10m`, `--tools read,grep,glob` 등은 유지하는 제안이다.

```diff
-omp -p \
+"/Users/yohan/.nvm/versions/node/v22.23.3/bin/node" "/Users/yohan/Documents/ChatGPT/ai-pixel-office/orbit-works-p2a4/scripts/observe-omp.mjs" -- -p \
```

아직 적용·백업·실제 Claude 위임 연결 검증을 수행하지 않았다. 적용 승인 시 원본 해시 재확인→private 백업→접두사 한 곳만 수정→별도 OMP Bridge 시작→실제 위임 검사 순서로 진행한다. 포트 충돌 시 기존 서버를 종료하지 않는다. 복구는 검증한 private 백업의 원래 접두사로 되돌린다. Claude Hook settings와 OMP config/models/auth는 변경 대상이 아니다.
