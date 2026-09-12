import type { CourseSection } from "./api";
import { cleanCourseText } from "./course-content";
import type { LearningVersion, SourceRef } from "./learning-api";
import type { MaterialEntry, MaterialSnapshot } from "./material-api";

export type ContentKind = "material" | "chapter" | "exercise";
export type TraceNode = {
  id: string;
  kind: ContentKind;
  title: string;
  subtitle: string;
  notice: string | null;
  reason: string;
  material?: MaterialEntry;
  materialId?: string;
  revision?: string;
  contentId?: string;
};
export type TraceEdge = {
  id: string;
  source: string;
  target: string;
  references: SourceRef[];
};
export type ContentGraph = { nodes: TraceNode[]; edges: TraceEdge[] };
export const kindLabel = {
  material: "Material",
  chapter: "Kapitel",
  exercise: "Aufgabe",
};
export const materialNodeId = (id: string, revision?: string | null) =>
  `material:${id}:${revision || "pending"}`;

/** A relation records provenance only, never semantic coverage or an inferred task/chapter relation. */
export function buildContentGraph(
  snapshot: MaterialSnapshot,
  version?: LearningVersion | null,
  sections: CourseSection[] = [],
): ContentGraph {
  const nodes = new Map<string, TraceNode>();
  const edges = new Map<string, TraceEdge>();
  const materials = new Map(
    snapshot.materials.map((material) => [material.id, material]),
  );
  const moduleNames = new Map(
    sections.flatMap((section) =>
      section.modules.map(
        (module) => [module.id, cleanCourseText(module.name)] as const,
      ),
    ),
  );
  const sourceNames = new Map(
    version?.sources.map((source) => [
      materialNodeId(source.materialId, source.revision),
      source.name,
    ]) ?? [],
  );

  function sourceNode(materialId: string, revision?: string | null): TraceNode {
    const id = materialNodeId(materialId, revision);
    const existing = nodes.get(id);
    if (existing) return existing;
    const material = materials.get(materialId);
    const current = material && material.revision === (revision ?? null);
    const name =
      (current ? material.name : sourceNames.get(id)) ||
      material?.name ||
      "Unbekannte Quelle";
    const title = /^index\.html?$/i.test(name)
      ? (material?.moduleId && moduleNames.get(material.moduleId)) ||
        `${material?.sectionName || "Moodle-Seite"} · ${name}`
      : name;
    let notice: string | null = null;
    let reason =
      "Quellenbezüge zeigen die Herkunft, nicht die Vollständigkeit des Lerninhalts.";
    if (!material) {
      notice = "Nicht im Materialstand";
      reason =
        "Diese Quellenrevision wird verwendet, fehlt aber im aktuell erfassten Materialstand. Das beweist keine Löschung in Moodle.";
    } else if (!current) {
      notice = "Andere Quellenfassung";
      reason =
        "Der Lerninhalt verweist auf diese gespeicherte Revision. Der aktuelle Materialstand enthält eine andere oder noch ungeklärte Fassung.";
    } else if (material.status !== "ready") {
      notice =
        (
          {
            failed: "Aufbereitung fehlgeschlagen",
            unsupported: "Nicht aufbereitet",
            pending: "Noch ausstehend",
            processing: "Wird aufbereitet",
          } as Record<string, string>
        )[material.status] || "Aufbereitung offen";
      reason =
        material.reason ||
        "Für dieses Material liegt noch kein erfolgreich aufbereiteter Inhalt vor.";
    } else if (material.warnings.length) {
      notice = "Hinweis zur Aufbereitung";
      reason = material.warnings.join("\n");
    }
    const node: TraceNode = {
      id,
      kind: "material",
      title,
      subtitle: cleanCourseText(material?.sectionName || "Gespeicherte Quelle"),
      notice,
      reason,
      material,
      materialId,
      revision: revision || undefined,
    };
    nodes.set(id, node);
    return node;
  }
  for (const material of snapshot.materials)
    sourceNode(material.id, material.revision);

  function addContent(
    kind: "chapter" | "exercise",
    item: { id: string; title: string; sources: SourceRef[] },
    index: number,
  ) {
    const id = `${kind}:${item.id}`;
    const node: TraceNode = {
      id,
      kind,
      contentId: item.id,
      title: item.title,
      subtitle: `${kindLabel[kind]} ${index + 1}`,
      notice: item.sources.length ? null : "Ohne Quellenbezug",
      reason: item.sources.length
        ? "Die Verbindungen entsprechen den gespeicherten Quellenverweisen. Eine freie Überarbeitung ist damit vereinbar."
        : "Für diesen Inhalt wurde keine Herkunft hinterlegt. Das kann auch eine eigene Ergänzung sein; es ist kein Beweis für einen Fehler.",
    };
    nodes.set(id, node);
    for (const reference of item.sources) {
      const source = sourceNode(reference.materialId, reference.revision);
      const edgeId = `${source.id}->${id}`;
      const edge = edges.get(edgeId) ?? {
        id: edgeId,
        source: source.id,
        target: id,
        references: [],
      };
      if (
        !edge.references.some(
          (ref) =>
            ref.blockId === reference.blockId && ref.page === reference.page,
        )
      )
        edge.references.push(reference);
      edges.set(edgeId, edge);
      if (source.notice && !node.notice) {
        node.notice = source.notice;
        node.reason = source.reason;
      }
    }
  }
  version?.sections.forEach((section, index) =>
    addContent("chapter", section, index),
  );
  version?.exercises.forEach((exercise, index) =>
    addContent("exercise", exercise, index),
  );
  const referenced = new Set([...edges.values()].map((edge) => edge.source));
  for (const node of nodes.values()) {
    if (node.kind === "material" && !referenced.has(node.id) && !node.notice) {
      node.notice = version ? "Nicht referenziert" : "Noch kein Lerninhalt";
      node.reason = version
        ? "Kein Kapitel und keine Aufgabe dieser Lernversion verweist auf diese Quellenrevision. Ob sie bewusst ausgelassen wurde, ist nicht dokumentiert."
        : "Es gibt noch keine aktive Lernversion. Dieses Material bleibt sichtbar, auch ohne daraus erzeugten Lerninhalt.";
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

export function findGraphNodes(
  graph: ContentGraph,
  query: string,
  noticesOnly = false,
) {
  const terms = query
    .toLocaleLowerCase("de")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return graph.nodes.filter(
    (node) =>
      (!noticesOnly || node.notice) &&
      terms.every((term) =>
        `${node.title} ${node.subtitle} ${kindLabel[node.kind]} ${node.notice || ""}`
          .toLocaleLowerCase("de")
          .includes(term),
      ),
  );
}

/** Keep the canvas readable without losing access to any neighbour. Paging is explicit in the UI. */
export function graphNeighbourhood(
  graph: ContentGraph,
  focusId: string,
  page = 0,
  pageSize = 8,
) {
  const focus = graph.nodes.find((node) => node.id === focusId);
  const incident = graph.edges.filter(
    (edge) => edge.source === focusId || edge.target === focusId,
  );
  const neighbours = new Set(
    incident.map((edge) =>
      edge.source === focusId ? edge.target : edge.source,
    ),
  );
  const all = graph.nodes.filter((node) => neighbours.has(node.id));
  const pages = Math.max(1, Math.ceil(all.length / pageSize));
  const safePage = Math.min(Math.max(0, page), pages - 1);
  const visible = all.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const ids = new Set([focusId, ...visible.map((node) => node.id)]);
  return {
    nodes: focus ? [focus, ...visible] : [],
    edges: incident.filter(
      (edge) => ids.has(edge.source) && ids.has(edge.target),
    ),
    total: all.length,
    page: safePage,
    pages,
  };
}

export function graphFocusFromHash(hash: string): string | undefined {
  if (!hash.startsWith("#graph/")) return undefined;
  try {
    return decodeURIComponent(hash.slice(7));
  } catch {
    return undefined;
  }
}

/** Several extracted blocks on the same page need only one reader entry point. */
export function sourceLocations(references: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = `${reference.materialId}:${reference.revision}:${reference.page ?? "document"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
