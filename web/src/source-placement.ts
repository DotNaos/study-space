import type { PipelineSourceView, PipelineState, PipelineUnit, SourceUse } from "./pipeline-api";
import { unitKind, unitLabel } from "./learning-structure";

export type SourcePlacementView = {
  defaultUnitId?: string;
  currentUnitId?: string;
  hidden: boolean;
  overridden: boolean;
  unresolved: boolean;
  role: string;
};

export function placementUnits(state: PipelineState): PipelineUnit[] {
  return state.units.length ? state.units : state.suggestedUnits;
}

export function defaultPlacementId(state: PipelineState, item: PipelineSourceView) {
  return placementUnits(state).find(unit => unit.sourceGroupId === item.source.sectionId)?.id;
}

export function currentUse(item: PipelineSourceView): SourceUse | undefined {
  return item.decision?.disposition === "use"
    ? [...item.decision.uses].sort((left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER))[0]
    : undefined;
}

export function sourcePlacement(state: PipelineState, item: PipelineSourceView): SourcePlacementView {
  const fallbackDefault = defaultPlacementId(state, item);
  const defaultUnitId = item.defaultPlacementId ?? fallbackDefault;
  const use = currentUse(item);
  const hidden = item.hidden ?? (item.decision?.disposition === "exclude");
  const currentUnitId = hidden ? undefined : item.currentPlacementId ?? use?.unitId ?? defaultUnitId;
  const overridden = hidden || !!use && use.unitId !== defaultUnitId;
  return {
    defaultUnitId,
    currentUnitId,
    hidden,
    overridden,
    unresolved: !hidden && !currentUnitId,
    role: use?.role ?? item.source.suggestedRole,
  };
}

export function placementPath(units: PipelineUnit[], id?: string) {
  if (!id) return "Nicht zugeordnet";
  const byId = new Map(units.map(unit => [unit.id, unit]));
  const labels: string[] = [];
  const seen = new Set<string>();
  let cursor = byId.get(id);
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    labels.unshift(unitLabel(cursor));
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return labels.length ? labels.join(" / ") : "Nicht zugeordnet";
}

export function placementRole(item: PipelineSourceView, target?: PipelineUnit) {
  const existing = currentUse(item)?.role;
  if (existing === "solution" || existing === "support") return existing;
  if (target && unitKind(target) === "tasks") return existing === "solution" ? "solution" : "task";
  return existing === "task" ? "teaching" : existing === "teaching" ? "teaching" : "teaching";
}
