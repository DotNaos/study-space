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
  layoutContentGraph,
  sourceLocations,
  kindLabel,
  type ContentGraph,
  type TraceNode,
} from "./content-graph";

type FlowNode = Node<{ item: TraceNode }, "content">;
const ContentNode = memo(function ContentNode({
  data,
  selected,
}: NodeProps<FlowNode>) {
  const item = data.item;
  return (
    <div className={`study-trace-node${selected ? " is-selected" : ""}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <Icon
        name={
          item.kind === "section"
            ? "folder-open"
            : item.kind === "activity"
              ? "app-window"
              : item.kind === "chapter"
                ? "list"
                : item.kind === "exercise"
                  ? "pencil-line"
                  : "file-text"
        }
        size="m"
      />
      <div className="study-trace-node-label">
        <span>{item.title}</span>
        <small>
          {item.kind === "material" ? "Materialstand" : item.subtitle}
        </small>
      </div>
      {item.notice && (
        <span className="study-trace-warning" title={item.notice}>
          <Icon name="alert-triangle" size="s" />
          <span className="sr-only">{item.notice}</span>
        </span>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
});
const nodeTypes = { content: ContentNode };

function ViewControls({
  viewKey,
  focusId,
  onOverview,
}: {
  viewKey: string;
  focusId?: string;
  onOverview: () => void;
}) {
  const flow = useReactFlow();
  // Live inventory and saved learning data settle independently. Fit the actual
  // measured bounds, not a previous frame's layout with the same node count.
  const boundsKey = useStore((state) => {
    let right = 0,
      bottom = 0;
    for (const node of state.nodeLookup.values()) {
      right = Math.max(
        right,
        node.internals.positionAbsolute.x + (node.measured.width || 0),
      );
      bottom = Math.max(
        bottom,
        node.internals.positionAbsolute.y + (node.measured.height || 0),
      );
    }
    return `${state.nodeLookup.size}:${right}:${bottom}`;
  });
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  useEffect(() => {
    if (!flow.viewportInitialized || !width || !height) return;
    void flow.fitView({
      nodes: focusId ? [{ id: focusId }] : undefined,
      padding: 0.12,
      minZoom: 0.025,
      maxZoom: focusId ? 1 : 0.8,
    });
  }, [flow, boundsKey, viewKey, focusId, width, height]);
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
          accessibilityLabel="Gesamten Kurs anzeigen"
          onPress={() => {
            onOverview();
            void flow.fitView({ padding: 0.12, minZoom: 0.025, maxZoom: 0.8 });
          }}
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
      title={noticesOnly ? "Offene Bezüge & Hinweise" : "Kurs durchsuchen"}
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
              label={`${kindLabel[node.kind]} · ${node.title}${node.notice ? ` · ${node.notice}` : ""}`}
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
  sectionsError,
  sectionsLoading = false,
  moodleConnected = true,
  onRefresh,
  onSource,
  onOpenLearning,
  onOpenActivity,
}: {
  learning: LearningCourse;
  materials: MaterialState;
  sections?: CourseSection[];
  sectionsError?: string;
  sectionsLoading?: boolean;
  moodleConnected?: boolean;
  onRefresh: () => void;
  onSource: (source: SourceSelection) => void;
  onOpenLearning: (target: LearningTarget) => void;
  onOpenActivity: (moduleId: number, resourceId?: string | null) => void;
}) {
  const version = learning.state?.activeVersion;
  const graph = useMemo(
    () => buildContentGraph(materials.snapshot, version, sections),
    [materials.snapshot, version, sections],
  );
  const positions = useMemo(() => layoutContentGraph(graph), [graph]);
  const [requestedId, setRequestedId] = useState(() =>
    typeof window === "undefined"
      ? undefined
      : graphFocusFromHash(window.location.hash),
  );
  const [explorer, setExplorer] = useState<"all" | "notices">();
  const canvas = useRef<HTMLDivElement>(null);
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
  useEffect(() => {
    const changed = () =>
      setRequestedId(graphFocusFromHash(window.location.hash));
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  const selected = graph.nodes.find((node) => node.id === requestedId);
  const flowNodes: FlowNode[] = useMemo(
    () =>
      graph.nodes.map((node) => ({
        id: node.id,
        type: "content",
        initialWidth: 252,
        initialHeight: 64,
        data: { item: node },
        position: positions.get(node.id)!,
        selected: node.id === requestedId,
        ariaLabel: `${kindLabel[node.kind]}: ${node.title}${node.notice ? `. ${node.notice}` : ""}. Details mit Enter öffnen.`,
      })),
    [graph, positions, requestedId],
  );
  const flowEdges = useMemo(
    () =>
      graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "default",
        focusable: false,
        className: `${edge.kind === "contains" ? "study-trace-structure-edge" : "study-trace-provenance-edge"}${edge.source === requestedId || edge.target === requestedId ? " study-trace-active-edge" : ""}`,
      })),
    [graph, requestedId],
  );
  const viewKey = useMemo(
    () => graph.nodes.map((node) => node.id).join(","),
    [graph],
  );
  const noticeCount = graph.nodes.filter((node) => node.notice).length;
  function choose(id?: string) {
    setRequestedId(id);
    setExplorer(undefined);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#graph${id ? `/${encodeURIComponent(id)}` : ""}`,
    );
  }
  function closeDetails() {
    const element = Array.from(
      canvas.current?.querySelectorAll<HTMLElement>(".react-flow__node") || [],
    ).find((node) => node.dataset.id === requestedId);
    choose();
    element?.focus({ preventScroll: true });
  }
  const loading =
    sectionsLoading ||
    learning.loading ||
    (!materials.snapshot && !materials.error);
  const references = sourceLocations(
    graph.edges
      .filter(
        (edge) => edge.kind === "provenance" && edge.target === selected?.id,
      )
      .flatMap((edge) => edge.references),
  );
  const selectedSourceRefs = graph.edges
    .filter(
      (edge) => edge.kind === "provenance" && edge.source === selected?.id,
    )
    .flatMap((edge) => edge.references);
  return (
    <section
      className="study-content-graph"
      aria-label="Quellen- und Inhaltsgraph"
    >
      <div className="study-trace-toolbar">
        <Button
          variant="ghost"
          size="sm"
          icon="search"
          label="Kurs durchsuchen"
          accessibilityLabel="Kurs durchsuchen"
          onPress={() => setExplorer("all")}
        />
        <div className="flex items-center gap-1">
          {!!noticeCount && (
            <Button
              variant="ghost"
              size="sm"
              icon="alert-triangle"
              label={`${noticeCount} Hinweise`}
              accessibilityLabel={`${noticeCount} offene Bezüge und Hinweise anzeigen`}
              onPress={() => setExplorer("notices")}
            />
          )}
          <Button
            variant="icon"
            size="sm"
            icon="refresh"
            accessibilityLabel="Kursgraph aktualisieren"
            onPress={() => {
              onRefresh();
              void learning.refresh().catch(() => {});
              void materials.refresh().catch(() => {});
            }}
          />
        </div>
      </div>
      {(sectionsError || !moodleConnected) && (
        <p role="status" className="mb-3 text-xs text-text-muted">
          {sectionsError
            ? `Moodle-Kursstruktur nicht geladen: ${sectionsError}`
            : "Moodle ist nicht verbunden."}{" "}
          Der Graph zeigt nur die verfügbaren gespeicherten Daten, nicht den
          vollständigen aktuellen Kurs.
        </p>
      )}
      {(learning.error || materials.error) && (
        <div className="mb-3">
          <Notice>
            {learning.error || materials.error} Verfügbare Moodle-Inhalte
            bleiben sichtbar.
          </Notice>
        </div>
      )}
      {loading && (
        <div className="mb-3">
          <Loading label="Kursgraph wird geladen …" />
        </div>
      )}
      {requestedId && !selected && !loading && (
        <p role="status" className="mb-3 text-xs text-text-muted">
          Dieser Verweis ist im verfügbaren Kursstand nicht enthalten. Die
          Gesamtübersicht bleibt sichtbar.
        </p>
      )}
      {!graph.nodes.length ? (
        !loading && (
          <p className="py-6 text-sm text-text-muted">
            Für diesen Kurs sind noch keine Inhalte verfügbar.
          </p>
        )
      ) : (
        <>
          <div
            className={`study-trace-workspace${selected ? " has-details" : ""}`}
          >
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
                  choose(node.dataset.id);
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
                minZoom={0.025}
                maxZoom={1.5}
                onNodeClick={(_, node) => choose(node.id)}
                onPaneClick={() => choose()}
                ariaLabelConfig={{
                  "node.a11yDescription.default":
                    "Mit Tab zwischen Inhalten wechseln. Enter öffnet die Details. Alle Kursinhalte bleiben im Graph.",
                  "controls.fitView.ariaLabel": "Gesamten Kurs anzeigen",
                }}
              >
                <Panel position="top-left">
                  <span className="study-trace-caption">
                    Moodle → Quellen → Kapitel & Aufgaben
                  </span>
                </Panel>
                <ViewControls
                  viewKey={viewKey}
                  focusId={selected?.id}
                  onOverview={() => choose()}
                />
              </ReactFlow>
            </div>
            {selected && (
              <aside
                className="study-trace-inspector"
                aria-label="Inhaltsdetails"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-text-muted">
                      {kindLabel[selected.kind]}
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
                {(selected.notice || selected.kind === "resource") && (
                  <p className="mt-3 whitespace-pre-line text-xs leading-5 text-text-muted">
                    {selected.reason}
                  </p>
                )}
                {!!selected.description && (
                  <p className="mt-3 whitespace-pre-line text-xs leading-5 text-text-muted">
                    {selected.description}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-1">
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
                  {selected.moduleId &&
                    (selected.kind === "activity" ||
                      selected.kind === "resource" ||
                      (selected.kind === "material" && !selected.revision)) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        label={
                          selected.kind === "resource"
                            ? "Ressource öffnen"
                            : "Aktivität öffnen"
                        }
                        disabled={!moodleConnected}
                        onPress={() =>
                          onOpenActivity(
                            selected.moduleId!,
                            selected.resource?.id,
                          )
                        }
                      />
                    )}
                  {(selected.kind === "chapter" ||
                    selected.kind === "exercise") &&
                    selected.contentId && (
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
                    <p className="mb-2 text-xs text-text-muted">
                      Quellenstellen
                    </p>
                    <div className="study-trace-source-list">
                      {references.map((ref) => {
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
                              onSource({
                                ...ref,
                                name: source?.title || "Quelle",
                              })
                            }
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
                {selected.revision && (
                  <details className="mt-5 text-xs text-text-muted">
                    <summary className="cursor-pointer">
                      Quellenrevision
                    </summary>
                    <p className="mt-2 break-all font-mono">
                      {selected.revision}
                    </p>
                  </details>
                )}
              </aside>
            )}
          </div>
          <div className="study-trace-footer">
            <span role="status">
              {sections
                ? `${sections.length} Moodle-Abschnitte · ${sections.reduce((count, section) => count + section.modules.length, 0)} Aktivitäten · `
                : ""}
              {graph.nodes.length} Knoten
            </span>
            <details className="study-trace-help">
              <summary aria-label="Was zeigt der Graph?">Info</summary>
              <p>
                Alle von Moodle gelieferten Abschnitte, Aktivitäten und
                Ressourcen sowie gespeicherte Quellen, Kapitel und Aufgaben.
                Auswahl und Suche bewegen nur die Ansicht; sie entfernen keine
                Knoten. Gestrichelte Linien zeigen Zugehörigkeit, durchgezogene
                Linien gespeicherte Quellenbezüge – keine
                Vollständigkeitsbewertung. Inhalte innerhalb nicht abrufbarer
                Aktivitäten und erwartete, nie erstellte Kapitel sind damit noch
                nicht erfasst.
              </p>
            </details>
          </div>
        </>
      )}
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
