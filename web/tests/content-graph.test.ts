import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildContentGraph,
  findGraphNodes,
  layoutContentGraph,
  graphFocusFromHash,
  materialNodeId,
  sourceLocations,
} from "../src/content-graph";
import type { LearningVersion, SourceRef } from "../src/learning-api";
import type { MaterialEntry, MaterialSnapshot } from "../src/material-api";

const materialId = "a".repeat(64),
  revision = "b".repeat(64);
const ref: SourceRef = { materialId, revision, blockId: "block-1", page: 3 };
const material = (extra: Partial<MaterialEntry> = {}): MaterialEntry => ({
  id: materialId,
  revision,
  name: "Folien.pdf",
  kind: "file",
  mimeType: "application/pdf",
  sectionId: 1,
  sectionName: "Grundlagen",
  moduleId: 2,
  status: "ready",
  reason: null,
  warnings: [],
  documentUrl: null,
  originalUrl: null,
  ...extra,
});
const snapshot = (
  materials: MaterialEntry[] = [material()],
): MaterialSnapshot => ({
  courseId: 1,
  snapshotId: "snapshot",
  status: "ready",
  coverage: {
    total: materials.length,
    ready: materials.length,
    failed: 0,
    pending: 0,
    unsupported: 0,
    complete: true,
  },
  materials,
  job: null,
  updatedAt: null,
});
const version = (): LearningVersion => ({
  id: "v1",
  snapshotId: "snapshot",
  createdAt: "2026-09-12T10:00:00Z",
  title: "Kurs",
  partial: false,
  warnings: [],
  sources: [{ materialId, revision, name: "Folien.pdf" }],
  sections: [
    {
      id: "chapter-1",
      title: "Grundlagen",
      markdown: "Neu formuliert",
      sources: [ref, ref, { ...ref, blockId: "block-2", page: 4 }],
    },
  ],
  exercises: [
    {
      id: "task-1",
      title: "Vergleichen",
      prompt: "Aufgabe",
      hint: "",
      solution: "",
      origin: "source",
      sources: [ref],
    },
  ],
});

test("edges are actual source references, not inferred chapter/task relationships", () => {
  const graph = buildContentGraph(snapshot(), version());
  expect(graph.nodes).toHaveLength(3);
  expect(graph.edges).toHaveLength(2);
  expect(
    graph.edges.every(
      (edge) => edge.source === materialNodeId(materialId, revision),
    ),
  ).toBe(true);
  expect(graph.edges[0].references).toHaveLength(2);
  expect(graph.edges[0].references.map((item) => item.page)).toEqual([3, 4]);
  expect(graph.nodes.every((node) => node.notice === null)).toBe(true);
});

test("ready but unreferenced material is visible with an explicitly unknown omission reason", () => {
  const graph = buildContentGraph(
    snapshot([material(), material({ id: "c".repeat(64), name: "Neu.pdf" })]),
    version(),
  );
  const added = graph.nodes.find((node) => node.title === "Neu.pdf")!;
  expect(added.notice).toBe("Nicht referenziert");
  expect(added.reason).toContain("nicht dokumentiert");
  expect(layoutContentGraph(graph).has(added.id)).toBe(true);
});

test("failed, inaccessible and pending resources remain visible without a revision", () => {
  for (const status of ["failed", "unsupported", "pending"]) {
    const graph = buildContentGraph(
      snapshot([material({ revision: null, status, reason: "Access denied" })]),
    );
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].notice).not.toBeNull();
    expect(graph.nodes[0].reason).toBe("Access denied");
  }
});

test("source warnings do not vanish because a citation exists", () => {
  const graph = buildContentGraph(
    snapshot([
      material({ warnings: ["Diagramm konnte nicht gelesen werden"] }),
    ]),
    version(),
  );
  expect(graph.nodes[0].notice).toBe("Hinweis zur Aufbereitung");
  expect(graph.nodes[0].reason).toContain("Diagramm");
});

test("source revisions never silently retarget after a Moodle update", () => {
  const changed = "d".repeat(64);
  const graph = buildContentGraph(
    snapshot([material({ revision: changed })]),
    version(),
  );
  expect(graph.nodes.filter((node) => node.kind === "material")).toHaveLength(
    2,
  );
  const old = graph.nodes.find(
    (node) => node.id === materialNodeId(materialId, revision),
  )!;
  expect(old.notice).toBe("Andere Quellenfassung");
  expect(graph.edges.every((edge) => edge.source === old.id)).toBe(true);
  expect(
    graph.nodes.find((node) => node.id === materialNodeId(materialId, changed))
      ?.notice,
  ).toBe("Nicht referenziert");
});

test("historical sources absent from current inventory remain traceable without claiming deletion", () => {
  const graph = buildContentGraph(snapshot([]), version());
  const source = graph.nodes.find((node) => node.kind === "material")!;
  expect(source.notice).toBe("Nicht im Materialstand");
  expect(source.reason).toContain("keine Löschung");
  expect(source.title).toBe("Folien.pdf");
  expect(graph.edges).toHaveLength(2);
});

test("a rewritten chapter keeps identity and provenance while original input stays immutable", () => {
  const original = version();
  const before = JSON.stringify(original);
  const a = buildContentGraph(snapshot(), original);
  const b = buildContentGraph(snapshot(), {
    ...original,
    sections: [
      {
        ...original.sections[0],
        title: "Neue Erklärung",
        markdown: "Anderer Text",
      },
    ],
  });
  expect(a.edges).toEqual(b.edges);
  expect(a.nodes.map((node) => node.id)).toEqual(
    b.nodes.map((node) => node.id),
  );
  expect(JSON.stringify(original)).toBe(before);
});

test("personal content without sources is visible, not automatically classified as incorrect", () => {
  const original = version();
  original.sections[0].sources = [];
  const graph = buildContentGraph(snapshot(), original);
  const chapter = graph.nodes.find((node) => node.kind === "chapter")!;
  expect(chapter.notice).toBe("Ohne Quellenbezug");
  expect(chapter.reason).toContain("eigene Ergänzung");
});

test("a course without a generated version still exposes all material outcomes", () => {
  const graph = buildContentGraph(snapshot(), null);
  expect(graph.nodes[0].notice).toBe("Noch kein Lerninhalt");
  expect(graph.edges).toEqual([]);
  expect(buildContentGraph(snapshot([])).nodes).toEqual([]);
});

test("the whole course is laid out without pagination or isolated-node loss", () => {
  const original = version();
  original.sections = Array.from({ length: 100 }, (_, i) => ({
    ...original.sections[0],
    id: `chapter-${i}`,
  }));
  const graph = buildContentGraph(
    snapshot([
      material(),
      material({ id: "c".repeat(64), name: "Unlinked.pdf" }),
    ]),
    original,
  );
  const positions = layoutContentGraph(graph);
  expect(positions.size).toBe(graph.nodes.length);
  expect(
    new Set([...positions.values()].map((p) => `${p.x}:${p.y}`)).size,
  ).toBe(graph.nodes.length);
  for (const edge of graph.edges) {
    expect(positions.has(edge.source)).toBe(true);
    expect(positions.has(edge.target)).toBe(true);
  }
  expect(layoutContentGraph(graph)).toEqual(positions);
});

test("search includes gaps, chapter and task nodes, full names and accents", () => {
  const original = version();
  original.sections[0].title = "Ökologie und Evolution";
  original.sections[0].sources = [];
  const graph = buildContentGraph(snapshot(), original);
  expect(findGraphNodes(graph, "öko kapitel")).toHaveLength(1);
  expect(findGraphNodes(graph, "", true)).toHaveLength(1);
  expect(findGraphNodes(graph, "vergleich")[0].kind).toBe("exercise");
  expect(findGraphNodes(graph, "unbekannt")).toEqual([]);
});

test("graph links round-trip stable IDs and malformed links are safe", () => {
  const id = materialNodeId(materialId, revision);
  expect(graphFocusFromHash(`#graph/${encodeURIComponent(id)}`)).toBe(id);
  expect(graphFocusFromHash("#graph/%zz")).toBeUndefined();
  expect(graphFocusFromHash("#section-123")).toBeUndefined();
});

test("graph uses shared controls, lazy loading, tokens and no dashboard extras or writes", () => {
  const read = (name: string) =>
    readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
  const view = read("ContentGraphView.tsx");
  expect(view).toContain('from "@xyflow/react"');
  expect(view).toContain('from "@dotnaos/ui-base"');
  expect(view).not.toContain("MiniMap");
  expect(view).not.toContain("<Background");
  expect(view).toContain("erwartete, nie erstellte Kapitel");
  expect(view).not.toContain('method: "POST"');
  expect(view).not.toContain('method: "PUT"');
  expect(read("CourseDetail.tsx")).toContain(
    'lazy(() => import("./ContentGraphView")',
  );
  expect(read("content-graph.css")).toContain("var(--color-accent)");
});

test("source location links group blocks on a page but never merge different revisions", () => {
  const locations = sourceLocations([
    ref,
    { ...ref, blockId: "block-2" },
    { ...ref, page: 4 },
    { ...ref, revision: "f".repeat(64) },
  ]);
  expect(locations).toHaveLength(3);
  expect(locations[0]).toEqual(ref);
  expect(
    sourceLocations([
      { ...ref, page: null },
      { ...ref, page: null, blockId: "block-3" },
    ]),
  ).toHaveLength(1);
});

const liveSections = () => [
  {
    id: 1,
    name: "Grundlagen",
    summary: "Kursinformationen",
    modules: [
      {
        id: 2,
        name: "Vorlesung",
        type: "resource",
        url: null,
        description: "Neue Beschreibung",
        resources: [
          {
            id: "file-id",
            name: "Folien.pdf",
            type: "file",
            mimeType: "application/pdf",
            size: 500,
            modifiedAt: 1,
            url: null,
          },
        ],
      },
      {
        id: 3,
        name: "Ankündigungen",
        type: "forum",
        url: null,
        description: "",
        resources: [],
      },
    ],
  },
  { id: 4, name: "Noch leer", summary: "Kommt später", modules: [] },
];

test("all live Moodle sections, activities and resources appear before any preparation", () => {
  const graph = buildContentGraph(undefined, undefined, liveSections());
  expect(graph.nodes.map((n) => n.kind)).toEqual([
    "section",
    "activity",
    "resource",
    "activity",
    "section",
  ]);
  expect(graph.nodes.find((n) => n.id === "section:4")?.title).toBe(
    "Noch leer",
  );
  expect(graph.nodes.find((n) => n.id === "activity:3")?.notice).toBe(
    "Noch nicht erfasst",
  );
  expect(graph.nodes.find((n) => n.id === "activity:2")?.description).toBe(
    "Neue Beschreibung",
  );
  expect(
    graph.edges.every((e) => e.kind === "contains" && !e.references.length),
  ).toBe(true);
  expect(layoutContentGraph(graph).size).toBe(5);
});

test("new uploads, unknown activity types and extra files appear with the old material snapshot", () => {
  const sections = liveSections();
  sections[0].modules[0].resources.push({
    ...sections[0].modules[0].resources[0],
    id: "new-file",
    name: "Neu.pdf",
  });
  sections[0].modules.push({
    id: 9,
    name: "Interaktives Werkzeug",
    type: "custom-plugin",
    url: null,
    description: "",
    resources: [],
  });
  const graph = buildContentGraph(snapshot(), version(), sections);
  expect(graph.nodes.find((n) => n.title === "Neu.pdf")?.kind).toBe("resource");
  expect(graph.nodes.find((n) => n.id === "activity:9")?.notice).toBe(
    "Noch nicht erfasst",
  );
  expect(graph.nodes.filter((n) => n.kind === "section")).toHaveLength(2);
  expect(graph.nodes.filter((n) => n.kind === "activity")).toHaveLength(3);
  expect(graph.nodes.filter((n) => n.kind === "resource")).toHaveLength(2);
  expect(graph.nodes.filter((n) => n.kind === "material")).toHaveLength(1);
  expect(graph.edges.filter((e) => e.kind === "provenance")).toHaveLength(2);
  expect(
    graph.edges.find(
      (e) =>
        e.source === "activity:2" &&
        e.target === materialNodeId(materialId, revision),
    )?.kind,
  ).toBe("contains");
});

test("identical names do not conflate live resources or imply identical prepared revisions", () => {
  const sections = liveSections();
  sections[0].modules[0].resources.push({
    ...sections[0].modules[0].resources[0],
    id: "different-id",
  });
  const graph = buildContentGraph(snapshot(), version(), sections);
  const resources = graph.nodes.filter((n) => n.kind === "resource");
  expect(resources).toHaveLength(2);
  expect(new Set(resources.map((n) => n.id)).size).toBe(2);
  expect(resources.every((n) => !n.revision && !n.materialId)).toBe(true);
  expect(
    graph.edges
      .filter((e) => e.kind === "provenance")
      .every((e) => e.source === materialNodeId(materialId, revision)),
  ).toBe(true);
});

test("missing raw resource IDs retain every occurrence", () => {
  const sections = liveSections();
  sections[0].modules[0].resources = [
    { ...sections[0].modules[0].resources[0], id: "" },
    { ...sections[0].modules[0].resources[0], id: "" },
  ];
  const graph = buildContentGraph(undefined, undefined, sections);
  expect(new Set(graph.nodes.map((n) => n.id)).size).toBe(graph.nodes.length);
  expect(graph.nodes.filter((n) => n.kind === "resource")).toHaveLength(2);
});

test("selection and search never prune the canvas and provider data is independent of generation", () => {
  const source = readFileSync(
    new URL("../src/ContentGraphView.tsx", import.meta.url),
    "utf8",
  );
  expect(source).toContain("layoutContentGraph");
  expect(source).not.toContain("graphNeighbourhood");
  expect(source).not.toContain("pageSize");
  expect(source).not.toContain("setPage");
  expect(source).toContain("graph.nodes.map");
  expect(source).toContain("Gesamten Kurs anzeigen");
  const graph = buildContentGraph(undefined, version(), liveSections());
  expect(graph.nodes.some((n) => n.kind === "activity")).toBe(true);
  expect(graph.nodes.some((n) => n.kind === "chapter")).toBe(true);
  const before = JSON.stringify(graph);
  findGraphNodes(graph, "Vorlesung");
  findGraphNodes(graph, "", true);
  expect(JSON.stringify(graph)).toBe(before);
});
