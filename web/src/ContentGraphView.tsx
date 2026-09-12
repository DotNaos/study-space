import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Button, Icon, Input } from "@dotnaos/ui-base";
import {
  Handle,
  Panel,
  Position,
  ReactFlow,
  useReactFlow,
  useStore,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./content-graph.css";
import type { CourseSection } from "./api";
import type { LearningCourse, LearningTarget } from "./learning-api";
import type { MaterialState } from "./material-api";
import type { SourceSelection } from "./SourceViewer";
import { DialogShell } from "./DialogShell";
import { Loading, Notice } from "./shared";
import {
  buildContentGraph,
  findGraphNodes,
  graphFocusFromHash,
  graphNeighbourhood,
  sourceLocations,
  kindLabel,
  type ContentGraph,
  type TraceNode,
} from "./content-graph";

type FlowNode = Node<{ item: TraceNode; vertical: boolean }, "content">;
const ContentNode = memo(function ContentNode({
  data,
  selected,
}: NodeProps<FlowNode>) {
  const item = data.item;
  return (
    <div className={`study-trace-node${selected ? " is-selected" : ""}`}>
      <Handle
        type="target"
        position={data.vertical ? Position.Top : Position.Left}
        isConnectable={false}
      />
      <Icon
        name={
          item.kind === "material"
            ? "file-text"
            : item.kind === "chapter"
              ? "list"
              : "pencil-line"
        }
        size="m"
      />
      <div className="study-trace-node-label">
        <span>{item.title}</span>
        <small>{item.kind === "material" ? "Material" : item.subtitle}</small>
      </div>
      {item.notice && (
        <span className="study-trace-warning" title={item.notice}>
          <Icon name="alert-triangle" size="s" />
          <span className="sr-only">{item.notice}</span>
        </span>
      )}
      <Handle
        type="source"
        position={data.vertical ? Position.Bottom : Position.Right}
        isConnectable={false}
      />
    </div>
  );
});
const nodeTypes = { content: ContentNode };

function ViewControls({ viewKey }: { viewKey: string }) {
  const flow = useReactFlow();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  useEffect(() => {
    const frame = requestAnimationFrame(
      () => void flow.fitView({ padding: 0.12, minZoom: 0.45, maxZoom: 1 }),
    );
    return () => cancelAnimationFrame(frame);
  }, [flow, viewKey, width, height]);
  return (
    <Panel position="bottom-right">
      <div className="study-trace-controls">
        <Button
          variant="icon"
          size="sm"
          icon="minus"
          accessibilityLabel="Verkleinern"
          onPress={() => void flow.zoomOut()}
        />
        <Button
          variant="icon"
          size="sm"
          icon="plus"
          accessibilityLabel="Vergrößern"
          onPress={() => void flow.zoomIn()}
        />
        <Button
          variant="icon"
          size="sm"
          icon="maximize"
          accessibilityLabel="Graph einpassen"
          onPress={() => void flow.fitView({ padding: 0.12, maxZoom: 1 })}
        />
      </div>
    </Panel>
  );
}

function GraphExplorer({
  graph,
  noticesOnly,
  onChoose,
  onClose,
}: {
  graph: ContentGraph;
  noticesOnly: boolean;
  onChoose: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const results = findGraphNodes(graph, query, noticesOnly);
  return (
    <DialogShell
      title={
        noticesOnly
          ? "Offene Bezüge & Hinweise"
          : "Material oder Lerninhalt finden"
      }
      onClose={onClose}
    >
      <div className="p-4">
        <Input
          type="search"
          accessibilityLabel="Graph durchsuchen"
          placeholder="Suchen …"
          value={query}
          onValueChange={setQuery}
        />
        <p className="my-3 text-xs text-text-muted" role="status">
          {results.length} Ergebnisse
        </p>
        <div className="study-trace-search-results">
          {results.map((node) => (
            <Button
              key={node.id}
              variant="ghost"
              size="sm"
              label={`${node.kind === "material" ? "Material" : node.subtitle} · ${node.title}${node.notice ? ` · ${node.notice}` : ""}`}
              onPress={() => onChoose(node.id)}
            />
          ))}
          {!results.length && (
            <p className="text-sm text-text-muted">Keine passenden Inhalte.</p>
          )}
        </div>
      </div>
    </DialogShell>
  );
}

export function ContentGraphView({
  learning,
  materials,
  sections,
  onSource,
  onOpenLearning,
  onOpenActivity,
}: {
  learning: LearningCourse;
  materials: MaterialState;
  sections?: CourseSection[];
  onSource: (source: SourceSelection) => void;
  onOpenLearning: (target: LearningTarget) => void;
  onOpenActivity: (moduleId: number) => void;
}) {
  const version = learning.state?.activeVersion;
  const graph = useMemo(
    () =>
      materials.snapshot
        ? buildContentGraph(materials.snapshot, version, sections)
        : { nodes: [], edges: [] },
    [materials.snapshot, version, sections],
  );
  const [requestedId, setRequestedId] = useState(() =>
    typeof window === "undefined"
      ? undefined
      : graphFocusFromHash(window.location.hash),
  );
  const [selectedId, setSelectedId] = useState<string>();
  const [explorer, setExplorer] = useState<"all" | "notices">();
  const [page, setPage] = useState(0);
  const [narrow, setNarrow] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 639px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px)");
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const pageSize = narrow ? 1 : 6;
  const [colorMode, setColorMode] = useState<"dark" | "light">(() =>
    typeof document !== "undefined" &&
    document.documentElement.dataset.theme === "dark"
      ? "dark"
      : "light",
  );
  useEffect(() => {
    const update = () =>
      setColorMode(
        document.documentElement.dataset.theme === "dark" ? "dark" : "light",
      );
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    update();
    return () => observer.disconnect();
  }, []);
  const canvas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const changed = () => {
      setRequestedId(graphFocusFromHash(window.location.hash));
      setPage(0);
      setSelectedId(undefined);
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  const defaultNode =
    graph.nodes.find(
      (node) =>
        node.kind === "material" &&
        node.material?.mimeType === "application/pdf" &&
        graph.edges.some((edge) => edge.source === node.id),
    ) || graph.nodes[0];
  const focus =
    graph.nodes.find((node) => node.id === requestedId) || defaultNode;
  const view = useMemo(
    () => graphNeighbourhood(graph, focus?.id || "", page, pageSize),
    [graph, focus?.id, page, pageSize],
  );
  const selected = graph.nodes.find((node) => node.id === selectedId);
  const noticeCount = graph.nodes.filter((node) => node.notice).length;
  const rows = Math.max(1, view.nodes.length - 1);
  const flowNodes: FlowNode[] = view.nodes.map((node) => ({
    id: node.id,
    type: "content",
    data: { item: node, vertical: narrow },
    selected: node.id === selectedId,
    position: narrow
      ? {
          x: 0,
          y: node.kind === "material" || view.nodes.length === 1 ? 0 : 150,
        }
      : {
          x: node.kind === "material" ? 0 : 360,
          y:
            node.id === focus?.id
              ? (rows - 1) * 42
              : view.nodes
                  .filter((item) => item.id !== focus?.id)
                  .findIndex((item) => item.id === node.id) * 84,
        },
    ariaLabel: `${kindLabel[node.kind]}: ${node.title}${node.notice ? `. ${node.notice}` : ""}. Details mit Enter öffnen.`,
  }));
  const flowEdges = view.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "default",
    focusable: false,
    className:
      edge.source === selectedId || edge.target === selectedId
        ? "study-trace-active-edge"
        : undefined,
  }));
  function choose(id: string) {
    setRequestedId(id);
    setPage(0);
    setSelectedId(undefined);
    setExplorer(undefined);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#graph/${encodeURIComponent(id)}`,
    );
  }
  function closeDetails() {
    setSelectedId(undefined);
    const element = Array.from(
      canvas.current?.querySelectorAll<HTMLElement>(".react-flow__node") || [],
    ).find((node) => node.dataset.id === selectedId);
    element?.focus();
  }
  if (learning.error || materials.error)
    return (
      <div className="py-5">
        <Notice>{learning.error || materials.error}</Notice>
        <Button
          label="Erneut laden"
          onPress={() => {
            void learning.refresh().catch(() => {});
            void materials.refresh().catch(() => {});
          }}
        />
      </div>
    );
  if (learning.loading || !materials.snapshot)
    return (
      <div className="py-5">
        <Loading label="Quellenbezüge werden geladen …" />
      </div>
    );
  if (!focus)
    return (
      <p className="py-6 text-sm text-text-muted">
        Noch keine Materialien erfasst. Der Graph entsteht aus deinen
        Materialien und gespeicherten Quellenverweisen.
      </p>
    );
  const references = selected
    ? graph.edges
        .filter((edge) => edge.target === selected.id)
        .flatMap((edge) => edge.references)
    : [];
  const selectedSourceRefs =
    selected?.kind === "material"
      ? view.edges
          .filter((edge) => edge.source === selected.id)
          .flatMap((edge) => edge.references)
      : [];
  return (
    <section
      className="study-content-graph"
      aria-label="Quellen- und Inhaltsgraph"
    >
      <div className="study-trace-toolbar">
        <div className="study-trace-picker">
          <Button
            variant="ghost"
            size="sm"
            icon="search"
            label={focus.title}
            accessibilityLabel="Material oder Lerninhalt auswählen"
            onPress={() => setExplorer("all")}
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon="alert-triangle"
          label={`${noticeCount} Hinweise`}
          accessibilityLabel={`${noticeCount} offene Bezüge und Hinweise anzeigen`}
          onPress={() => setExplorer("notices")}
        />
      </div>
      {requestedId && requestedId !== focus.id && (
        <p role="status" className="mb-3 text-xs text-text-muted">
          Dieser Verweis ist in der aktiven Lernversion nicht enthalten. Die
          übrigen Inhalte bleiben erreichbar.
        </p>
      )}
      <div className={`study-trace-workspace${selected ? " has-details" : ""}`}>
        <div
          className="study-trace-canvas"
          ref={canvas}
          onKeyDownCapture={(event) => {
            if (event.key === "Escape") closeDetails();
            if (event.key !== "Enter" && event.key !== " ") return;
            const node = (event.target as HTMLElement).closest<HTMLElement>(
              ".react-flow__node",
            );
            if (node?.dataset.id) {
              event.preventDefault();
              event.stopPropagation();
              setSelectedId(node.dataset.id);
            }
          }}
        >
          <ReactFlow<FlowNode>
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            colorMode={colorMode}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesReconnectable={false}
            deleteKeyCode={null}
            selectionOnDrag={false}
            panOnDrag={[0, 1]}
            zoomOnScroll={false}
            zoomOnDoubleClick={false}
            minZoom={0.35}
            maxZoom={1.5}
            fitView
            fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(undefined)}
            ariaLabelConfig={{
              "node.a11yDescription.default":
                "Mit Tab zwischen Inhalten wechseln. Enter öffnet die Details.",
              "controls.fitView.ariaLabel": "Graph einpassen",
            }}
          >
            <Panel position="top-left">
              <span className="study-trace-caption">
                {narrow
                  ? "Material ↓ Lerninhalt"
                  : "Materialien → Kapitel & Aufgaben"}
              </span>
            </Panel>
            <ViewControls
              viewKey={`${focus.id}:${narrow}:${view.page}:${!!selected}:${view.nodes.map((node) => node.id).join(",")}`}
            />
          </ReactFlow>
        </div>
        {selected && (
          <aside className="study-trace-inspector" aria-label="Inhaltsdetails">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-text-muted">
                  {selected.kind === "material"
                    ? "Material"
                    : selected.subtitle}
                </p>
                <h3 className="mt-1 break-words text-sm font-medium">
                  {selected.title}
                </h3>
              </div>
              <Button
                variant="icon"
                size="sm"
                icon="close"
                accessibilityLabel="Details schließen"
                onPress={closeDetails}
              />
            </div>
            {selected.notice && (
              <p className="mt-4 flex items-start gap-2 text-xs">
                <Icon name="alert-triangle" size="s" />
                <span>{selected.notice}</span>
              </p>
            )}
            {selected.notice && (
              <p className="mt-3 whitespace-pre-line text-xs leading-5 text-text-muted">
                {selected.reason}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-1">
              {selected.id !== focus.id && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon="git-branch"
                  label="Verbindungen"
                  onPress={() => choose(selected.id)}
                />
              )}
              {selected.kind === "material" &&
                selected.revision &&
                selected.materialId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="file-text"
                    label="Quelle öffnen"
                    onPress={() =>
                      onSource({
                        materialId: selected.materialId!,
                        revision: selected.revision!,
                        name: selected.title,
                        blockId: selectedSourceRefs[0]?.blockId,
                        page: selectedSourceRefs[0]?.page,
                      })
                    }
                  />
                )}
              {selected.kind === "material" &&
                !selected.revision &&
                selected.material?.moduleId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    label="Aktivität öffnen"
                    onPress={() => onOpenActivity(selected.material!.moduleId!)}
                  />
                )}
              {selected.kind !== "material" && selected.contentId && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon="external-link"
                  label={
                    selected.kind === "chapter"
                      ? "Kapitel öffnen"
                      : "Aufgabe öffnen"
                  }
                  onPress={() =>
                    onOpenLearning({
                      kind: selected.kind as "chapter" | "exercise",
                      id: selected.contentId!,
                    })
                  }
                />
              )}
            </div>
            {!!references.length && (
              <div className="mt-5 border-t border-border pt-3">
                <p className="mb-2 text-xs text-text-muted">Quellenstellen</p>
                <div className="study-trace-source-list">
                  {sourceLocations(references).map((ref) => {
                    const source = graph.nodes.find(
                      (node) =>
                        node.materialId === ref.materialId &&
                        node.revision === ref.revision,
                    );
                    return (
                      <Button
                        key={`${ref.materialId}:${ref.revision}:${ref.blockId}`}
                        variant="ghost"
                        size="sm"
                        label={`${source?.title || "Quelle"} · ${ref.page ? `S. ${ref.page}` : "Quelle"}`}
                        onPress={() =>
                          onSource({ ...ref, name: source?.title || "Quelle" })
                        }
                      />
                    );
                  })}
                </div>
              </div>
            )}
            {selected.revision && (
              <details className="mt-5 text-xs text-text-muted">
                <summary className="cursor-pointer">Quellenrevision</summary>
                <p className="mt-2 break-all font-mono">{selected.revision}</p>
              </details>
            )}
          </aside>
        )}
      </div>
      <div className="study-trace-footer">
        <span role="status">
          {view.total
            ? `${view.page * pageSize + 1}–${Math.min((view.page + 1) * pageSize, view.total)} von ${view.total} Verknüpfungen`
            : "Keine gespeicherten Verknüpfungen"}
        </span>
        {view.pages > 1 && (
          <div className="flex gap-1">
            <Button
              variant="icon"
              size="sm"
              icon="chevron-left"
              accessibilityLabel="Vorherige Verknüpfungen"
              disabled={view.page === 0}
              onPress={() => {
                setPage(view.page - 1);
                setSelectedId(undefined);
              }}
            />
            <Button
              variant="icon"
              size="sm"
              icon="chevron-right"
              accessibilityLabel="Weitere Verknüpfungen"
              disabled={view.page >= view.pages - 1}
              onPress={() => {
                setPage(view.page + 1);
                setSelectedId(undefined);
              }}
            />
          </div>
        )}
        <details className="study-trace-help">
          <summary aria-label="Was zeigt der Graph?">Info</summary>
          <p>
            Quellenbezüge der aktiven Lernversion, keine
            Vollständigkeitsbewertung. Ohne hinterlegten Kapitelplan können
            erwartete, aber fehlende Kapitel noch nicht erkannt werden. „Nicht
            referenziert“ ist nicht gleich „inhaltlich fehlt“.
          </p>
        </details>
      </div>
      {explorer && (
        <GraphExplorer
          graph={graph}
          noticesOnly={explorer === "notices"}
          onChoose={choose}
          onClose={() => setExplorer(undefined)}
        />
      )}
    </section>
  );
}
