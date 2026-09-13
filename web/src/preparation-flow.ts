import type { PipelineState, PipelineSourceView } from "./pipeline-api";

export const needsSourceDecision = (item: PipelineSourceView) => item.source.present && (item.status === "pending" || item.status === "stale");
export function nextSourceDecision(state: PipelineState, after?: string) {
  const index = state.sources.findIndex(item => item.source.id === after);
  const ordered = index < 0 ? state.sources : [...state.sources.slice(index + 1), ...state.sources.slice(0, index)];
  return ordered.find(needsSourceDecision);
}
export function sourceProgress(state: PipelineState) {
  // This measures explicit use decisions, not extraction or semantic completeness.
  const reviewed = state.sources.filter(item => item.status === "reviewed" || item.status === "excluded" || item.status === "partial").length;
  return { reviewed, total: state.sources.length, open: state.sources.filter(needsSourceDecision).length };
}
