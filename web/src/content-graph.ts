import type { CourseModule, CourseResource, CourseSection } from "./api";
import { cleanCourseText } from "./course-content";
import type { LearningVersion, SourceRef } from "./learning-api";
import type { MaterialEntry, MaterialSnapshot } from "./material-api";

export type ContentKind =
  | "section"
  | "activity"
  | "resource"
  | "material"
  | "chapter"
  | "exercise";
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
  sectionId?: number;
  moduleId?: number;
  description?: string;
  resource?: CourseResource;
};
export type TraceEdge = {
  id: string;
  source: string;
  target: string;
  references: SourceRef[];
  kind: "contains" | "provenance";
};
export type ContentGraph = { nodes: TraceNode[]; edges: TraceEdge[] };
export const kindLabel = {
  section: "Moodle-Abschnitt",
  activity: "Moodle-Aktivität",
  resource: "Moodle-Ressource",
  material: "Material",
  chapter: "Kapitel",
  exercise: "Aufgabe",
};
export const materialNodeId = (id: string, revision?: string | null) =>
  `material:${id}:${revision || "pending"}`;

/** A relation records provenance only, never semantic coverage or an inferred task/chapter relation. */
export function buildContentGraph(
  snapshot?: MaterialSnapshot,
  version?: LearningVersion | null,
  sections: CourseSection[] = [],
): ContentGraph {
  const nodes = new Map<string, TraceNode>();
  const edges = new Map<string, TraceEdge>();
  const materials = new Map(
    (snapshot?.materials ?? []).map((material) => [material.id, material]),
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
      moduleId: material?.moduleId ?? undefined,
      sectionId: material?.sectionId,
      revision: revision || undefined,
    };
    nodes.set(id, node);
    return node;
  }
  for (const material of snapshot?.materials ?? [])
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
        kind: "provenance",
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
  function contains(parent: string, child: string) {
    const id = `contains:${parent}->${child}`;
    edges.set(id, {
      id,
      source: parent,
      target: child,
      kind: "contains",
      references: [],
    });
  }
  // The provider inventory is independent of material preparation and generation.
  // Even empty sections, labels, unsupported activities and new uploads get nodes.
  for (const [sectionIndex, section] of sections.entries()) {
    const sectionId = `section:${section.id}`;
    nodes.set(sectionId, {
      id: sectionId,
      kind: "section",
      sectionId: section.id,
      title: cleanCourseText(section.name) || `Abschnitt ${sectionIndex + 1}`,
      subtitle: `${section.modules.length} Aktivitäten`,
      description: cleanCourseText(section.summary),
      notice: null,
      reason: "Abschnitt der von Moodle gelieferten Kursstruktur.",
    });
    for (const module of section.modules) {
      const moduleId = `activity:${module.id}`;
      const prepared = [...nodes.values()].filter(
        (node) => node.kind === "material" && node.moduleId === module.id,
      );
      nodes.set(moduleId, {
        id: moduleId,
        kind: "activity",
        sectionId: section.id,
        moduleId: module.id,
        title: cleanCourseText(module.name) || `Aktivität ${module.id}`,
        subtitle: activityLabel(module),
        description: cleanCourseText(module.description),
        notice: prepared.length ? null : "Noch nicht erfasst",
        reason: prepared.length
          ? "Die Verbindung zum Material zeigt dieselbe Moodle-Aktivität, nicht identische Dateifassungen."
          : "Diese Moodle-Aktivität ist im Graph sichtbar, aber noch nicht im aufbereiteten Materialstand. Ihre Inhalte wurden noch nicht mit dem Lernskript abgeglichen.",
      });
      contains(sectionId, moduleId);
      // Provider resource IDs change with revisions. Do not guess equivalence with
      // prepared material IDs from a matching filename or imply up-to-date coverage.
      const occurrences = new Map<string, number>();
      for (const resource of module.resources) {
        const key = resource.id || `${resource.type}:${resource.name}`;
        const occurrence = occurrences.get(key) || 0;
        occurrences.set(key, occurrence + 1);
        const id = `resource:${module.id}:${encodeURIComponent(key)}:${occurrence}`;
        nodes.set(id, {
          id,
          kind: "resource",
          sectionId: section.id,
          moduleId: module.id,
          resource,
          title: resource.name || "Moodle-Ressource",
          subtitle: "Moodle · " + (resource.mimeType || resource.type),
          notice: null,
          reason:
            "Ressource aus der aktuellen Kursstruktur. Ein Aufbereitungsstand oder eine identische gespeicherte Fassung lässt sich daraus allein nicht ableiten.",
        });
        contains(moduleId, id);
      }
      for (const material of prepared) contains(moduleId, material.id);
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

function activityLabel(module: CourseModule): string {
  const labels: Record<string, string> = {
    page: "Seite",
    label: "Text",
    resource: "Datei",
    folder: "Ordner",
    url: "Link",
    forum: "Forum",
    assign: "Abgabe",
    quiz: "Test",
    book: "Buch",
    lesson: "Lektion",
    h5pactivity: "Interaktiver Inhalt",
    subsection: "Unterabschnitt",
  };
  return labels[module.type] || module.type || "Moodle-Aktivität";
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
