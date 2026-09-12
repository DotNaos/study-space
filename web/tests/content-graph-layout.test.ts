import { expect, test } from "bun:test";
import { groupContentGraph } from "../src/content-graph-layout";
import type { ContentGraph, TraceNode, TraceEdge } from "../src/content-graph";

const node = (
  kind: TraceNode["kind"],
  id: string,
  sectionId?: number,
  extra: Partial<TraceNode> = {},
): TraceNode => ({
  id,
  kind,
  title: id,
  subtitle: kind,
  notice: null,
  reason: "",
  sectionId,
  ...extra,
});
const edge = (
  source: string,
  target: string,
  kind: TraceEdge["kind"] = "provenance",
): TraceEdge => ({
  id: `${source}->${target}`,
  source,
  target,
  kind,
  references: [],
});
function sample(count = 30): ContentGraph {
  const chapters = Array.from({ length: count }, (_, i) =>
    node("chapter", `chapter:${i}`),
  );
  const exercises = Array.from({ length: count }, (_, i) =>
    node("exercise", `exercise:${i}`),
  );
  return {
    nodes: [
      node("section", "section:1", 1),
      node("section", "section:2", 2),
      node("activity", "activity:11", 1, { moduleId: 11 }),
      node("resource", "resource:11", 1, { moduleId: 11 }),
      node("material", "material:1", 1, { moduleId: 11, materialId: "m1" }),
      ...chapters,
      ...exercises,
    ],
    edges: [
      edge("section:1", "activity:11", "contains"),
      edge("activity:11", "resource:11", "contains"),
      edge("activity:11", "material:1", "contains"),
      ...[...chapters, ...exercises].map((n) => edge("material:1", n.id)),
    ],
  };
}

test("every course entry appears exactly once inside larger list nodes, including empty sections", () => {
  const graph = sample();
  const before = JSON.stringify(graph);
  const grouped = groupContentGraph(graph);
  const ids = grouped.boxes.flatMap((box) =>
    box.rows.map((row) => row.item.id),
  );
  expect(ids.toSorted()).toEqual(graph.nodes.map((n) => n.id).toSorted());
  expect(new Set(ids).size).toBe(ids.length);
  expect(grouped.boxes).toHaveLength(6);
  expect(grouped.clusters).toHaveLength(2);
  expect(grouped.boxes.find((b) => b.kind === "chapters")?.rows).toHaveLength(
    30,
  );
  expect(grouped.boxes.find((b) => b.kind === "exercises")?.rows).toHaveLength(
    30,
  );
  expect(JSON.stringify(graph)).toBe(before);
});

test("all input edges are preserved either in a bundle or within a list", () => {
  const graph = sample();
  const grouped = groupContentGraph(graph);
  const bundled = new Set(
    grouped.bundles.flatMap((b) => b.relations.map((e) => e.id)),
  );
  for (const relation of graph.edges)
    expect(
      bundled.has(relation.id) ||
        grouped.itemToBox.get(relation.source) ===
          grouped.itemToBox.get(relation.target),
    ).toBe(true);
  expect(grouped.bundles.filter((b) => b.kind === "provenance")).toHaveLength(
    2,
  );
  expect(
    grouped.bundles.some(
      (b) => b.source.endsWith(":chapters") && b.target.endsWith(":exercises"),
    ),
  ).toBe(false);
});

test("section roots are centered on their descendants and boxes never overlap", () => {
  const grouped = groupContentGraph(sample());
  for (const cluster of grouped.clusters) {
    const boxes = grouped.boxes.filter((b) => b.clusterId === cluster.id);
    const root = boxes.find((b) => b.kind === "section")!;
    const children = boxes.filter((b) => b.kind !== "section");
    if (children.length) {
      const top = Math.min(...children.map((b) => b.position.y));
      const bottom = Math.max(...children.map((b) => b.position.y + b.height));
      expect(root.position.y + root.height / 2).toBe((top + bottom) / 2);
    }
    for (const box of boxes) {
      expect(box.position.x + box.width).toBeLessThanOrEqual(cluster.width);
      expect(box.position.y + box.height).toBeLessThanOrEqual(cluster.height);
      for (const other of boxes.filter((b) => b !== box))
        expect(
          box.position.x + box.width <= other.position.x ||
            other.position.x + other.width <= box.position.x ||
            box.position.y + box.height <= other.position.y ||
            other.position.y + other.height <= box.position.y,
        ).toBe(true);
    }
  }
});

test("large output lists do not widen the graph or drop rows", () => {
  const small = groupContentGraph(sample(30));
  const large = groupContentGraph(sample(500));
  expect(large.boxes.length).toBe(small.boxes.length);
  expect(large.clusters.map((c) => [c.width, c.height])).toEqual(
    small.clusters.map((c) => [c.width, c.height]),
  );
  expect(large.boxes.find((b) => b.kind === "exercises")?.rows).toHaveLength(
    500,
  );
});

test("mixed-source output appears once and retains every cross-section reference", () => {
  const graph = sample(1);
  graph.nodes.push(node("material", "material:2", 2, { materialId: "m2" }));
  graph.edges.push(edge("material:2", "chapter:0"));
  const grouped = groupContentGraph(graph);
  const shared = grouped.clusters.find(
    (c) => c.title === "Abschnittsübergreifend",
  )!;
  expect(shared).toBeDefined();
  expect(
    grouped.boxes.find((b) => b.id === grouped.itemToBox.get("chapter:0"))
      ?.clusterId,
  ).toBe(shared.id);
  expect(
    grouped.bundles
      .flatMap((b) => b.relations)
      .filter((e) => e.target === "chapter:0"),
  ).toHaveLength(2);
});

test("missing provenance, historical sources and unavailable inventory stay visible", () => {
  const graph: ContentGraph = {
    nodes: [
      node("chapter", "own"),
      node("material", "historical", undefined, {
        notice: "Nicht im Materialstand",
      }),
      node("exercise", "task"),
    ],
    edges: [edge("historical", "task")],
  };
  const grouped = groupContentGraph(graph);
  expect(grouped.itemToBox.size).toBe(3);
  expect(grouped.clusters[0].title).toBe("Ohne Abschnitt");
});

test("live resources remain nested below their activity without merging same-named material revisions", () => {
  const grouped = groupContentGraph(sample());
  const moodle = grouped.boxes.find((b) => b.kind === "moodle")!;
  expect(moodle.rows.map((r) => [r.item.id, r.depth])).toEqual([
    ["activity:11", 0],
    ["resource:11", 1],
  ]);
  expect(grouped.itemToBox.get("resource:11")).not.toBe(
    grouped.itemToBox.get("material:1"),
  );
});

test("updates keep existing item and group identities, with no input mutation", () => {
  const graph = sample();
  const old = groupContentGraph(graph);
  const next = {
    nodes: [
      ...graph.nodes,
      node("activity", "activity:12", 1, { moduleId: 12 }),
    ],
    edges: [...graph.edges, edge("section:1", "activity:12", "contains")],
  };
  const updated = groupContentGraph(next);
  for (const [id, box] of old.itemToBox)
    expect(updated.itemToBox.get(id)).toBe(box);
  expect(updated.itemToBox.size).toBe(old.itemToBox.size + 1);
  expect(groupContentGraph(graph)).toEqual(old);
});
