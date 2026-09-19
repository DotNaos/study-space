import { api } from "./api";

export type ContentPlacement = {
  unitId: string;
  role: string;
  unitOrder: number;
  order: number;
  firstPage?: number | null;
  lastPage?: number | null;
  relatedSourceId?: string | null;
};

export type ContentProvenance = {
  sourceBlockId: string;
  page?: number | null;
  slide?: number | null;
  bounds?: { x: number; y: number; width: number; height: number } | null;
  start: number;
  length: number;
};

export type ContentRevision = {
  id: string;
  parentRevisionId?: string | null;
  createdAt: string;
  actor: string;
  reason: string;
  kind: "materialized" | "edit" | "reset" | string;
  sourceVersion: string;
  materialRevision?: string | null;
  content: string;
  provenance: ContentProvenance[];
  provenanceStatus: "current" | "stale" | string;
};

export type ContentBlockSummary = {
  id: string;
  sourceId: string;
  name: string;
  mimeType?: string | null;
  observedSourceVersion: string;
  observedMaterialRevision?: string | null;
  baselineSourceVersion?: string | null;
  baselineMaterialRevision?: string | null;
  currentRevisionId?: string | null;
  included: boolean;
  stale: boolean;
  status: "not-ready" | "unmaterialized" | "ready" | "stale" | string;
  placements: ContentPlacement[];
};

export type ContentWorkspace = {
  courseId: number;
  pipelineRevision: number;
  blocks: ContentBlockSummary[];
};

export type ContentBlockView = {
  block: ContentBlockSummary;
  revision?: ContentRevision | null;
};

export type ContentAgentResult = {
  view: ContentBlockView;
  summary: string;
};

export type ContentAgentContext = {
  selectionText?: string;
  page?: number;
  sourceBlockIds?: string[];
  scopeBlockIds?: string[];
  scopeLabel?: string;
};

export const contentPath = (courseId: number) => `/api/content/courses/${courseId}`;
export const readContentWorkspace = (courseId: number, signal?: AbortSignal) =>
  api<ContentWorkspace>(contentPath(courseId), { signal });
export const materializeContent = (courseId: number, expectedPipelineRevision: number) =>
  api<ContentWorkspace>(`${contentPath(courseId)}/materialize`, {
    method: "POST",
    body: JSON.stringify({
      expectedPipelineRevision,
      actor: "user",
      reason: "Editierbare Rohfassung aus der bestätigten Quellenstruktur aktualisiert.",
    }),
  });
export const readContentBlock = (courseId: number, blockId: string, signal?: AbortSignal) =>
  api<ContentBlockView>(`${contentPath(courseId)}/blocks/${blockId}`, { signal });
export const readContentRevision = (courseId: number, blockId: string, revisionId: string, signal?: AbortSignal) =>
  api<ContentRevision>(`${contentPath(courseId)}/blocks/${blockId}/revisions/${revisionId}`, { signal });
export const saveContentBlock = (courseId: number, blockId: string, expectedRevisionId: string, content: string) =>
  api<ContentBlockView>(`${contentPath(courseId)}/blocks/${blockId}`, {
    method: "PUT",
    body: JSON.stringify({
      expectedRevisionId,
      content,
      actor: "user",
      reason: "Inhalt im Block-Editor bearbeitet.",
    }),
  });
export const resetContentBlock = (courseId: number, blockId: string, expectedRevisionId: string) =>
  api<ContentBlockView>(`${contentPath(courseId)}/blocks/${blockId}/reset`, {
    method: "POST",
    body: JSON.stringify({
      expectedRevisionId,
      actor: "user",
      reason: "Bearbeitete Fassung auf die aktuelle maschinelle Extraktion zurückgesetzt.",
    }),
  });

export function originalMaterialUrl(block: ContentBlockSummary) {
  if (!block.observedMaterialRevision) return undefined;
  return `/api/materials/${encodeURIComponent(block.sourceId)}/revisions/${encodeURIComponent(block.observedMaterialRevision)}/assets/original`;
}

export const runContentAgent = (courseId: number, blockId: string, expectedRevisionId: string, instruction: string, context: ContentAgentContext = {}) =>
  api<ContentAgentResult>(`${contentPath(courseId)}/blocks/${blockId}/agent`, {
    method: "POST",
    body: JSON.stringify({
      expectedRevisionId,
      instruction,
      consentToCodex: true,
      selectionText: context.selectionText || null,
      page: context.page ?? null,
      sourceBlockIds: context.sourceBlockIds ?? [],
      scopeBlockIds: context.scopeBlockIds ?? [],
      scopeLabel: context.scopeLabel ?? null,
    }),
  });

export const undoContentBlock = (courseId: number, blockId: string, expectedRevisionId: string) =>
  api<ContentBlockView>(`${contentPath(courseId)}/blocks/${blockId}/undo`, {
    method: "POST",
    body: JSON.stringify({
      expectedRevisionId,
      actor: "user",
      reason: "Letzte Bearbeitung im Block-Editor rückgängig gemacht.",
    }),
  });
