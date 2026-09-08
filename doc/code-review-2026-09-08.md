# 코드 리뷰 결과 (2026-09-08)

- 대상: `src/` 전체 (app, core, history, tools, input, io, storage, ui, util, CSS/HTML, 빌드 스크립트)
- 검증: 컴파일 성공, 테스트 168 passed / 0 failed. "재현 확인" 표시 항목은 모의 캔버스로 실제 재현함.
- 용도: 이 목록을 기준으로 수정 작업을 진행한다. 권장 순서: 1 → 3 → 2 → 4 → 7 → 9.

---

## 🔴 치명 (데이터 손실 / 앱 멈춤)

### 1. 채우기(Fill) 무한 루프 → 브라우저 멈춤 (재현 확인)
- 위치: `src/tools/FillBucketTool.ts:38-72`
- 증상: 16×16 레이어에서도 힙 OOM. 방문 마스크 없이 "시드 색과의 거리 ≤ tolerance"만 검사하므로, 칠할 색이 시드 색과 허용오차 안에 있으면(예: `(250,250,250)` → 흰색, 허용 16) 이미 칠한 픽셀이 다시 매치되어 스택이 무한히 자란다. 조기 종료 검사(30행)는 완전 일치만 본다.
- 수정 방향: `GradientTool.buildFloodMask`처럼 방문 마스크를 사용하거나, 원본 복사본을 기준으로 매치.
- 회귀 테스트: 위 재현 조건이 그대로 RED 테스트가 된다.

### 2. 삼각형·정사각형·정원 undo 시 픽셀이 남음 (재현 확인)
- 위치: `src/tools/ShapeTools.ts:163-164, 183` (bbox 계산), `214-217` (정사각형), `232` (정원), `245` (삼각형 제3 꼭짓점)
- 증상: 삼각형 780px 중 167px, 정사각형 2025 중 1575, 정원 1926 중 1095가 undo 후 잔존. 커밋 rect를 포인터 위치 bbox로만 계산하는데, 삼각형은 `x2 = 2*x0 - x1`, 정사각형/정원은 `max(|dx|,|dy|)` 보정으로 포인터 범위 밖까지 그린다.
- 수정 방향: `drawShape`가 실제 도형 기하 rect를 반환해 bbox에 합치거나, shadow와 layer의 diff로 rect를 계산.

### 3. 자동 저장 프로젝트 ID 불일치 → 복원 시 옛 데이터 로드
- 위치: `src/storage/AutoSaver.ts:26-30`, `src/app/PainterApp.ts:250, 497-529, 544, 256-259`
- 증상: `autoSaver.start()`는 부팅 시 임시 ID로 한 번만 호출되고 `applyState`/`newProject`에서 갱신되지 않는다. 이후 자동 저장은 임시 ID로 기록되고, 복원은 `lastOpenProjectId`의 autosave를 읽으므로 지난 세션의 오래된 상태가 복원된다. 또한 `lastOpenProjectId`는 명시적 저장에서만 기록되어 Ctrl+S 없이는 자동 복원이 아예 동작하지 않는다.
- 수정 방향: `applyState`/`newProject`에서 `autoSaver.start(newId)` 호출, autosave flush 시 `lastOpenProjectId` 갱신, 복원 시 autosave와 projects 중 최신 선택.
- 회귀 테스트: `applyState` 후 `AutoSaver`가 어떤 키로 저장하는지 검증하는 테스트를 먼저 추가.

---

## 🟠 높음 (성능 / 기능 오류)

### 4. 레이어 추가·삭제·PNG 가져오기 시 13MB base64 문자열을 히스토리에 넣음
- 위치: `src/app/PainterApp.ts:382, 396, 596` (`layer.serialize()` 비압축 호출), `src/core/Layer.ts:226-247`
- 증상: 브라우저 경로 `encodeBase64`는 문자 단위 문자열 결합이라 1920×1280 레이어 1장에 약 1.6초(측정). undo 시 `decodeBase64`도 같은 비용.
- 수정 방향: `serialize({ compact: true })` 사용, 메모리 내 커맨드는 base64 대신 `Uint8ClampedArray`를 직접 보관, base64는 청크 단위로 인코딩.

### 5. 그라디언트 미리보기가 매 pointermove마다 전체 레이어를 순회
- 위치: `src/tools/GradientTool.ts:157-191` (마스크 bbox는 114-125행에서 이미 계산됨)
- 증상: 이동 이벤트마다 전체 `getImageData` + 2.4M 픽셀 루프 + `putImageData`.
- 수정 방향: bbox 내부만 순회, 마스크 픽셀 인덱스 목록을 pointerDown에서 미리 생성.

### 6. 채우기 도구가 전체 레이어를 두 번 읽고 before/after 전체(약 20MB)를 히스토리에 저장
- 위치: `src/tools/FillBucketTool.ts:18-20, 75-85`
- 수정 방향: 변경 픽셀 bbox를 추적해 그 영역만 저장.

### 7. 드래그 중 도구 전환·멀티터치 처리 없음
- 위치: `src/input/InputAdapter.ts:41-58`
- 증상: 도구를 이벤트마다 다시 조회하고 pointerId를 추적하지 않는다. 스트로크 중 단축키로 도구를 바꾸면 이전 도구의 drag가 고아가 되어 `ctx.save()`가 복구되지 않고, 스트로크가 커밋되지 않아 undo 불가, shadow 캔버스 누수. 두 번째 손가락이 닿으면 스트로크가 재시작된다.
- 수정 방향: pointerdown 시점의 도구와 pointerId를 고정하고, up/cancel까지 다른 포인터는 무시.

### 8. 새 프로젝트 생성 후 좌표 매핑 오류
- 위치: `src/app/PainterApp.ts:521-529` (`newProject`), `510` (`applyState`)
- 증상: `displayCanvas.setProjectSize`와 `fitCanvasToContainer`를 호출하지 않아 크기가 다른 새 프로젝트에서 포인터 좌표가 어긋난다. `applyState`는 크기만 갱신하고 refit을 안 해 화면이 늘어져 보인다. `prompt` 입력 검증이 없어 NaN/0/거대 값으로 캔버스 생성이 실패하고, 취소를 눌러도 프로젝트가 새로 만들어진다.

### 9. 레이어 투명도 슬라이더가 `input` 이벤트마다 히스토리 커맨드 생성 + 패널 전체 재렌더
- 위치: `src/ui/LayerPanel.ts:24, 121-125`, `src/app/PainterApp.ts:163`
- 증상: 드래그 한 번에 수십 개 히스토리 항목이 쌓이고, 드래그 중 슬라이더 DOM이 파괴되어 터치 조작이 끊긴다.
- 수정 방향: `input`에서는 `stack.setOpacity`로 미리보기만, `change`에서 커맨드 1개 커밋. 투명도 변경 시 전체 재렌더 회피.

### 10. PNG 가져오기가 레이어 5개 제한을 우회
- 위치: `src/app/PainterApp.ts:592-598`

---

## 🟡 중간

### 11. 글자 도구
- 위치: `src/tools/TextTool.ts`
- 오버레이 input 위치를 프로젝트 좌표를 화면 px로 그대로 사용(69-70행)해 엉뚱한 곳에 뜬다.
- 폭 추정 `0.6em`(122행)은 한글(약 1em)에 부족해 undo rect가 텍스트 오른쪽을 못 덮을 가능성이 크다 → `measureText` 사용.
- Escape 후 blur로 commit이 다시 호출될 수 있는 구조(81-96행) → `done` 플래그 필요.
- 62-63행 `canvas` 변수는 미사용.

### 12. 단축키
- 위치: `src/input/Shortcuts.ts:10-34`, `src/tools/ToolRegistry.ts:92`
- 글자 도구 `T`가 레지스트리와 README에는 있지만 SHORTCUTS에 없다.
- `e.key` 기반 매칭이라 한글 IME 상태에서는(`b` 대신 `ㅠ`) 모든 단축키가 동작하지 않는다 → `e.code` 폴백.

### 13. 프로젝트 로드 후 UI 컨트롤 미동기화
- 위치: `src/app/PainterApp.ts:508`
- 설정은 `Object.assign`으로 덮지만 굵기/허용 슬라이더, 대칭 체크박스, 팔레트, 패턴 선택은 갱신되지 않는다.

### 14. 허용오차 기준 불일치
- Fill은 RGBA 거리 `tol²×3`(`src/tools/FillBucketTool.ts:36`), Gradient는 `tol²×4`(`src/tools/GradientTool.ts:61`). README는 같은 기준이라고 설명한다.

### 15. 저장소
- 위치: `src/storage/IndexedDBStore.ts:83-88`, `src/ui/ProjectPanel.ts`
- 목록 조회가 `getAll`로 모든 프로젝트의 전체 JSON을 읽는다.
- autosave 항목 삭제 API와 프로젝트 삭제/이름 변경 UI가 없어 항목이 영구 누적되고, 이름이 항상 "Untitled"라 목록에서 구분이 안 된다.
- `ProjectPanel.render`가 async라 동시 호출 시 목록이 중복될 수 있다.

### 16. RLE 최악 경우와 자동 저장 부하
- 위치: `src/core/Layer.ts:190-207`, `src/storage/AutoSaver.ts:39-53`
- 노이즈가 많은 레이어(스프레이·사진)는 RLE가 raw의 1.5배(14.7MB vs 9.8MB)가 되고, JS `number[]`로 만들어 약 550ms, 힙 500MB(측정)를 쓴다. 자동 저장이 5초마다 메인 스레드에서 이를 실행한다.
- 수정 방향: RLE가 더 크면 raw 폴백, `Uint8Array` 사전 할당, 변경 없는 레이어는 직전 직렬화 결과 재사용, 장기적으로 `canvas.toBlob` PNG.

### 17. dirty rect 파이프라인이 죽은 코드
- `render()`는 항상 전체 합성(`src/app/PainterApp.ts:421-432`), `consumeDirty`는 호출처 없음(`src/core/LayerStack.ts:120`). 제거하거나 실제로 사용.

### 18. 종료 시 저장 불완전
- `beforeunload`의 `flushNow`는 비동기라 IDB 쓰기가 완료되지 않을 수 있다(`src/app/PainterApp.ts:270`).
- `flushNow`는 await 후 `dirty=false`로 만들어 저장 중 발생한 편집이 다음 변경까지 유실된다(`src/storage/AutoSaver.ts:44-53`).

### 19. 마지막 레이어 삭제 가드 없음
- 위치: `src/app/PainterApp.ts:391-397`

### 20. 미사용 코드
- `ColorCyclingEngine`(`src/tools/ColorCycling.ts`, README는 기능으로 소개하지만 앱에 연결 안 됨)
- `ToolSettingsEmitter`(`src/tools/Tool.ts:78-84`)
- `src/app/PainterApp.ts:636`의 `_ver` 내보내기 꼼수 (import를 제거하면 됨)

---

## 🟢 낮음 / 문서·빌드

### 21. `build.bat`가 `build.sh`와 다름
- 다중 파일 스테이징, 존재하지 않는 `legacy/img` 복사, 정의되지 않은 `!size!`. README 빌드 절도 옛 다중 파일 구조를 설명한다.

### 22. 빌드 의존성 미고정
- `build.sh`가 전역 `tsc`와 네트워크 `npx esbuild`에 의존한다. `package.json`에 devDependencies 고정 권장.

### 23. `Color.parse`가 잘못된 입력에 조용히 검정을 반환
- 위치: `src/util/Color.ts:62`. 배경 제거 프롬프트에 오타를 내면 검정이 제거된다.

### 24. 입력 검증 부재
- `rleDecodeRGBA`(`src/core/Layer.ts:209-223`)와 `ProjectCodec.decode`(`src/io/ProjectCodec.ts:31-35`)에 검증이 없어 손상된 JSON이 조용히 깨진 픽셀을 만든다.

### 25. CSS
- `.tool-label` 7px 글꼴(접근성, `src/style.css:195`), `#app`의 `100vh`는 모바일 주소창 문제로 `100dvh` 권장(`src/style.css:26`).

### 26. 주석 언어
- 코드 주석이 전부 영어라 CLAUDE.md의 한국어 주석 규칙과 어긋난다. 일괄 번역은 권하지 않고, 수정하는 부분부터 한국어로 쓰는 방침 결정이 필요하다.
