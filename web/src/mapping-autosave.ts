import { ApiError, api } from "./api";
import type { MappingItem, PipelineState } from "./pipeline-api";
import { pipelinePath } from "./pipeline-api";

export type MappingSaveStatus = "saved" | "pending" | "saving" | "error" | "conflict";
export type MappingSnapshot = { status: MappingSaveStatus; error: string; dirty: number };
type StoredDraft = { revision: number; items: MappingItem[] };

const normalized = (item: MappingItem) => JSON.stringify({
  sourceId: item.sourceId,
  sourceVersion: item.sourceVersion,
  disposition: item.disposition,
  uses: item.uses.map((use) => ({
    unitId: use.unitId,
    role: use.role,
    firstPage: use.firstPage ?? null,
    lastPage: use.lastPage ?? null,
    relatedSourceId: use.relatedSourceId ?? null,
    order: use.order ?? null,
  })),
});

export class MappingAutosave {
  private revision: number;
  private queue = new Map<string, MappingItem>();
  private timer?: ReturnType<typeof setTimeout>;
  private request?: Promise<boolean>;
  private listeners = new Set<() => void>();
  private snapshot: MappingSnapshot = { status: "saved", error: "", dirty: 0 };
  private readonly storageKey: string;

  constructor(
    private courseId: number,
    state: PipelineState,
    private onState: (state: PipelineState) => void,
    private storage?: Storage,
    private delay = 400,
  ) {
    this.revision = state.revision;
    this.storageKey = `study-space:mapping-draft:v1:${courseId}`;
    try {
      const raw = storage?.getItem(this.storageKey);
      if (raw) {
        const draft = JSON.parse(raw) as StoredDraft;
        if (Array.isArray(draft.items)) {
          for (const item of draft.items)
            if (item?.sourceId) this.queue.set(item.sourceId, item);
        }
        if (this.queue.size) {
          this.snapshot = draft.revision === this.revision
            ? { status: "pending", error: "", dirty: this.queue.size }
            : { status: "conflict", error: "Die Zuordnung wurde seit dem lokalen Entwurf geändert.", dirty: this.queue.size };
        }
      }
    } catch {
      /* Browser recovery storage is best effort only. */
    }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;

  private emit(status: MappingSaveStatus, error = "") {
    this.snapshot = { status, error, dirty: this.queue.size };
    for (const listener of this.listeners) listener();
  }
  private remember() {
    try {
      if (this.queue.size)
        this.storage?.setItem(this.storageKey, JSON.stringify({ revision: this.revision, items: [...this.queue.values()] } satisfies StoredDraft));
      else this.storage?.removeItem(this.storageKey);
    } catch {
      /* Persistence failures remain visible through the server save state. */
    }
  }

  enqueue(items: MappingItem[]) {
    let changed = false;
    for (const item of items) {
      const current = this.queue.get(item.sourceId);
      if (!current || normalized(current) !== normalized(item)) {
        this.queue.set(item.sourceId, item);
        changed = true;
      }
    }
    if (!changed) return;
    this.remember();
    this.emit("pending");
    this.schedule();
  }
  start() {
    if (this.queue.size && this.snapshot.status === "pending") this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer);
    if (this.snapshot.status === "pending" && !this.request)
      this.timer = setTimeout(() => void this.flush(), this.delay);
  }

  async flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.request) {
      if (!await this.request) return false;
      return this.flush();
    }
    if (this.snapshot.status === "conflict") return false;
    if (!this.queue.size) {
      this.emit("saved");
      return true;
    }
    const submitted = [...this.queue.values()];
    const signatures = new Map(submitted.map((item) => [item.sourceId, normalized(item)]));
    this.emit("saving");
    this.request = (async () => {
      try {
        const state = await api<PipelineState>(`${pipelinePath(this.courseId)}/mapping`, {
          method: "POST",
          body: JSON.stringify({
            expectedRevision: this.revision,
            items: submitted,
            actor: "user",
            reason: "Zuordnung in der Übersicht bestätigt.",
          }),
        });
        this.revision = state.revision;
        this.onState(state);
        for (const item of submitted) {
          const current = this.queue.get(item.sourceId);
          if (current && normalized(current) === signatures.get(item.sourceId))
            this.queue.delete(item.sourceId);
        }
        this.remember();
        this.emit(this.queue.size ? "pending" : "saved");
        return true;
      } catch (error) {
        this.remember();
        this.emit(
          error instanceof ApiError && error.status === 409 ? "conflict" : "error",
          error instanceof Error ? error.message : "Speichern fehlgeschlagen",
        );
        return false;
      }
    })();
    const ok = await this.request;
    this.request = undefined;
    if (ok && this.queue.size) {
      this.emit("pending");
      return this.flush();
    }
    return ok;
  }

  accept(state: PipelineState) {
    if (state.revision === this.revision) return;
    if (this.queue.size) {
      this.emit("conflict", "Die Zuordnung wurde an anderer Stelle geändert.");
      return;
    }
    this.revision = state.revision;
    this.onState(state);
    this.emit("saved");
  }
  retry() {
    if (this.snapshot.status === "error") {
      this.emit("pending");
      this.schedule();
    }
  }
  resolve(state: PipelineState, keepLocal: boolean) {
    this.revision = state.revision;
    if (!keepLocal) this.queue.clear();
    this.onState(state);
    this.remember();
    this.emit(this.queue.size ? "pending" : "saved");
    if (this.queue.size) this.schedule();
  }
  stop() {
    clearTimeout(this.timer);
  }
}
