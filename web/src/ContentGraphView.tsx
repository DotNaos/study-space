import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Icon, Input } from "@dotnaos/ui-base";
import { Panel, ReactFlow, useReactFlow, useStore } from "@xyflow/react";
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
  sourceLocations,
  kindLabel,
  type ContentGraph,
} from "./content-graph";

import { groupContentGraph } from "./content-graph-layout";
import { contentGraphNodeTypes, type FlowNode } from "./ContentGraphNodes";

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
  const grouped = useMemo(() => groupContentGraph(graph), [graph]);
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
  const choose = useCallback((id?: string) => {
    setRequestedId(id);
    setExplorer(undefined);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#graph${id ? `/${encodeURIComponent(id)}` : ""}`,
    );
  }, []);
  const relatedIds = useMemo(
    () =>
      new Set(
        graph.edges
          .filter(
            (edge) =>
              edge.source === requestedId || edge.target === requestedId,
          )
          .flatMap((edge) => [edge.source, edge.target]),
      ),
    [graph, requestedId],
  );
  const flowNodes: FlowNode[] = useMemo(
    () => [
      ...grouped.clusters.map((cluster) => ({
        id: cluster.id,
        type: "cluster" as const,
        data: { title: cluster.title },
        position: cluster.position,
        style: { width: cluster.width, height: cluster.height },
        selectable: false,
        focusable: false,
        zIndex: -1,
      })),
      ...grouped.boxes.map((box) => ({
        id: box.id,
        type: "contentGroup" as const,
        parentId: box.clusterId,
        data: { box, selectedId: requestedId, relatedIds, onChoose: choose },
        position: box.position,
        style: { width: box.width, height: box.height },
        initialWidth: box.width,
        initialHeight: box.height,
        selectable: false,
        focusable: false,
        ariaLabel: `${box.title}, ${box.rows.length} Einträge`,
      })),
    ],
    [grouped, requestedId, relatedIds, choose],
  );
  const flowEdges = useMemo(
    () =>
      grouped.bundles.map((bundle) => ({
        id: bundle.id,
        source: bundle.source,
        target: bundle.target,
        type: "default",
        focusable: false,
        selectable: false,
        className: `${bundle.kind === "contains" ? "study-trace-structure-edge" : "study-trace-provenance-edge"}${bundle.relations.some((edge) => edge.source === requestedId || edge.target === requestedId) ? " study-trace-active-edge" : ""}`,
      })),
    [grouped, requestedId],
  );
  const viewKey = useMemo(
    () =>
      grouped.boxes
        .map((box) => `${box.id}:${box.height}:${box.position.y}`)
        .join(","),
    [grouped],
  );
  const noticeCount = graph.nodes.filter((node) => node.notice).length;
  function closeDetails() {
    const element = Array.from(
      canvas.current?.querySelectorAll<HTMLElement>("[data-trace-id]") || [],
    ).find((node) => node.dataset.traceId === requestedId);
    choose();
    element
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
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
                const row = (event.target as HTMLElement).closest<HTMLElement>(
                  "[data-trace-id]",
                );
                if (row?.dataset.traceId) {
                  // React Flow consumes these keys at the node boundary. Keep
                  // the list buttons operable without selecting a whole group.
                  event.preventDefault();
                  event.stopPropagation();
                  if (!event.repeat) choose(row.dataset.traceId);
                }
              }}
            >
              <ReactFlow<FlowNode>
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={contentGraphNodeTypes}
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
                nodesFocusable={false}
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
                  focusId={
                    selected ? grouped.itemToBox.get(selected.id) : undefined
                  }
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
                {relatedIds.size > 1 && (
                  <div className="mt-5 border-t border-border pt-3">
                    <p className="mb-2 text-xs text-text-muted">
                      Verknüpfte Inhalte
                    </p>
                    <div className="study-trace-source-list">
                      {graph.nodes
                        .filter(
                          (item) =>
                            item.id !== selected.id && relatedIds.has(item.id),
                        )
                        .map((item) => (
                          <Button
                            key={item.id}
                            variant="ghost"
                            size="sm"
                            label={`${kindLabel[item.kind]} · ${item.title}`}
                            onPress={() => choose(item.id)}
                          />
                        ))}
                    </div>
                  </div>
                )}
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
              {graph.nodes.length} Einträge · {grouped.boxes.length} Gruppen
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
