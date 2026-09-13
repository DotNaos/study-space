import { unitHidden, unitKind, unitLabel } from "./learning-structure";
import type { MappingItem, PipelineSourceView, PipelineState, PipelineUnit, SourceUse } from "./pipeline-api";

export type MappingProposal = MappingItem & { safe: boolean; label: string };

export function mappingRoots(state: PipelineState): PipelineUnit[] {
  const visible = state.units.filter(unit => !unitHidden(unit, state.units));
  const roots = visible.filter(unit => unit.parentId === null && unitKind(unit) === "script");
  const linkedTasks = new Set(visible.filter(unit => unitKind(unit) === "tasks").flatMap(unit => unit.scriptUnitIds ?? []));
  const standaloneTasks = visible.filter(unit => unit.parentId === null && unitKind(unit) === "tasks" && !(unit.scriptUnitIds ?? []).some(id => linkedTasks.has(id)));
  return [...roots, ...standaloneTasks].sort((a,b) => a.order - b.order);
}

export function mappingTargets(state: PipelineState, rootId: string): PipelineUnit[] {
  const root = state.units.find(unit => unit.id === rootId);
  if (!root) return [];
  const ids = new Set<string>([root.id]);
  for (let changed = true; changed;) {
    changed = false;
    for (const unit of state.units) if (unit.parentId && ids.has(unit.parentId) && !ids.has(unit.id)) { ids.add(unit.id); changed = true; }
  }
  if (unitKind(root) === "script")
    for (const unit of state.units)
      if (unitKind(unit) === "tasks" && (unit.scriptUnitIds ?? []).some(id => ids.has(id))) ids.add(unit.id);
  return state.units.filter(unit => ids.has(unit.id) && !unitHidden(unit, state.units)).sort((a,b) => {
    if (unitKind(a) !== unitKind(b)) return unitKind(a) === "script" ? -1 : 1;
    return a.order - b.order;
  });
}

export function mappingSources(state: PipelineState, rootId: string): PipelineSourceView[] {
  const targets = mappingTargets(state, rootId);
  const targetIds = new Set(targets.map(unit => unit.id));
  const groupIds = new Set(targets.flatMap(unit => unit.sourceGroupId ? [unit.sourceGroupId] : []));
  return state.sources.filter(item => groupIds.has(item.source.sectionId) ||
    item.decision?.uses.some(use => targetIds.has(use.unitId)));
}

export function actionable(item: PipelineSourceView) {
  return ["pending", "stale", "partial", "not-returned"].includes(item.status);
}

export function mappingProgress(state: PipelineState, rootId: string) {
  const items = mappingSources(state, rootId).filter(item => item.status !== "structure-hidden");
  const open = items.filter(actionable).length;
  return { total: items.length, open, done: Math.max(0, items.length - open) };
}

function separatorOnly(text: string) {
  const value = text.trim();
  return value.length > 8 && !/[\p{L}\p{N}]/u.test(value);
}

function directUnit(state: PipelineState, item: PipelineSourceView): PipelineUnit | undefined {
  return state.units.find(unit => unit.sourceGroupId === item.source.sectionId && !unitHidden(unit, state.units));
}

export function proposalFor(state: PipelineState, item: PipelineSourceView, rootId: string, order: number): MappingProposal | undefined {
  if (!item.source.present || item.status === "not-returned") return;
  if (separatorOnly(item.source.text)) return {
    sourceId: item.source.id, sourceVersion: item.source.sourceVersion, disposition: "exclude", uses: [], safe: true, label: "Ausblenden",
  };
  let role = item.source.suggestedRole;
  if (role === "unresolved" || role === "solution") return;
  const targets = mappingTargets(state, rootId);
  let target = directUnit(state, item);
  if (target && !targets.some(unit => unit.id === target!.id)) target = undefined;
  if (!target) target = targets.find(unit => unit.id === rootId);
  if (target && unitKind(target) === "tasks" && role === "teaching") role = "task";
  if (role === "reference") return {
    sourceId: item.source.id, sourceVersion: item.source.sourceVersion, disposition: "use",
    uses: [{ unitId: "", role: "reference", order }], safe: true, label: "Referenz",
  };
  if (!target) return;
  if (role === "teaching" && unitKind(target) === "tasks") return;
  const use: SourceUse = { unitId: target.id, role, order };
  return {
    sourceId: item.source.id, sourceVersion: item.source.sourceVersion, disposition: "use", uses: [use], safe: role !== "solution", label: `${role} · ${unitLabel(target)}`,
  };
}

export function mappingItem(item: PipelineSourceView): MappingItem | undefined {
  if (!item.decision) return;
  return { sourceId: item.source.id, sourceVersion: item.source.sourceVersion, disposition: item.decision.disposition, uses: item.decision.uses };
}

export function primaryUse(item: PipelineSourceView): SourceUse | undefined {
  return item.decision ? [...item.decision.uses].sort((a,b) => (a.order ?? 1_000_000) - (b.order ?? 1_000_000))[0] : undefined;
}

export function displayMapping(state: PipelineState, item: PipelineSourceView, rootId: string, order: number) {
  if (item.status === "excluded" || item.status === "structure-hidden") return { kind: "excluded" as const, label: "Ausgeblendet" };
  const use = primaryUse(item);
  if (use) {
    const unit = state.units.find(unit => unit.id === use.unitId);
    return { kind: "reviewed" as const, label: unit ? unitLabel(unit) : use.role === "reference" ? "Referenz" : "Ohne Ziel", role: use.role, unitId: use.unitId };
  }
  const proposal = proposalFor(state,item,rootId,order);
  if (proposal?.disposition === "exclude") return { kind: "proposal" as const, label: "Ausblenden", proposal };
  const proposedUse = proposal?.uses[0];
  const unit = proposedUse && state.units.find(unit => unit.id === proposedUse.unitId);
  return proposal ? { kind: "proposal" as const, label: unit ? unitLabel(unit) : "Referenz", role: proposedUse?.role, unitId: proposedUse?.unitId, proposal } : { kind: "open" as const, label: "Zuordnen" };
}

export function batchProposalFor(state: PipelineState, item: PipelineSourceView, rootId: string, order: number): MappingProposal | undefined {
  const proposal = proposalFor(state, item, rootId, order);
  if (!proposal?.safe || item.status !== "pending" || item.source.kind !== "file" && item.source.kind !== "text") return;
  const use = proposal.uses[0];
  const target = use && state.units.find(unit => unit.id === use.unitId);
  if (use?.role === "task" && target && unitKind(target) !== "tasks") return;
  return proposal;
}
