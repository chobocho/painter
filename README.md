# Chobo Painter

HTML5 캔버스 기반의 웹 그림판입니다. TypeScript로 작성됐고 외부 런타임 의존성은 0개입니다 — 빌드 시 `tsc` 외에는 아무것도 설치하지 않아도 됩니다.

## 주요 기능

- **레이어 시스템** — 추가 / 삭제 / 순서 변경 / 가시성 / 투명도, dirty rect 기반 합성 렌더링
- **개선된 히스토리** — Command 패턴 (`PixelEdit`, `AddLayer`, `RemoveLayer`, `Reorder`, `SetLayerProps`), 메모리 예산 기반 eviction, 히스토리 패널에서 목록 + 현재 위치 표시, JSON 직렬화/복원
- **IndexedDB 저장 + 자동 저장** — 5초 주기 자동 저장 (포인터 누른 동안은 일시 정지), 마지막 프로젝트 자동 복원, 명명된 프로젝트 목록
- **JSON 가져오기/내보내기** — 레이어와 히스토리를 포함한 전체 프로젝트 상태 라운드트립
- **PNG 가져오기 + 배경 제거** — 크로마 키 알고리즘 (유클리드 RGB 거리) + 안티에일리어스 feather 가장자리
- **HTML5 Canvas 단일 파이프라인** — SVG/WebGL 없이 모두 캔버스
- **DPR 인식** — 디스플레이 픽셀 비율과 무관하게 내부 프로젝트 해상도 유지, 이미지 품질 손실 없음
- **통합 입력** — 키보드 / 마우스 / 터치를 단일 PointerEvent 어댑터로 처리
- **폴드7 펼친 화면 (~2208×1840)** — 스크롤 없이 사용 가능. 토글 가능한 우측 패널로 캔버스 영역 최대화 가능

## 도구

| 카테고리 | 도구 |
|---|---|
| 기본 | 펜슬 ✏️, 지우개 🩹, 채우기 🪣, 스포이드 💧 |
| 도형 | 직선 📏, 사각형 ▭ ▬, 정사각형 □ ■, 타원 ⬭ ⬬, 원 ○ ●, 삼각형 △ ▲ |
| 디럭스 페인트 풍 | 스프레이 💨, 그라디언트 🌈, 스머지 👆, 패턴 브러시 ✦, 좌우/상하 대칭 미러, 컬러 사이클링 |

도구 패널은 좌측에 2열 그리드로 배치되어 19개 도구가 모두 한눈에 보입니다.

### 도구 동작 메모

- **그라디언트** 🌈 — 디럭스 페인트 스타일. 빈 영역은 칠하지 않고 **이미 그려진 도형 안만** 그라디언트로 채웁니다. 사용 흐름: ① 도형 도구로 형태를 그리거나 fill bucket으로 영역을 채우고 ② 그라디언트 도구로 시작/끝점을 드래그하면 그 도형 안에 그라데이션이 적용됩니다.
- **스포이드** 💧 — 클릭한 위치의 색을 추출합니다. 활성 레이어만이 아니라 **모든 가시 레이어를 합성한 색**을 읽습니다 (사용자가 실제로 보고 있는 색). 색을 고르면 좌측 팔레트의 컬러 피커가 즉시 갱신되어 시각적 피드백을 줍니다.

## 단축키

- `B` 펜슬, `E` 지우개, `L` 직선, `R` 사각형 (`Shift+R` 칠해진 사각형), `C` 원 (`Shift+C` 칠해진 원), `F` 채우기, `G` 그라디언트, `S` 스프레이, `K` 스포이드, `U` 스머지, `P` 패턴
- `[` `]` 브러시 굵기 감소/증가
- `X` 전경/배경 색 교체
- `Ctrl+Z` 실행 취소, `Ctrl+Y` (또는 `Ctrl+Shift+Z`) 다시 실행
- `Ctrl+S` 프로젝트 저장, `Ctrl+Shift+N` 새 레이어, `Delete` 활성 레이어 비우기
- `M` 미러 토글

메뉴 바에는 단축키 외에도 큼지막한 ↶ / ↷ 버튼이 있고, 우측 히스토리 패널에도 같은 버튼이 있어 마우스/터치만으로도 실행 취소/다시 실행이 가능합니다. 우측 패널의 레이어/히스토리 섹션은 각각 ▼/▶ 버튼으로 접거나 펼칠 수 있고, 우측 패널 전체는 메뉴 바 좌측의 `📑 패널` 버튼이나 우상단의 원형 버튼으로 숨길 수 있습니다.

## 빌드 및 실행

```bash
# 1. TypeScript 컴파일 + 테스트 실행 + release/ 폴더에 배포본 복사
./build.sh

# 2. release 폴더의 index.html을 정적 서버로 띄우거나 직접 브라우저로 엽니다.
#    예) python3 -m http.server -d release 8000
```

빌드 산출물은 `release/` 폴더에 `index.html`, `style.css`, `js/`, `img/` 형태로 정리됩니다 (~360KB).

## 테스트

```bash
tsc                            # 컴파일
node dist/src/test/main.js     # 테스트 실행
```

127개 이상의 테스트 케이스가 다음을 검증합니다:
- **단위 테스트**: util / core (Layer, LayerStack, Canvas) / history / 도구별 픽셀 검증
- **회귀 테스트**: 기존 결함이 다시 들어오지 않도록 (`reset/replace` 리스너 보존, 펜슬 perf, 도형 commit, `pointerleave` 처리 등)
- **통합 테스트**: 실제 production `InputAdapter`에 모의 `PointerEvent`를 dispatch해서 도구 → 히스토리 → 레이어 픽셀까지 end-to-end 파이프라인 검증
- **UI 테스트**: LayerPanel 토글 상태 머신
- **Strict 모의 캔버스**: 잘못된 `drawImage` 호출 등 실제 브라우저가 throw하는 모든 호출을 모의에서도 throw — "테스트는 통과하는데 실제 기기는 망가짐" 종류의 버그를 사전 차단

## 디렉토리 구조

```
painter/
├── README.md            # 이 파일
├── history.md           # 다중 에이전트 작업 이력
├── build.sh             # tsc → 테스트 → release/ 복사
├── tsconfig.json
├── legacy/              # 원본 vanilla JS 페인터 (참고용)
├── src/
│   ├── index.html
│   ├── style.css
│   ├── img/             # 도구 / 컬러 아이콘
│   ├── app/             # PainterApp 오케스트레이터, main 엔트리
│   ├── core/            # Canvas, Layer, LayerStack
│   ├── history/         # Command, CommandHistory, Commands
│   ├── tools/           # 모든 도구 + ToolRegistry, StrokeUtil
│   ├── input/           # InputAdapter, Shortcuts
│   ├── storage/         # IndexedDBStore, AutoSaver
│   ├── io/              # PngImporter, BackgroundRemover, ProjectCodec
│   ├── ui/              # Toolbar, Palette, LayerPanel, HistoryPanel, ProjectPanel
│   ├── util/            # Rect, Color, Uid, Events
│   └── test/            # 단위/통합/회귀/UI 테스트 + 모의 (Canvas, IndexedDB, DOM)
└── release/             # 빌드 산출물 (gitignored)
```

## 다중 에이전트 작업 흐름

이 프로젝트는 한 명의 관리자(코디네이터) 에이전트가 기획 / 개발 / 검증 에이전트의 작업을 조율하는 방식으로 진화해 왔습니다. 라운드별 의사 결정과 발견된 버그, 수정 내용은 `history.md`에 한글로 정리되어 있습니다.

## 라이선스

MIT License
