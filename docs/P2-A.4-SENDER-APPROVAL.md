# P2-A.4 송신기 변경 승인안 — 미적용

현재 등록된 12종 Hook은 재등록하거나 settings.json을 수정하지 않습니다. 원래 checkout/dist 경로의 송신기는 아직 P2-A.3 버전입니다. 변경 소스와 빌드는 별도 orbit-works-p2a4 작업 폴더에만 있습니다.

## 변경 Diff의 범위

- `scripts/claude-forwarder.mjs`: stdin에서 허용 필드만 추출한 후, 실행 중인 Claude 조상 프로세스의 PID와 생성 시각 표식을 `orbit_execution: {version: 1, pid, birth}`로 추가합니다.
- `platform/claude-execution.mjs`: 읽기 전용 프로세스 조회. macOS ps, Linux /proc, Windows CIM으로 PID/parent PID/생성 표식/실행 파일 이름만 확인합니다. 명령줄·환경·프롬프트·transcript·파일 경로는 읽지 않습니다. Mac의 버전 파일명은 로컬 PATH의 claude 링크 대상 파일명과 대조하고 경로 자체는 전달하지 않습니다. shell을 최대 5단계만 따라가며 Claude native executable을 확인할 수 없으면 실행 증명을 붙이지 않습니다.
- 수신기: 매 이벤트마다 현재 살아 있는 Claude 프로세스와 생성 표식을 대조합니다. OS 식별자는 private HMAC으로만 보존하고 UI에 전달하지 않습니다. 기존 sender의 무표식 이벤트는 종전 최초 세션 처리만 허용하며, 증명된 generation의 이벤트를 덮어쓸 수 없습니다.
- Resume: 종료 기록이 있는 논리 세션에서 명시적 `SessionStart/source=resume`, 아직 사용하지 않은 새 프로세스 인스턴스, **마지막 SessionEnd 관측 시각 이후에 생성된 프로세스**가 모두 확인될 때만 generation을 증가시킵니다. actorId/renderId/palette/좌석 키는 보존합니다. 이전 실행의 이벤트와 반복 SessionStart는 재활성화를 만들지 않습니다.
- 같은 CLI 프로세스 내부의 대화 전환 `/resume`은 새로운 실행임을 확증할 수 없어 종료 후 재활성화를 거부합니다. macOS 생성 표식의 초 단위 정밀도 때문에 너무 빠른 재실행도 모호하면 거부합니다. `--resume` 새 프로세스가 이번 검증 대상입니다. 강한 eventId/sequence/spool/replay 보장을 새로 주장하지 않습니다.
- clear/fork는 새 native ID 생성으로만 관찰합니다. compact는 활성 generation의 동일 실행에서만 반영합니다. 종료 identity를 이들 source로 부활시키지 않습니다.
- private ledger v1을 bytes 삭제 없이 v2로 읽어 들이고 다음 정상 이벤트 때 영속화합니다. generation별 tombstone을 유지하며 상한에서 임의 삭제하지 않습니다.

전체 실제 소스 Diff: `P2-A.4-SENDER.diff` (동일 폴더).

## 승인 후 로컬 적용

1. 최종 커밋/빌드/테스트가 완료된 코드만 기존 checkout에 반영하여, 등록된 절대경로의 dist/claude-forwarder.cjs를 갱신합니다. settings.json과 기존 Hook 수·command는 그대로입니다.
2. 현재 4173에는 서버가 없으며 registry가 가리킨 PID도 존재하지 않습니다. 파일의 소유권·권한·내용을 다시 대조한 후 이 **종료된 자신의 수집기 registry만** private backup으로 보관하고 runtime 위치에서 제거합니다. ledger는 삭제하지 않습니다.
3. private ledger의 원본 bytes와 mode를 private backup으로 보존한 뒤 새 수집기를 시작하고 실제 Claude/--resume를 검사합니다. 새 실행 중 서버를 재시작할 때도 이 테스트에서 시작한 프로세스만 정상 종료합니다.
4. 신규 실행에서 문제를 발견하면 실제 Live PASS를 보류하고 결과를 보고합니다. 설정을 초기화하거나 기존 Claude/Command Code/DeepSeek/OMP 인증·위임 스크립트를 변경하지 않습니다.

설정 파일 수정은 필요 없습니다. 승인 요청은 송신기 실행 파일 갱신, 검증된 stale registry 보관·정리, 새 수집기 실행과 자신의 테스트 서버 재시작에 한정됩니다.
