import type { PipelineState, PipelineUnit } from "./pipeline-api";

export type UnitKind = "script" | "tasks";
export const unitKind = (unit: PipelineUnit): UnitKind => unit.kind ?? "script";
export const unitLabel = (unit: PipelineUnit) => unit.customTitle ?? unit.title;

export function descendants(units: PipelineUnit[], id: string): Set<string> {
  const ids = new Set([id]);
  for (let i = 0; i < units.length; i++)
    for (const unit of units) if (unit.parentId && ids.has(unit.parentId)) ids.add(unit.id);
  return ids;
}
export function unitHidden(unit: PipelineUnit, units: PipelineUnit[]): boolean {
  const seen = new Set<string>();
  let cursor: PipelineUnit | undefined = unit;
  while (cursor && !seen.has(cursor.id)) {
    if (cursor.hidden) return true;
    seen.add(cursor.id);
    cursor = units.find(parent => parent.id === cursor?.parentId);
  }
  return false;
}
export function structureDraft(state: PipelineState): PipelineUnit[] {
  return (state.units.length ? state.units : state.suggestedUnits).map(unit => ({
    ...unit, kind: unitKind(unit), hidden: unit.hidden ?? false, customTitle: unit.customTitle ?? null,
    sourceGroupId: unit.sourceGroupId ?? null, scriptUnitIds: unit.scriptUnitIds ?? [],
  }));
}
export function orderedSiblings(units: PipelineUnit[], kind: UnitKind, parentId: string | null) {
  return units.filter(unit => unitKind(unit) === kind && unit.parentId === parentId).sort((a,b) => a.order - b.order);
}
export function reorderUnits(units: PipelineUnit[], activeId: string, overId: string): PipelineUnit[] {
  const active = units.find(unit => unit.id === activeId), over = units.find(unit => unit.id === overId);
  if (!active || !over || activeId === overId || active.parentId !== over.parentId || unitKind(active) !== unitKind(over)) return units;
  const siblings = orderedSiblings(units, unitKind(active), active.parentId);
  const from = siblings.findIndex(unit => unit.id === activeId), to = siblings.findIndex(unit => unit.id === overId);
  siblings.splice(to, 0, siblings.splice(from, 1)[0]);
  const order = new Map(siblings.map((unit,index) => [unit.id,index]));
  return units.map(unit => order.has(unit.id) ? {...unit,order:order.get(unit.id)!} : unit);
}
export function moveParent(units: PipelineUnit[], id: string, parentId: string | null): PipelineUnit[] {
  const unit = units.find(unit => unit.id === id), parent = units.find(unit => unit.id === parentId);
  if (!unit || parentId && (!parent || unitKind(parent) !== unitKind(unit) || descendants(units,id).has(parentId))) return units;
  return units.map(item => item.id === id ? {...item,parentId,order:Math.max(-1,...orderedSiblings(units,unitKind(unit),parentId).map(item => item.order))+1} : item);
}
export function moveKind(units: PipelineUnit[], id: string, kind: UnitKind): PipelineUnit[] {
  const root = units.find(unit => unit.id === id);
  if (!root || unitKind(root) === kind) return units;
  const ids = descendants(units,id);
  const link = kind === "tasks" && root.parentId && !ids.has(root.parentId) ? [root.parentId] : [];
  const order = Math.max(-1,...orderedSiblings(units,kind,null).map(unit => unit.order))+1;
  return units.map(unit => ids.has(unit.id) ? {...unit,kind,parentId:unit.id===id ? null:unit.parentId,
    order:unit.id===id?order:unit.order,scriptUnitIds:kind==="script"?[]:link}
    : {...unit,scriptUnitIds:(unit.scriptUnitIds??[]).filter(link => !ids.has(link))});
}
