import { SourceMappingBoard } from "./SourceMappingBoard";
import type { PipelineUnit } from "./pipeline-api";
import "./preparation-flow.css";
import { PipelineUnits } from "./PipelineUnits";
import { unitLabel } from "./learning-structure";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Checkbox } from "@dotnaos/ui-base";
import { ChevronRight, FileText, Folder } from "lucide-react";
import { api, message } from "./api";
import type { LearningTarget, LearningVersion } from "./learning-api";
import type { SourceSelection } from "./SourceViewer";
import { SafeMarkdown } from "./SafeMarkdown";
import { Loading, Notice } from "./shared";
import { PipelineReview } from "./PipelineReview";
import {
  groupSources,
  isOpen,
  parsePipelineRoute,
  pipelineHash,
  pipelinePath,
  readPipeline,
  roleLabels,
  statusLabels,
  type PipelineRoute,
  type PipelineSourceView,
  type PipelineState,
} from "./pipeline-api";
import "./pipeline.css";
import { PreparationWorkspace } from "./PreparationWorkspace";

export function PipelineView({
  courseId,
  courseName,
  version,
  onSource,
  onOpenLearning,
}: {
  courseId: number;
  courseName: string;
  version?: LearningVersion | null;
  onSource: (source: SourceSelection) => void;
  onOpenLearning: (target: LearningTarget) => void;
}) {
  const [state, setState] = useState<PipelineState>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [route, setRoute] = useState<PipelineRoute>(() =>
    parsePipelineRoute(window.location.hash),
  );
  const [openOnly, setOpenOnly] = useState(false);
  const [pane, setPane] = useState<"source" | "output">("source");
  const navigationGuard = useRef<(() => Promise<boolean>) | null>(null);
  const mappingReturn = useRef<string | undefined>(undefined);
  const registerGuard = useCallback((guard: (() => Promise<boolean>) | null) => { navigationGuard.current = guard; }, []);
  const saveStructure = useCallback(async (units: PipelineUnit[], expectedRevision: number, deletedUnitIds: string[] = []) => {
    const next = await api<PipelineState>(pipelinePath(courseId) + "/structure", {
      method: "PUT", body: JSON.stringify({ units, deletedUnitIds, expectedRevision, actor: "user", reason: "Gliederung automatisch gespeichert: lokale Reihenfolge, Anzeigenamen, Sichtbarkeit und Löschungen." }),
    });
    setState(next);
    return next;
  }, [courseId]);
  const positions = useRef(new Map<string, number>());
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const next = await readPipeline(courseId, signal);
      if (!signal?.aborted) {
        setState(next);
        setError("");
      }
    },
    [courseId],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((error) => {
      if (!controller.signal.aborted) setError(message(error));
    });
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    const follow = () => setRoute(parsePipelineRoute(window.location.hash));
    window.addEventListener("hashchange", follow);
    window.addEventListener("popstate", follow);
    return () => {
      window.removeEventListener("hashchange", follow);
      window.removeEventListener("popstate", follow);
    };
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      window.scrollTo({
        top: positions.current.get(pipelineHash(route)) ?? 0,
        behavior: "instant",
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [route]);
  async function go(next: PipelineRoute) {
    if (navigationGuard.current && !await navigationGuard.current()) return;
    positions.current.set(pipelineHash(route), window.scrollY);
    window.history.pushState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${pipelineHash(next)}`,
    );
    setRoute(next);
    setPane("source");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
  async function change(path: string, method: string, body: object) {
    if (!state || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<PipelineState>(pipelinePath(courseId) + path, {
        method, body: JSON.stringify({ expectedRevision: state.revision, ...body }),
      });
      setState(next);
      return next;
    } catch (error) {
      setError(message(error));
      throw error;
    } finally {
      setBusy(false);
    }
  }
  const item =
    route.kind === "source"
      ? state?.sources.find((item) => item.source.id === route.id)
      : undefined;
  const group =
    route.kind === "group"
      ? state?.groups.find((group) => String(group.id) === route.id)
      : item
        ? state?.groups.find((group) => group.id === item.source.sectionId)
        : undefined;
  const unit =
    route.kind === "unit"
      ? state?.units.find((unit) => unit.id === route.id)
      : undefined;
  function back() {
    go(
      item
        ? mappingReturn.current ? { kind: "mapping-unit", id: mappingReturn.current } : { kind: "mapping" }
        : group?.parentId
          ? { kind: "group", id: String(group.parentId) }
          : unit?.parentId
            ? { kind: "unit", id: unit.parentId }
            : { kind: "overview" },
    );
  }
  function sourceRows(items: PipelineSourceView[]) {
    return (
      <ul className="pipeline-list">
        {items
          .filter((item) => !openOnly || isOpen(item))
          .map((item) => (
            <li key={item.source.id}>
              <button
                className="pipeline-row"
                onClick={() => go({ kind: "source", id: item.source.id })}
              >
                <FileText size={16} aria-hidden="true" />
                <span>
                  <strong>{item.source.name}</strong>
                  <small>
                    {statusLabels[item.status]}
                    {item.unmappedBlocks
                      ? ` · ${item.unmappedBlocks} Quellstellen ungeklärt`
                      : ""}
                    {item.source.acquisition !== "ready"
                      ? " · " +
                        (item.source.acquisition === "not-imported"
                          ? "Noch nicht aufbereitet"
                          : "Erfassung offen")
                      : ""}
                  </small>
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
      </ul>
    );
  }
  function outputs(current: PipelineSourceView) {
    const chapters =
      version?.sections.filter((section) =>
        current.sectionIds.includes(section.id),
      ) ?? [];
    const tasks =
      version?.exercises.filter((exercise) =>
        current.exerciseIds.includes(exercise.id),
      ) ?? [];
    return (
      <div className="pipeline-existing">
        <h3 className="mt-4 mb-2 text-sm font-semibold">Bestehende Ergebnisse</h3>
        <p className="pipeline-muted">
          Quellenbezüge der aktiven Lernversion – keine Bestätigung dieses
          Plans.
        </p>
        {!!current.unmappedBlocks && (
          <Notice>
            {current.unmappedBlocks} erfasste Quellstellen haben in dieser
            Lernversion keinen Ergebnisverweis. Prüfe sie im Quellenvergleich.
          </Notice>
        )}
        {chapters.map((section) => (
          <Button
            key={section.id}
            size="sm"
            variant="ghost"
            label={section.title}
            onPress={() =>
              onOpenLearning({
                kind: "chapter",
                id: section.id,
                mode: "comparison",
              })
            }
          />
        ))}
        {tasks.map((task) => (
          <Button
            key={task.id}
            size="sm"
            variant="ghost"
            label={task.title}
            onPress={() => onOpenLearning({ kind: "exercise", id: task.id })}
          />
        ))}
        {!chapters.length && !tasks.length && (
          <p className="pipeline-muted">
            Noch kein Ergebnis mit Quellenbezug. Das ist nicht automatisch ein
            Verarbeitungsfehler.
          </p>
        )}
      </div>
    );
  }
  const currentMappingRoot = route.kind === "mapping-unit" ? route.id : undefined;
  const combinedPreparation = route.kind === "overview" || route.kind === "structure" || route.kind === "content";
  const groups =
    state?.groups.filter(
      (candidate) =>
        candidate.parentId ===
        (route.kind === "group" ? Number(route.id) : null),
    ) ?? [];
  return (
    <section className="pipeline-view min-w-0 pt-4" aria-label="Kursaufbereitung">
      {!combinedPreparation && route.kind !== "mapping" && route.kind !== "mapping-unit" && <div className="pipeline-toolbar">
        <div className="pipeline-breadcrumb">
          <Button
            variant="ghost"
            size="sm"
            icon="arrow-left"
            label="Zurück"
            onPress={back}
          />
          <span>{item?.source.name ?? group?.title ?? (unit ? unitLabel(unit) : undefined) ?? "Struktur"}</span>
        </div>
        <div className="pipeline-inline-actions">
          <Button
            variant="icon"
            size="sm"
            icon="refresh"
            accessibilityLabel="Quellenbestand aktualisieren"
            disabled={busy || !state}
            onPress={() => void change("/sync", "POST", {}).catch(() => {})}
          />

        </div>
      </div>}
      {error && (
        <>
          <Notice>{error}</Notice>
          <Button
            size="sm"
            variant="ghost"
            label="Aktuellen Stand laden"
            onPress={() =>
              void load().catch((error) => setError(message(error)))
            }
          />
        </>
      )}
      {state?.problem && <Notice>{state.problem}</Notice>}
      {!state ? (
        !error && <Loading label="Quellenstruktur wird gelesen …" />
      ) : combinedPreparation ? (
        <PreparationWorkspace
          courseId={courseId}
          courseName={courseName}
          state={state}
          busy={busy}
          onSave={saveStructure}
          onState={setState}
          onFocus={()=>void go({kind:"mapping"})}
          onGuard={registerGuard}
          onRefresh={() => change("/sync", "POST", {})}
        />
      ) : route.kind === "mapping" || route.kind === "mapping-unit" ? (
        <>
          <div className="prepare-focus-toolbar"><Button size="sm" variant="ghost" icon="arrow-left" label="Verschachtelt" onPress={()=>void go({kind:"structure"})}/></div>
          <SourceMappingBoard
            courseId={courseId}
            state={state}
            rootId={currentMappingRoot}
            onState={setState}
            onOpenRoot={id => void go({kind:"mapping-unit",id})}
            onOverview={()=>void go({kind:"mapping"})}
            onOpenSource={source => { mappingReturn.current = currentMappingRoot; void go({kind:"source",id:source.source.id}); }}
            onCreate={()=>void go({kind:"content"})}
          />
        </>
      ) : (
        <>
          <div
            className="pipeline-mobile-switch"
            role="group"
            aria-label="Vergleichsseite"
          >
            <Button
              size="sm"
              variant="ghost"
              label="Quelle"
              pressed={pane === "source"}
              onPress={() => setPane("source")}
            />
            <Button
              size="sm"
              variant="ghost"
              label={item ? "Zuordnung" : "Lernstruktur"}
              pressed={pane === "output"}
              onPress={() => setPane("output")}
            />
          </div>
          {item && pane === "source" && <div className="prepare-mobile-next"><Button label="Zuordnen" iconAfter="arrow-right" onPress={()=>setPane("output")}/></div>}
          <div className="pipeline-split" data-pane={pane}>
            <div className="pipeline-source-pane">
              {item ? (
                <>
                  <h2 className="mb-4 text-base font-semibold">{item.source.name}</h2>
                  <p className="pipeline-muted">
                    {group?.title} · {item.source.kind}
                    {item.source.mimeType ? " · " + item.source.mimeType : ""}
                  </p>
                  {item.source.materialRevision ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="file-text"
                      label="Gespeichertes Original öffnen"
                      onPress={() =>
                        onSource({
                          materialId: item.source.id,
                          revision: item.source.materialRevision!,
                          name: item.source.name,
                        })
                      }
                    />
                  ) : (
                    item.source.studyUrl && (
                      <a
                        className="pipeline-original-link"
                        href={item.source.studyUrl}
                      >
                        Quelle in Study Space öffnen
                      </a>
                    )
                  )}
                  {item.source.problem && (
                    <Notice>{item.source.problem}</Notice>
                  )}
                  {item.source.warnings.map((warning, index) => (
                    <p key={index} className="pipeline-muted">
                      {warning}
                    </p>
                  ))}
                  {item.source.text && (
                    <div className="pipeline-source-text">
                      <h3 className="mt-4 mb-2 text-sm font-semibold">Quelltext</h3>
                      <SafeMarkdown>{item.source.text}</SafeMarkdown>
                    </div>
                  )}
                  {!item.source.text && !item.source.materialRevision && (
                    <p className="pipeline-muted">
                      Bisher nur Metadaten. Ohne Originalprüfung lässt sich
                      keine inhaltliche Vollständigkeit bestätigen.
                    </p>
                  )}
                  {outputs(item)}
                </>
              ) : (
                <>
                  <h2 className="mb-4 text-base font-semibold">{unit ? "Zugeordnete Quellen" : "Quellenbestand"}</h2>
                  <Checkbox
                    checked={openOnly}
                    onCheckedChange={setOpenOnly}
                    label="Nur offene Einordnungen"
                  />
                  {!unit && (
                    <ul className="pipeline-list">
                      {groups.map((group) => {
                        const sources = groupSources(state, group.id, true);
                        const open = sources.filter(isOpen).length;
                        return (
                          <li key={group.id}>
                            <button
                              className="pipeline-row"
                              onClick={() =>
                                go({ kind: "group", id: String(group.id) })
                              }
                            >
                              <Folder size={16} aria-hidden="true" />
                              <span>
                                <strong>{group.title}</strong>
                                <small>
                                  {sources.length} Quellen
                                  {open ? ` · ${open} offen` : ""}
                                  {!sources.length
                                    ? " · keine Quellen geliefert"
                                    : ""}
                                </small>
                              </span>
                              <ChevronRight size={16} aria-hidden="true" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {route.kind === "group" &&
                    sourceRows(groupSources(state, Number(route.id)))}
                  {unit &&
                    sourceRows(
                      state.sources.filter((item) =>
                        item.decision?.uses.some(
                          (use) => use.unitId === unit.id,
                        ),
                      ),
                    )}

                </>
              )}
            </div>
            <div className="pipeline-output-pane">
              {item ? (
                <PipelineReview
                  key={
                    item.source.id +
                    item.source.sourceVersion +
                    (item.decision?.decidedAt ?? "")
                  }
                  state={state}
                  item={item}
                  busy={busy}
                  onSave={async (body) => {
                    try {
                      const next = await change("/decisions", "POST", {
                        ...body,
                        sourceId: item.source.id,
                        sourceVersion: item.source.sourceVersion,
                        actor: "user",
                      });
                      if (next && mappingReturn.current) await go({kind:"mapping-unit",id:mappingReturn.current});
                    } catch {
                      /* Error shown above; leave the draft intact. */
                    }
                  }}
                />
              ) : (
                <>
                  <h2 className="mb-4 text-base font-semibold">{(unit ? unitLabel(unit) : undefined) ?? "Bestätigte Lernstruktur"}</h2>
                  {!state.units.length ? (
                    <>
                      <p className="pipeline-muted">
                        Noch keine Gliederung bestätigt. Moodle-Abschnitte
                        können Wochen, Themen oder Ablagen sein.
                      </p>
                      <Button
                        variant="secondary"
                        label="Gliederung prüfen"
                        onPress={() => go({ kind: "structure" })}
                      />
                    </>
                  ) : (
                    <PipelineUnits state={state} unit={unit} onOpen={id => go({kind:"unit",id})} onEdit={() => go({kind:"structure"})} />
                  )}
                  {unit && (
                    <ul className="pipeline-list">
                      {state.sources
                        .filter((item) =>
                          item.decision?.uses.some(
                            (use) => use.unitId === unit.id,
                          ),
                        )
                        .map((item) => (
                          <li key={item.source.id}>
                            <button
                              className="pipeline-row"
                              onClick={() =>
                                go({ kind: "source", id: item.source.id })
                              }
                            >
                              <span>
                                <strong>{item.source.name}</strong>
                                <small>
                                  {item
                                    .decision!.uses.filter(
                                      (use) => use.unitId === unit.id,
                                    )
                                    .map((use) => roleLabels[use.role])
                                    .join(" · ")}{" "}
                                  · {statusLabels[item.status]}
                                </small>
                              </span>
                              <ChevronRight size={16} aria-hidden="true" />
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                  {state.unattributedSections.length > 0 && (
                    <details>
                      <summary>
                        Skript ohne Quellenbezug (
                        {state.unattributedSections.length})
                      </summary>
                      {version?.sections
                        .filter((section) =>
                          state.unattributedSections.includes(section.id),
                        )
                        .map((section) => (
                          <Button
                            key={section.id}
                            variant="ghost"
                            size="sm"
                            label={section.title}
                            onPress={() =>
                              onOpenLearning({
                                kind: "chapter",
                                id: section.id,
                                mode: "comparison",
                              })
                            }
                          />
                        ))}
                    </details>
                  )}
                  <p className="pipeline-muted">
                    {state.pending} Einordnungen offen. Eine bestätigte
                    Verwendung bedeutet noch keine geprüfte Inhaltsabdeckung.
                  </p>
                </>
              )}
            </div>
          </div>
          {!!state.history.length && (
            <details className="pipeline-history">
              <summary>Entscheidungsverlauf</summary>
              <ol>
                {state.history
                  .slice(-30)
                  .reverse()
                  .map((event) => (
                    <li key={event.revision}>
                      <strong>
                        #{event.revision} · {event.actor}
                      </strong>
                      <span>
                        {event.reason.split("\nVorherige Struktur:")[0]}
                      </span>
                      <small>
                        {new Date(event.at).toLocaleString("de-CH")}
                      </small>
                    </li>
                  ))}
              </ol>
              <p className="pipeline-muted">
                Die letzten 30 Entscheidungen; der vollständige Verlauf bleibt
                über die API erhalten.
              </p>
            </details>
          )}
        </>
      )}

    </section>
  );
}
