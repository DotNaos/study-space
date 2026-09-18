import type { PipelineSourceView } from "./pipeline-api";
import { currentUse } from "./source-placement";

const solutionMarker = /(?:muster\s*)?(?:losung(?:en)?|loesung(?:en)?|solution(?:s)?|answer(?:s)?)/giu;

function stripExtension(value: string) {
  return value.replace(/\.[a-z0-9]{1,12}$/i, "");
}

export function taskPairKey(value: string) {
  return stripExtension(value)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(solutionMarker, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function sourceRole(item: PipelineSourceView) {
  return currentUse(item)?.role ?? item.source.suggestedRole;
}

export function solutionLike(item: PipelineSourceView) {
  if (item.source.suggestedRole === "solution" || currentUse(item)?.role === "solution") return true;
  solutionMarker.lastIndex = 0;
  return solutionMarker.test(stripExtension(item.source.name).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase());
}

export function taskLike(item: PipelineSourceView) {
  return !solutionLike(item) && (currentUse(item)?.role === "task" || item.source.suggestedRole === "task");
}

export function matchingTaskSource(solution: PipelineSourceView, candidates: PipelineSourceView[]) {
  if (!solutionLike(solution)) return undefined;
  const key = taskPairKey(solution.source.name);
  if (!key) return undefined;
  const matches = candidates.filter((candidate) =>
    candidate.source.id !== solution.source.id
    && candidate.source.sectionId === solution.source.sectionId
    && taskLike(candidate)
    && taskPairKey(candidate.source.name) === key,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export function matchingSolutionSource(task: PipelineSourceView, candidates: PipelineSourceView[]) {
  if (!taskLike(task)) return undefined;
  const key = taskPairKey(task.source.name);
  if (!key) return undefined;
  const matches = candidates.filter((candidate) =>
    candidate.source.id !== task.source.id
    && candidate.source.sectionId === task.source.sectionId
    && solutionLike(candidate)
    && taskPairKey(candidate.source.name) === key,
  );
  return matches.length === 1 ? matches[0] : undefined;
}
