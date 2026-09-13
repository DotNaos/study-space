import type { PipelineState, PipelineSourceView } from "./pipeline-api";

export const needsSourceDecision = (item: PipelineSourceView) => item.source.present && (item.status === "pending" || item.status === "stale");
export function nextSourceDecision(state: PipelineState, after?: string) {
  const index = state.sources.findIndex(item => item.source.id === after);
  const ordered = index < 0 ? state.sources : [...state.sources.slice(index + 1), ...state.sources.slice(0, index)];
  return ordered.find(needsSourceDecision);
}
export function sourceProgress(state: PipelineState) {
  // Inherited hidden structure stays traceable but is outside the actionable mapping workload.
  const visible = state.sources.filter(item => item.status !== "structure-hidden");
  const reviewed = visible.filter(item => item.status === "reviewed" || item.status === "excluded" || item.status === "partial").length;
  return { reviewed, total: visible.length, open: visible.filter(needsSourceDecision).length };
}
