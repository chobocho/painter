import { IndexedDBStore, StoredAutoSave } from "./IndexedDBStore.js";
import { LayerStack } from "../core/LayerStack.js";
import { CommandHistory } from "../history/CommandHistory.js";

export interface AutoSaverOptions {
  intervalMs?: number;
  serialize: () => string;
}

export class AutoSaver {
  private dirty = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private projectId: string | null = null;
  private pointerDown = false;

  constructor(
    private store: IndexedDBStore,
    private stack: LayerStack,
    private history: CommandHistory,
    private opts: AutoSaverOptions
  ) {
    history.on("change", () => { this.dirty = true; });
    stack.on("change", () => { this.dirty = true; });
  }

  start(projectId: string): void {
    this.projectId = projectId;
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, this.opts.intervalMs ?? 5000);
  }

  /**
   * 자동 저장 대상 프로젝트를 바꾼다. 프로젝트를 새로 만들거나 불러온 뒤
   * 반드시 불러야 한다. 이걸 빠뜨리면 부팅 때 쓰던 임시 ID 아래에 계속
   * 저장되고, 복원은 lastOpenProjectId 를 보므로 지난 세션의 옛 상태가 올라온다.
   */
  setProjectId(projectId: string): void {
    this.projectId = projectId;
  }

  getProjectId(): string | null { return this.projectId; }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setPointerDown(v: boolean): void { this.pointerDown = v; }

  async tick(): Promise<void> {
    if (!this.dirty || !this.projectId || this.pointerDown) return;
    await this.flushNow();
  }

  async flushNow(): Promise<void> {
    if (!this.projectId) return;
    const projectId = this.projectId;
    // dirty 를 먼저 내린다. 직렬화와 IDB 쓰기 사이에 들어온 편집은 곧바로 다시
    // dirty 로 올라와 다음 저장에 잡힌다. 예전처럼 await 뒤에 내리면 그 편집이
    // "저장됨"으로 표시되어 다음 변경이 있을 때까지 통째로 유실됐다.
    this.dirty = false;
    const payload: StoredAutoSave = {
      id: projectId,
      savedAt: Date.now(),
      projectJson: this.opts.serialize(),
    };
    try {
      await this.store.putAutoSave(payload);
      // 복원 대상도 함께 기록한다. 예전에는 명시적 저장(Ctrl+S)에서만 기록해서
      // 자동 저장만 쓰는 사용자는 다음 실행에서 아무것도 복원되지 않았다.
      await this.store.putMeta("lastOpenProjectId", projectId);
    } catch (e) {
      // 저장에 실패했으면 아직 저장되지 않은 상태다.
      this.dirty = true;
      throw e;
    }
  }

  isDirty(): boolean { return this.dirty; }
}
