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

---
## Archive
- [2026-04](history/archive/history-2026-04.md) — 8 entries
