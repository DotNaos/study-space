import type {
  LearningSection,
  LearningVersion,
  SourceRef,
} from "./learning-api";

export type ScriptSpan = {
  start: number;
  end: number;
  quote: string;
  sources: SourceRef[];
  origin: "source" | "user" | "agent";
};
export type ScriptProvenance = {
  markdownHash: string;
  spans: ScriptSpan[];
  status: "unreviewed" | "verified" | "stale";
};
export type MappingState = "source" | "user" | "agent" | "unknown" | "stale";
export type ScriptRange = {
  id: string;
  sectionId: string;
  start: number;
  end: number;
  state: MappingState;
  sources: SourceRef[];
  reviewed: boolean;
};
export const mappingLabels: Record<MappingState, string> = {
  source: "Mit Quellenbezug",
  user: "Eigene Ergänzung",
  agent: "KI-Ergänzung",
  unknown: "Textzuordnung fehlt",
  stale: "Erneut prüfen",
};
export const sourceKey = (source: Pick<SourceRef, "materialId" | "revision">) =>
  `${source.materialId}:${source.revision}`;
export const referenceKey = (source: SourceRef) =>
  `${sourceKey(source)}:${source.blockId}:${source.page ?? "none"}`;
export function uniqueReferences(refs: SourceRef[]) {
  return [...new Map(refs.map((ref) => [referenceKey(ref), ref])).values()];
}

// Conservative projection: legacy section-wide citations are NOT text mappings.
// Quote/range checks also protect the reader when a stale API/client edits text.
export function scriptRanges(section: LearningSection): ScriptRange[] {
  const spans = section.provenance?.spans ?? [];
  const valid = spans.filter(
    (span) =>
      Number.isInteger(span.start) &&
      Number.isInteger(span.end) &&
      span.start >= 0 &&
      span.end > span.start &&
      span.end <= section.markdown.length,
  );
  const boundaries = [
    ...new Set([
      0,
      section.markdown.length,
      ...valid.flatMap((span) => [span.start, span.end]),
    ]),
  ].sort((a, b) => a - b);
  return boundaries
    .slice(0, -1)
    .map((start, index) => {
      const end = boundaries[index + 1];
      const covering = valid.filter(
        (span) => span.start <= start && span.end >= end,
      );
      const span = covering.length === 1 ? covering[0] : undefined;
      const stale =
        !!span &&
        (section.provenance?.status === "stale" ||
          section.markdown.slice(span.start, span.end) !== span.quote);
      const known =
        span &&
        ["source", "user", "agent"].includes(span.origin) &&
        (span.origin === "source"
          ? span.sources.length > 0
          : span.sources.length === 0);
      const state: MappingState = stale
        ? "stale"
        : known
          ? span.origin
          : "unknown";
      return {
        id: `${section.id}:${start}:${end}`,
        sectionId: section.id,
        start,
        end,
        state,
        sources: state === "source" ? uniqueReferences(span!.sources) : [],
        reviewed:
          state === "source" && section.provenance?.status === "verified",
      };
    })
    .filter((range) =>
      /\S/u.test(section.markdown.slice(range.start, range.end)),
    );
}

export function sectionReferences(section: LearningSection): SourceRef[] {
  return uniqueReferences([
    ...section.sources,
    ...scriptRanges(section).flatMap((range) => range.sources),
  ]);
}
export function buildScriptMapping(version: LearningVersion) {
  const ranges = version.sections.flatMap(scriptRanges);
  const reverse = new Map<string, ScriptRange[]>();
  for (const range of ranges)
    for (const ref of range.sources) {
      const key = referenceKey(ref);
      reverse.set(key, [...(reverse.get(key) ?? []), range]);
    }
  return { ranges, reverse };
}
export function matchingRanges(
  ranges: ScriptRange[],
  start: number,
  end: number,
) {
  return ranges.filter((range) => range.start < end && range.end > start);
}

export function safeBounds(
  bounds:
    | { x: number; y: number; width: number; height: number }
    | null
    | undefined,
) {
  return bounds &&
    Object.values(bounds).every(Number.isFinite) &&
    bounds.x >= 0 &&
    bounds.y >= 0 &&
    bounds.width > 0 &&
    bounds.height > 0 &&
    bounds.x + bounds.width <= 1.001 &&
    bounds.y + bounds.height <= 1.001
    ? bounds
    : undefined;
}
