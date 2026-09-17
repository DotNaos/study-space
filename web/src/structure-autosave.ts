import { ApiError } from "./api";
import { structureDraft, unitLabel } from "./learning-structure";
import type { PipelineState, PipelineUnit } from "./pipeline-api";

export type SaveStatus = "proposal" | "saved" | "pending" | "saving" | "error" | "conflict" | "invalid";
export type StructureSnapshot = { units: PipelineUnit[]; status: SaveStatus; error: string };
export type StructureSave = (units: PipelineUnit[], expectedRevision: number, deletedUnitIds?: string[]) => Promise<PipelineState>;
export type DraftStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };

// Normalize optional fields for comparison, never reorder user content by title.
export const structureKey = (units: PipelineUnit[]) => JSON.stringify(units.map(unit => ({
  id: unit.id, title: unit.title, customTitle: unit.customTitle ?? null,
  parentId: unit.parentId, order: unit.order, kind: unit.kind ?? "script",
  hidden: unit.hidden ?? false, sourceGroupId: unit.sourceGroupId ?? null,
  scriptUnitIds: unit.scriptUnitIds ?? [],
})));
const valid = (units: PipelineUnit[]) => units.length <= 250 && units.every(unit => unitLabel(unit).trim().length > 0 && unitLabel(unit).length <= 250);

/** One writer per editor: edits during a request are queued against its returned revision. */
export class StructureAutosave {
  private revision: number;
  private acknowledged: string;
  private acknowledgedUnits: PipelineUnit[];
  private confirmed: boolean;
  private timer?: ReturnType<typeof setTimeout>;
  private request?: Promise<boolean>;
  private listeners = new Set<() => void>();
  private snapshot: StructureSnapshot;
  private key: string;
  private scope: string[];
  private lastAttempt?: string;
  private readonly writer = crypto.randomUUID();
  private hasWrittenDraft = false;

  constructor(state: PipelineState, private save: StructureSave, private storage?: DraftStorage, private delay = 650) {
    this.revision = state.revision;
    this.scope = (state.sources ?? []).map(item => item.source.id);
    this.key = `study-space:structure-draft:v1:${state.courseId}`;
    const units = structureDraft(state);
    this.acknowledged = structureKey(units);
    this.acknowledgedUnits = state.units;
    this.confirmed = state.units.length > 0 || (state.history ?? []).some(event => event.action === "structure");
    this.snapshot = { units, status: this.confirmed ? "saved" : "proposal", error: "" };
    try {
      const raw = storage?.getItem(this.key);
      if (raw) {
        const draft = JSON.parse(raw);
        const sameCourseSources = Array.isArray(draft.scope) && draft.scope.some((id: string) => this.scope.includes(id));
        const safeUnits = Array.isArray(draft.units) && draft.units.length <= 250 && draft.units.every((unit: PipelineUnit) =>
          unit && typeof unit.title === "string" && /^[a-f0-9]{32}$/.test(unit.id) && (unit.customTitle == null || typeof unit.customTitle === "string"));
        if (sameCourseSources && safeUnits && structureKey(draft.units) !== this.acknowledged) {
          this.snapshot = { units: draft.units, status: draft.revision === this.revision ? "pending" : "conflict", error: "" };
        }
      }
    } catch { /* Unavailable browser storage never blocks server persistence. */ }
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  get dirty() { return structureKey(this.snapshot.units) !== this.acknowledged; }
  private emit(status: SaveStatus, error = "") { this.snapshot = { ...this.snapshot, status, error }; for (const listener of this.listeners) listener(); }
  private remember() {
    try {
      const current = this.storage?.getItem(this.key);
      // A late response from an unmounted editor must not replace the next editor's recovery draft.
      if (this.hasWrittenDraft && current && JSON.parse(current).writer !== this.writer) return;
      this.storage?.setItem(this.key, JSON.stringify({ revision: this.revision, scope: this.scope, units: this.snapshot.units, writer: this.writer }));
      this.hasWrittenDraft = true;
    } catch { /* Best effort recovery; failures remain visible until the server acknowledges. */ }
  }
  private clearDraft() {
    try { const current = this.storage?.getItem(this.key); if (current && JSON.parse(current).writer === this.writer) this.storage?.removeItem(this.key); }
    catch { /* No authority changes. */ }
  }
  update = (value: PipelineUnit[] | ((units: PipelineUnit[]) => PipelineUnit[])) => {
    const units = typeof value === "function" ? value(this.snapshot.units) : value;
    if (structureKey(units) === structureKey(this.snapshot.units)) return;
    const blocked = this.snapshot.status === "conflict";
    this.snapshot = { ...this.snapshot, units };
    this.remember();
    this.emit(blocked ? "conflict" : !valid(units) ? "invalid" : this.dirty ? "pending" : this.confirmed ? "saved" : "proposal");
    this.schedule();
  };
  start() { if (this.dirty) this.remember(); this.schedule(); }
  private schedule() {
    clearTimeout(this.timer);
    if (this.snapshot.status === "pending" && !this.request) this.timer = setTimeout(() => { void this.flush(); }, this.delay);
  }
  async flush(confirm = false): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.request) { if (!await this.request) return false; return this.flush(confirm); }
    if (this.snapshot.status === "conflict") return false;
    if (!valid(this.snapshot.units)) { this.emit("invalid"); return false; }
    if (!this.dirty && (!confirm || this.confirmed)) { this.emit(this.confirmed ? "saved" : "proposal"); return true; }
    const submitted = this.snapshot.units;
    const signature = structureKey(submitted);
    this.lastAttempt = signature;
    this.remember();
    this.emit("saving");
    this.request = (async () => {
      try {
        const deletedUnitIds = this.acknowledgedUnits.filter(unit => unit.sourceGroupId == null && !submitted.some(item => item.id === unit.id)).map(unit => unit.id);
        const state = await this.save(submitted, this.revision, deletedUnitIds);
        this.revision = state.revision;
        this.confirmed = true;
        this.acknowledged = structureKey(state.units);
        this.acknowledgedUnits = state.units;
        if (structureKey(this.snapshot.units) === signature) this.snapshot = { ...this.snapshot, units: state.units };
        if (this.dirty) this.remember(); else this.clearDraft();
        this.emit(this.dirty ? valid(this.snapshot.units) ? "pending" : "invalid" : "saved");
        return true;
      } catch (error) {
        this.emit(error instanceof ApiError && error.status === 409 ? "conflict" : "error", error instanceof Error ? error.message : "Speichern fehlgeschlagen");
        this.remember();
        return false;
      }
    })();
    const ok = await this.request;
    this.request = undefined;
    if (ok && this.dirty && this.snapshot.status === "pending") return this.flush();
    return ok;
  }
  /** New provider reads may update revision tokens, but never overwrite an unsaved local edit. */
  accept(state: PipelineState) {
    if (this.request || state.revision === this.revision) return;
    const key = structureKey(state.units);
    if (key === this.lastAttempt || key === this.acknowledged) {
      this.revision = state.revision;
      this.acknowledged = key;
      this.acknowledgedUnits = state.units;
      this.confirmed = true;
      if (!this.dirty) { this.clearDraft(); this.emit("saved"); } else { this.emit("pending"); this.remember(); this.schedule(); }
    } else if (this.dirty) {
      this.emit("conflict");
    } else {
      this.revision = state.revision; this.acknowledged = key; this.acknowledgedUnits = state.units; this.confirmed = true;
      this.snapshot = { units: state.units, status: "saved", error: "" }; this.clearDraft(); this.emit("saved");
    }
  }
  /** Only called after the user explicitly chooses one side of a displayed conflict. */
  resolve(state: PipelineState, keepLocal: boolean) {
    this.revision = state.revision; this.acknowledged = structureKey(state.units); this.acknowledgedUnits = state.units; this.confirmed = true;
    if (!keepLocal) this.snapshot = { ...this.snapshot, units: state.units };
    if (this.dirty) { this.remember(); this.emit("pending"); this.schedule(); } else { this.clearDraft(); this.emit("saved"); }
  }
  stop() { clearTimeout(this.timer); if (this.snapshot.status === "pending") void this.flush(); }
}
