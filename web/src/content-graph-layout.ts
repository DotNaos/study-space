import type { ContentGraph, TraceEdge, TraceNode } from "./content-graph";

export type TraceRow = { item: TraceNode; depth: number };
export type TraceBox = {
  id: string;
  clusterId: string;
  kind: "section" | "moodle" | "sources" | "chapters" | "exercises";
  title: string;
  rows: TraceRow[];
  position: { x: number; y: number };
  width: number;
  height: number;
};
export type TraceCluster = {
  id: string;
  title: string;
  position: { x: number; y: number };
  width: number;
  height: number;
};
export type TraceBundle = {
  id: string;
  source: string;
  target: string;
  kind: TraceEdge["kind"];
  relations: TraceEdge[];
};
export type GroupedContentGraph = {
  clusters: TraceCluster[];
  boxes: TraceBox[];
  bundles: TraceBundle[];
  itemToBox: Map<string, string>;
};

const ROW_HEIGHT = 44;
const HEADER_HEIGHT = 44;
const BODY_LIMIT = 308;
const CLUSTER_WIDTH = 1512;

/** A presentation projection, not a new course structure. Every raw item occurs
 * exactly once. Provenance remains on the original IDs, never on a guessed topic. */
export function groupContentGraph(graph: ContentGraph): GroupedContentGraph {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const sectionNodes = graph.nodes.filter((node) => node.kind === "section");
  const groups = new Map<
    string,
    { title: string; root?: TraceNode; items: TraceNode[] }
  >();
  const sectionKey = (id: number) => `section:${id}`;
  for (const node of sectionNodes)
    groups.set(node.id, { title: node.title, root: node, items: [] });

  const ensureGroup = (key: string, title: string) => {
    if (!groups.has(key)) groups.set(key, { title, items: [] });
    return key;
  };
  const sourceGroup = new Map<string, string>();
  // A live activity's current section takes precedence for visual placement only.
  // Stored source revisions and the provenance edges are not changed.
  const activitySections = new Map(
    graph.nodes
      .filter((node) => node.kind === "activity")
      .map((node) => [node.moduleId, node.sectionId]),
  );
  for (const node of graph.nodes) {
    if (
      node.kind === "section" ||
      node.kind === "chapter" ||
      node.kind === "exercise"
    )
      continue;
    const section = activitySections.get(node.moduleId) ?? node.sectionId;
    const key =
      section === undefined
        ? ensureGroup("unassigned", "Ohne Abschnitt")
        : ensureGroup(
            sectionKey(section),
            node.material?.sectionName || "Gespeicherter Abschnitt",
          );
    sourceGroup.set(node.id, key);
    groups.get(key)!.items.push(node);
  }

  const incoming = new Map<string, TraceNode[]>();
  for (const edge of graph.edges) {
    if (edge.kind !== "provenance") continue;
    const source = byId.get(edge.source);
    if (source)
      incoming.set(edge.target, [...(incoming.get(edge.target) || []), source]);
  }
  for (const node of graph.nodes) {
    if (node.kind !== "chapter" && node.kind !== "exercise") continue;
    // Each distinct material has one vote, regardless of repeated citations or
    // extracted block count. Ties stay explicitly cross-section, never arbitrary.
    const votes = new Map<string, Set<string>>();
    for (const source of incoming.get(node.id) || []) {
      const group = sourceGroup.get(source.id) || "unassigned";
      const ids = votes.get(group) || new Set<string>();
      ids.add(source.materialId || source.id);
      votes.set(group, ids);
    }
    const ranked = [...votes].sort((a, b) => b[1].size - a[1].size);
    let key: string;
    if (!ranked.length) key = ensureGroup("unassigned", "Ohne Abschnitt");
    else if (ranked.length > 1 && ranked[0][1].size === ranked[1][1].size)
      key = ensureGroup("shared", "Abschnittsübergreifend");
    else key = ranked[0][0];
    groups.get(key)!.items.push(node);
  }

  const clusters: TraceCluster[] = [];
  const boxes: TraceBox[] = [];
  const itemToBox = new Map<string, string>();
  let top = 0;
  for (const [key, group] of groups) {
    const clusterId = `cluster:${key}`;
    const local: TraceBox[] = [];
    const add = (
      kind: TraceBox["kind"],
      title: string,
      rows: TraceRow[],
      x: number,
    ) => {
      if (!rows.length && kind !== "section") return undefined;
      const box: TraceBox = {
        id: `box:${key}:${kind}`,
        clusterId,
        kind,
        title,
        rows,
        position: { x, y: 0 },
        width: kind === "section" ? 256 : 336,
        height:
          kind === "section"
            ? 124
            : HEADER_HEIGHT +
              Math.min(rows.length * ROW_HEIGHT, BODY_LIMIT) +
              8,
      };
      for (const row of rows) itemToBox.set(row.item.id, box.id);
      local.push(box);
      return box;
    };
    const root = add(
      "section",
      group.title,
      group.root ? [{ item: group.root, depth: 0 }] : [],
      24,
    )!;
    const moodle: TraceRow[] = [];
    const resources = group.items.filter((node) => node.kind === "resource");
    const placed = new Set<string>();
    for (const activity of group.items.filter(
      (node) => node.kind === "activity",
    )) {
      moodle.push({ item: activity, depth: 0 });
      for (const resource of resources.filter(
        (node) => node.moduleId === activity.moduleId,
      )) {
        moodle.push({ item: resource, depth: 1 });
        placed.add(resource.id);
      }
    }
    // Orphaned resources still have a visible row, including partial input states.
    moodle.push(
      ...resources
        .filter((node) => !placed.has(node.id))
        .map((item) => ({ item, depth: 0 })),
    );
    const live = add("moodle", "Moodle", moodle, 344);
    const sources = add(
      "sources",
      "Quellen",
      group.items
        .filter((node) => node.kind === "material")
        .map((item) => ({ item, depth: 0 })),
      748,
    );
    const chapters = add(
      "chapters",
      "Kapitel",
      group.items
        .filter((node) => node.kind === "chapter")
        .map((item) => ({ item, depth: 0 })),
      1152,
    );
    const exercises = add(
      "exercises",
      "Aufgaben",
      group.items
        .filter((node) => node.kind === "exercise")
        .map((item) => ({ item, depth: 0 })),
      1152,
    );
    const outputsHeight =
      (chapters?.height || 0) +
      (exercises?.height || 0) +
      (chapters && exercises ? 20 : 0);
    const innerHeight = Math.max(
      root.height,
      live?.height || 0,
      sources?.height || 0,
      outputsHeight,
    );
    for (const box of [root, live, sources]) {
      if (box) box.position.y = 24 + (innerHeight - box.height) / 2;
    }
    let outputTop = 24 + (innerHeight - outputsHeight) / 2;
    for (const box of [chapters, exercises]) {
      if (box) {
        box.position.y = outputTop;
        outputTop += box.height + 20;
      }
    }
    const right = Math.max(...local.map((box) => box.position.x + box.width));
    clusters.push({
      id: clusterId,
      title: group.title,
      position: { x: 0, y: top },
      width: Math.min(CLUSTER_WIDTH, right + 24),
      height: innerHeight + 48,
    });
    boxes.push(...local);
    top += innerHeight + 104;
  }

  // Pack section clusters into at most two columns. Each cluster keeps its own
  // fixed left-to-right flow; a new item never adds another output column.
  if (clusters.length > 4) {
    let rowTop = 0;
    for (let i = 0; i < clusters.length; i += 2) {
      clusters[i].position = { x: 0, y: rowTop };
      if (clusters[i + 1])
        clusters[i + 1].position = { x: CLUSTER_WIDTH + 72, y: rowTop };
      rowTop += Math.max(clusters[i].height, clusters[i + 1]?.height || 0) + 56;
    }
  }

  const bundleMap = new Map<string, TraceBundle>();
  for (const relation of graph.edges) {
    const source = itemToBox.get(relation.source);
    const target = itemToBox.get(relation.target);
    // Relations inside one list are expressed by nesting and the item inspector.
    if (!source || !target || source === target) continue;
    const id = `bundle:${relation.kind}:${source}->${target}`;
    const bundle = bundleMap.get(id) || {
      id,
      source,
      target,
      kind: relation.kind,
      relations: [],
    };
    bundle.relations.push(relation);
    bundleMap.set(id, bundle);
  }
  return { clusters, boxes, bundles: [...bundleMap.values()], itemToBox };
}
