import { api } from "./api";

export type PipelineUnit = {
  id: string;
  title: string;
  parentId: string | null;
  order: number;
};
export type SourceUse = {
  unitId: string;
  role: string;
  firstPage?: number | null;
  lastPage?: number | null;
  relatedSourceId?: string | null;
};
export type SourceDecision = {
  sourceId: string;
  sourceVersion: string;
  disposition: "use" | "exclude";
  uses: SourceUse[];
  reason: string;
  actor: string;
  decidedAt: string;
};
export type PipelineSource = {
  id: string;
  sectionId: number;
  moduleId: number | null;
  name: string;
  kind: string;
  mimeType: string | null;
  sourceVersion: string;
  materialRevision: string | null;
  acquisition: string;
  problem: string | null;
  warnings: string[];
  text: string;
  studyUrl: string | null;
  present: boolean;
  suggestedRole: string;
};
export type PipelineSourceView = {
  source: PipelineSource;
  status: string;
  decision: SourceDecision | null;
  sectionIds: string[];
  exerciseIds: string[];
  unmappedBlocks?: number;
};
export type PipelineGroup = {
  id: number;
  title: string;
  order: number;
  parentId: number | null;
};
export type PipelineEvent = {
  revision: number;
  action: string;
  actor: string;
  reason: string;
  at: string;
  sourceId?: string | null;
};
export type PipelineState = {
  courseId: number;
  revision: number;
  observedHash: string;
  persisted: boolean;
  problem: string | null;
  groups: PipelineGroup[];
  sources: PipelineSourceView[];
  units: PipelineUnit[];
  suggestedUnits: PipelineUnit[];
  history: PipelineEvent[];
  pending: number;
  blocked: number;
  unattributedSections: string[];
};
export const pipelinePath = (courseId: number) =>
  `/api/pipeline/courses/${courseId}`;
export const readPipeline = (courseId: number, signal?: AbortSignal) =>
  api<PipelineState>(pipelinePath(courseId), { signal });
export const roleLabels: Record<string, string> = {
  teaching: "Skript",
  task: "Aufgaben",
  solution: "Musterlösung",
  support: "Arbeitsmaterial",
  reference: "Referenz / Organisation",
  unresolved: "Noch offen",
};
export const statusLabels: Record<string, string> = {
  partial: "Restliche Seiten ungeklärt",
  pending: "Einordnung offen",
  stale: "Erneut prüfen",
  reviewed: "Verwendung bestätigt",
  excluded: "Begründet ausgeschlossen",
  "not-returned": "Nicht mehr geliefert",
};
export const isOpen = (item: PipelineSourceView) =>
  !!item.unmappedBlocks ||
  ["pending", "stale", "partial", "not-returned"].includes(item.status);
export type PipelineRoute =
  | { kind: "overview" }
  | { kind: "group" | "source" | "unit"; id: string }
  | { kind: "structure" };
export function parsePipelineRoute(hash: string): PipelineRoute {
  if (hash === "#prepare/structure") return { kind: "structure" };
  const match = /^#prepare\/(group|source|unit)\/([a-zA-Z0-9-]+)$/.exec(hash);
  return match
    ? { kind: match[1] as "group" | "source" | "unit", id: match[2] }
    : { kind: "overview" };
}
export function pipelineHash(route: PipelineRoute) {
  return route.kind === "overview"
    ? "#prepare"
    : route.kind === "structure"
      ? "#prepare/structure"
      : `#prepare/${route.kind}/${route.id}`;
}
export function groupSources(
  state: PipelineState,
  groupId: number,
  descendants = false,
) {
  const ids = new Set([groupId]);
  if (descendants)
    for (let i = 0; i < state.groups.length; i++)
      for (const group of state.groups)
        if (group.parentId !== null && ids.has(group.parentId))
          ids.add(group.id);
  return state.sources.filter((item) => ids.has(item.source.sectionId));
}
