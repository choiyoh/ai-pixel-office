# 에셋 출처와 규격

## 직접 제작

`public/characters/char_0.png`–`char_5.png`는 `scripts/assets.ts`의 pixel primitives로 직접 제작한 원본 도트 그림이다. 기존 캐릭터를 복사하거나 제3자 이미지를 수정하지 않았다. 동일 스크립트로 재생성할 수 있으며 이 저장소의 MIT 라이선스를 적용한다. 생성된 PNG도 저장소에 포함한다.

| 인덱스 | 캐릭터 | 머리·의상·액세서리 |
|---|---|---|
| 0 | Claude Code | 밤색 삐죽머리, 테라코타 재킷, 밝은 넥타이 |
| 1 | DeepSeek Dev | 짙은 짧은 머리, 파란 재킷, 하늘색 캡 |
| 2 | DeepSeek Analyst | 보라색 긴 머리, 라벤더 재킷, 안경·헤어핀 |
| 3 | Hermes | 올린 머리, 민트 재킷, 초록 헤드밴드 |
| 4 | OpenCode | 갈색 단발, 노란 재킷, 회색 헤드셋 |
| 5 | Nova | 자주색 긴 머리, 분홍 재킷, 분홍 비니 |

각 시트는 112×96 PNG, 프레임은 16×32, 7열×3행이다. 행은 down/up/right, 열은 walk1/2/3, type1/2, read1/2. left는 원본 엔진에서 right 반전으로 처리한다. 독서 프레임에는 펼친 책, 타이핑 프레임에는 손 위치 변화, 이동 프레임에는 발·몸 높이 변화가 있다.

앱의 matte floor 두 패턴도 같은 스크립트에서 원본 픽셀 배열로 생성한다. 별도 외부 font나 CDN 이미지는 사용하지 않고 시스템 글꼴을 사용한다. 상표·에이전트 이름은 표시용이며 공급자와의 제휴나 실제 연결을 뜻하지 않는다.

## 재사용한 Pixel Agents 자료

- 출처: https://github.com/pixel-agents-hq/pixel-agents
- 고정 커밋: `d1e007a9fdf3003c252d2973abe1999ae59aec33`
- 원본 위치: `webview-ui/public/assets/furniture/`, `assets/walls/`, 공통 PNG decoder와 Canvas engine.
- 라이선스 확인: 원본 루트 LICENSE의 MIT, README License 절 및 번들 assets 경로를 확인했다. 별도 유료 tileset을 받거나 사용하지 않았다.
- 가구·벽의 렌더 데이터를 `public/engine-assets.json`으로 생성하며 배포 bundle에는 원본 코드를 포함한다. 원본 저작권 고지를 `public/THIRD-PARTY-NOTICES.txt`에 포함했다.
- 원본 문서의 Donarg 유료 Office Interior Tileset은 참고 링크일 뿐 이 앱에서 신규 다운로드하지 않았다. 향후 외부 팩을 추가하면 해당 팩의 개별 권리를 다시 확인해야 한다.

`public/engine-assets.json`과 `dist/`는 생성물로 git에서 제외한다. 소스·원본 고정 SHA·lockfile·스프라이트와 생성 스크립트로 재생성한다. 현재 앱은 인접한 원본 체크아웃의 엔진을 직접 import한다. 프로젝트 폴더 하나만 복사해서 독립적으로 빌드할 수 있다고 주장하지 않는다.
