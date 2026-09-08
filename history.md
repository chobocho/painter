# Painter Rewrite — Agent Activity Log

## 2026-04-10 — Round 9: PNG 캔버스 미갱신, 글자 팝업 반복, 에러 묵음 수정

Round 8 배포 후 사용자가 실기기(Fold7)에서 테스트하면서 새로운 증상과 재발을 보고:

### 사용자 보고 이슈
- #9 PNG 불러와도 캔버스에 반영 안 됨 (NEW)
- #10 글자 입력 누르면 계속 팝업이 뜸 (NEW)
- #4 히스토리 여전히 미기록 (재발 / 방어 부족)
- #5 레이어 추가 여전히 안 됨 (재발 / 방어 부족)
- #11 JSON 불러오기 여전히 안 됨 (재발 / 방어 부족)

### 설계 분석

| 이슈 | 원인 |
|---|---|
| #10 팝업 반복 | `TextTool.onPointerDown`이 OS 네이티브 `prompt()` 다이얼로그 사용 → Fold7처럼 멀티-터치 환경에서 매 클릭마다 팝업. |
| #9 PNG 캔버스 미갱신 | `importPng`가 `async` 함수인데 완료 후 `scheduleRender()` 미호출. `stack.on("change")` 이벤트는 정상 발화하나 일부 브라우저에서 `requestAnimationFrame` 큐가 밀림. 에러 발생 시 Promise가 조용히 reject되어 원인 불명. |
| #4/#5 재발 | `importJson`/`addLayer` 내부 예외가 `try/catch` 없이 콘솔에만 노출되거나 묻힘. `applyState` 실행 후 `layerPanel`/`historyPanel` 명시적 렌더 없이 이벤트 리스너 경로에만 의존. |
| #11 JSON 로드 | `importJson`에 `try/catch` 없어 에러 묻힘; 사용자에게 실패 피드백 없음. |

### 테스트 먼저 (`src/test/round9.test.ts`)

8개 신규 케이스:
- `importPngFile` 반환 레이어가 빈 픽셀이 아님을 검증 (issue 9)
- `AddLayerCommand`로 PNG 레이어를 스택에 추가 후 스택 크기 2 확인 (issue 9)
- `setNextText` 경로에서 `prompt()`가 0회 호출되는지 검증 (issue 10)
- 오버레이 경로(no setNextText)에서 prompt 최대 1회 검증 (issue 10)
- `decode("{bad}")` → throw 확인 (issue 11)
- `decode('{"layers":[]}')` (version 없음) → throw 확인 (issue 11)
- compact round-trip → decode OK 확인 (issue 11)
- HistoryPanel이 `replace({past:[]})` 후 "(0)" 표시 → execute 후 "(1)" 표시 (issue 4)

### 구현

- **`src/tools/TextTool.ts` 전면 재작성** — `prompt()` 완전 제거. 대신 포인터다운 시 `document.body`에 fixed-position `<input>` 오버레이를 동적으로 삽입. Enter/blur → 텍스트 커밋 + 오버레이 제거. Escape → 취소. DOM 없는 환경(Node 테스트)에서는 `setNextText()` 세임 또는 fallback prompt 사용. Fold7 터치 환경에서 팝업 루프 완전 해소.
- **`src/app/PainterApp.ts`** — `importPng` / `importJson` / `addLayer` 모두 `try/catch` 추가. 성공/실패 모두 `flashStatus`로 사용자 피드백. `importPng` 완료 후 `scheduleRender()` 명시적 추가. `applyState` 끝에 `layerPanel.render()`, `historyPanel.render()` 명시적 호출 추가.

### 검증

- `tsc` 0 error.
- `node dist/src/test/main.js`: **168/168 pass** (이전 160 + 신규 8).
- `./build.sh` 전체 파이프라인 녹색. 산출물 394 KB.

다음 세션은 `node dist/src/test/main.js | tail -5`로 `# pass 168` 확인 후 시작.


## 2026-09-08 — 코드 리뷰(doc/code-review-2026-09-08.md) 후속 수정

### [2026-09-08 04:03] 리뷰 #1/#6 채우기 무한 루프·히스토리 과다 저장 수정
- **기획:** 매치 판정을 갱신 중인 버퍼가 아닌 원본 스냅샷 기준으로 바꾸고 방문 마스크를 도입. 변경 픽셀 bbox만 히스토리에 저장.
- **TC:** (정상) bbox 크기 검증, undo 복원. (엣지) 칠할 색이 시드 색 허용오차 안 → ImageData 읽기 예산 프록시로 무한 루프 검출.
- **개발:** `src/tools/FillBucketTool.ts`, `src/test/round10.test.ts`, `src/test/main.ts`
- **검증:** 171 passed, 0 failed
- **비고:** 레이어 전체 getImageData 2회 → 1회로 축소. 리뷰 #14(허용오차 기준 불일치)는 별건으로 남음.

### [2026-09-08 04:12] 리뷰 #3 자동 저장 프로젝트 ID 불일치 수정
- **기획:** 자동 저장 대상 ID를 프로젝트 전환 시 갱신하고, 자동 저장 시 복원 대상도 함께 기록. 복원은 자동/명시 저장본 중 최신을 선택.
- **TC:** (정상) 최신본 선택, setProjectId 후 새 ID로 저장. (엣지) 한쪽만 존재/둘 다 없음, 임시 ID로 저장되지 않는지.
- **개발:** `src/storage/AutoSaver.ts`, `src/app/PainterApp.ts`, `src/test/round10.test.ts`
- **검증:** 175 passed, 0 failed
- **비고:** 리뷰 #8(새 프로젝트 좌표 매핑)은 별건으로 남음.

### [2026-09-08 04:20] 리뷰 #2 도형 undo 잔존 픽셀 수정
- **기획:** `drawShape`가 실제 기하 범위(Bbox)를 반환하도록 하고 커밋 bbox에 합침. shadow 복원 구조상 이동마다 bbox를 시작점부터 재계산.
- **TC:** (정상) 삼각형/정사각형/정원 그린 뒤 undo → 잔존 픽셀 0. (엣지) 포인터 범위 밖으로 확장되는 방향으로 드래그.
- **개발:** `src/tools/ShapeTools.ts`, `src/test/round10.test.ts`
- **검증:** 178 passed, 0 failed
- **비고:** 수정 전 잔존 삼각형 39px / 정사각형·정원도 다수.

### [2026-09-08 04:31] 리뷰 #4 히스토리 비압축 base64 제거
- **기획:** 레이어 추가/삭제/PNG 가져오기의 스냅샷을 `historySnapshot()`(compact)로 일원화. 브라우저 base64 폴백을 청크 인코딩으로 교체.
- **TC:** (정상) 스냅샷에 rawRGBA 없음·RLE 존재, 압축본 픽셀 복원. (엣지) Buffer 없는 폴백 경로 결과가 Node 경로와 바이트 동일 + 라운드트립.
- **개발:** `src/app/PainterApp.ts`, `src/core/Layer.ts`, `src/test/round10.test.ts`
- **검증:** 181 passed, 0 failed
- **비고:** 폴백 인코딩 실측 1920×1280 기준 3.62s → 1.65s. 빈 레이어는 픽셀 데이터 자체를 담지 않음.

### [2026-09-08 04:42] 리뷰 #7 드래그 중 도구 전환·멀티터치 처리
- **기획:** pointerdown 시점의 도구와 pointerId 를 스트로크에 고정. 다른 포인터의 down/move/up/cancel 은 무시.
- **TC:** (정상) 전환된 도구는 다음 스트로크부터 사용. (엣지) 스트로크 도중 도구 전환, 두 번째 손가락 down/move/up, 다른 포인터의 cancel.
- **개발:** `src/input/InputAdapter.ts`, `src/test/round10.test.ts`
- **검증:** 185 passed, 0 failed
- **비고:** 고아 drag 로 인한 `ctx.save()` 미복구·커밋 누락·shadow 누수 경로 제거.

### [2026-09-08 04:55] 리뷰 #9 투명도 슬라이더 히스토리 폭주·재렌더 수정
- **기획:** `input`은 미리보기(`OpacityDrag.preview`), `change`에서만 커맨드 1개 커밋. 드래그 중에는 패널 재렌더를 막아 슬라이더 DOM 유지.
- **TC:** (정상) input 3회 → 커밋 0, change → 커밋 1, undo 시 드래그 이전 값 복원. (엣지) 값 변화 없음, preview 없이 commit만.
- **개발:** `src/ui/LayerPanel.ts`, `src/app/PainterApp.ts`, `src/test/round10.test.ts`, `src/test/ui.test.ts`
- **검증:** 190 passed, 0 failed
- **비고:** `LayerPanelHandlers`에 `onOpacityPreview` 추가(내부 인터페이스).

### [2026-09-08 04:52] 릴리스 번들 재빌드
- **기획:** 리뷰 #1/#2/#3/#4/#7/#9 수정이 반영된 단일 파일 릴리스 갱신.
- **TC:** 별도 추가 없음(기존 190 케이스가 번들 소스를 검증).
- **개발:** `release/index.html`
- **검증:** 190 passed, 0 failed / esbuild 번들 135KB → 인라인 HTML 144KB
- **비고:** 로컬에 전역 tsc·esbuild 가 없어 build.sh 대신 동일 파이프라인을 스크래치패드 바이너리로 실행.

### [2026-09-08 05:05] 리뷰 #5 그라디언트 미리보기 범위 축소
- **기획:** pointerDown 에서 마스크 픽셀 인덱스와 bbox 를 만들어 두고, 미리보기는 bbox 만 get/putImageData 하며 마스크 픽셀만 순회.
- **TC:** (정상) 미리보기 후 색·undo 결과 동일. (엣지) 이동 3회 동안 ImageData 호출 크기가 bbox 규모(≤100px)인지 계측.
- **개발:** `src/tools/GradientTool.ts`, `src/test/round10.test.ts`
- **검증:** 192 passed, 0 failed
- **비고:** 64×64 기준 이동당 4096px → 16px. markDirty 도 bbox 로 축소.

### [2026-09-08 05:14] 리뷰 #8 새 프로젝트 크기 검증·좌표 리핏
- **기획:** `parseProjectSize()`로 입력 검증(취소·비숫자·0 이하 거부, 상한 8192 clamp), 생성/로드 후 `setProjectSize` + 리핏 호출.
- **TC:** (정상) 정수·공백·소수 입력. (엣지) 취소(null), 문자열, 0, 음수, 1e9 상한 clamp.
- **개발:** `src/app/PainterApp.ts`, `src/test/round10.test.ts`
- **검증:** 195 passed, 0 failed
- **비고:** prompt 문구를 한글로 통일. 취소 시 프로젝트를 만들지 않도록 변경.

---
## Archive
- [2026-04](history/archive/history-2026-04.md) — 8 entries
