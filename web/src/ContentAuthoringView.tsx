import "./content-authoring.css";
import "./content-authoring-workspace.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Icon } from "@dotnaos/ui-base";
import { MarkdownEditor, MarkdownRenderer } from "@dotnaos/ui/markdown-editor";
import { PdfViewer } from "@dotnaos/ui/pdf-viewer";
import { Composer, type AiOption } from "./ui-ai";
import { AlertTriangle, Check, Code2, Columns2, FileDiff, FileText, PencilLine, Rows3 } from "lucide-react";
import { message } from "./api";
import type { PipelineState } from "./pipeline-api";
import { unitHidden, unitKind, unitLabel } from "./learning-structure";
import { buildContentOutline, type ContentUnitNode } from "./content-authoring-model";
import { sourcePlacement } from "./source-placement";
import { TextDiff, type TextDiffMode } from "./TextDiff";
import {
  materializeContent,
  originalMaterialUrl,
  readContentBlock,
  readContentRevision,
  readContentWorkspace,
  resetContentBlock,
  runContentAgent,
  saveContentBlock,
  undoContentBlock,
  type ContentBlockSummary,
  type ContentBlockView,
  type ContentRevision,
  type ContentWorkspace,
} from "./content-api";
import { Loading, Notice } from "./shared";
import { buildChatGptHandoffPrompt, buildChatGptHandoffUrl } from "./chatgpt-handoff";

export type ContentSelection =
  | { kind: "script" }
  | { kind: "unit"; id: string }
  | { kind: "source"; id: string; unitId?: string };

export type ContentTocItem = { id: string; label: string; level: number };

type ContentTab = "content" | "pdf-current" | "edited-raw" | "raw";

function statusLabel(block: ContentBlockSummary) {
  if (block.stale) return "Quelle aktualisiert";
  if (block.status === "not-ready") return "Quelle noch nicht aufbereitet";
  if (block.status === "unmaterialized") return "Rohfassung fehlt";
  return "bereit";
}

function sourcePages(block: ContentBlockSummary) {
  const pages = block.placements.flatMap(placement => [placement.firstPage, placement.lastPage]).filter((page): page is number => page != null);
  if (!pages.length) return undefined;
  const first = Math.min(...pages), last = Math.max(...pages);
  return first === last ? `S. ${first}` : `S. ${first}–${last}`;
}

function findNode(nodes: ContentUnitNode[], id: string): ContentUnitNode | undefined {
  for (const node of nodes) {
    if (node.unit.id === id) return node;
    const child = findNode(node.children, id);
    if (child) return child;
  }
  return undefined;
}

function ProvenancePreview({
  content,
  view,
  activePage,
  onHoverPage,
  onPinPage,
}: {
  content: string;
  view: ContentBlockView;
  activePage?: number;
  onHoverPage: (page?: number) => void;
  onPinPage: (page: number) => void;
}) {
  const provenance = view.revision?.provenance ?? [];
  const trustworthy = view.revision?.provenanceStatus === "current" && provenance.length > 0;
  if (!trustworthy) return <MarkdownRenderer value={content}/>;

  const ranges = provenance
    .filter(item => item.length > 0 && item.start >= 0 && item.start < content.length)
    .map(item => ({ ...item, end: Math.min(content.length, item.start + item.length), page: item.page ?? item.slide }))
    .filter(item => item.end > item.start)
    .sort((left, right) => left.start - right.start);
  if (!ranges.length) return <MarkdownRenderer value={content}/>;

  const parts: Array<{ key: string; text: string; page?: number }> = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) parts.push({ key: `gap-${cursor}`, text: content.slice(cursor, range.start) });
    if (range.start < cursor) continue;
    parts.push({ key: range.sourceBlockId, text: content.slice(range.start, range.end), page: range.page ?? undefined });
    cursor = range.end;
  }
  if (cursor < content.length) parts.push({ key: `gap-${cursor}`, text: content.slice(cursor) });

  return <div className="content-provenance-preview">
    {parts.map(part => part.page ? <div
      key={part.key}
      className="content-provenance-hunk"
      data-source-page={part.page}
      data-active={activePage === part.page || undefined}
      onMouseEnter={() => onHoverPage(part.page)}
      onMouseLeave={() => onHoverPage(undefined)}
      onClick={() => onPinPage(part.page!)}
      title={`Original: Seite ${part.page}`}
    ><MarkdownRenderer value={part.text}/></div> : <MarkdownRenderer key={part.key} value={part.text}/>)}
  </div>;
}

export function ContentAuthoringView({
  courseId,
  courseName,
  pipeline,
  selection,
  editing,
  onSelectSource,
  onTocChange,
}: {
  courseId: number;
  courseName: string;
  pipeline: PipelineState;
  selection: ContentSelection;
  editing: boolean;
  onSelectSource: (id: string, unitId?: string) => void;
  onTocChange?: (items: ContentTocItem[]) => void;
}) {
  const [workspace, setWorkspace] = useState<ContentWorkspace>();
  const [views, setViews] = useState<Record<string, ContentBlockView>>({});
  const [rawRevisions, setRawRevisions] = useState<Record<string, ContentRevision>>({});
  const [rawLoading, setRawLoading] = useState<string>();
  const [tab, setTab] = useState<ContentTab>("content");
  const [comparePane, setComparePane] = useState<"left" | "right">("left");
  const [diffMode, setDiffMode] = useState<TextDiffMode>("split");
  const [draft, setDraft] = useState("");
  const [savedDraft, setSavedDraft] = useState("");
  const [draftBlockId, setDraftBlockId] = useState<string>();
  const [draftRevisionId, setDraftRevisionId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [aiProvider, setAiProvider] = useState<"codex" | "chatgpt">("codex");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState("");
  const [selectionText, setSelectionText] = useState("");
  const [sourcePage, setSourcePage] = useState<number>();
  const [hoveredSourcePage, setHoveredSourcePage] = useState<number>();
  const activeBlockRef = useRef<HTMLDivElement>(null);
  const readingRootRef = useRef<HTMLDivElement>(null);

  const selected = selection.kind === "source" ? selection.id : undefined;

  const hydrate = useCallback(async (workspace: ContentWorkspace, signal?: AbortSignal) => {
    const available = workspace.blocks.filter(block => block.currentRevisionId);
    const loaded = await Promise.all(available.map(async block => {
      try { return [block.id, await readContentBlock(courseId, block.id, signal)] as const; }
      catch { return undefined; }
    }));
    if (!signal?.aborted) setViews(current => ({ ...current, ...Object.fromEntries(loaded.filter((item): item is readonly [string, ContentBlockView] => !!item)) }));
  }, [courseId]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const next = await readContentWorkspace(courseId, signal);
      if (!signal?.aborted) { setWorkspace(next); setError(""); void hydrate(next, signal); }
    } catch (error) {
      if (!signal?.aborted) setError(message(error));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [courseId, hydrate]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!selected) { setSelectionText(""); return; }
    const update = () => {
      const selectedText = window.getSelection();
      const root = activeBlockRef.current;
      if (!selectedText || selectedText.isCollapsed || !root || !selectedText.anchorNode || !selectedText.focusNode ||
          !root.contains(selectedText.anchorNode) || !root.contains(selectedText.focusNode)) {
        setSelectionText("");
        return;
      }
      setSelectionText(selectedText.toString().trim().slice(0, 8000));
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [selected]);

  const blocks = useMemo(() => (workspace?.blocks ?? []).filter(block => block.included), [workspace]);
  const outline = useMemo(() => buildContentOutline(blocks, pipeline.units), [blocks, pipeline.units]);
  const selectedSummary = selected ? blocks.find(block => block.id === selected) : undefined;
  const selectedView = selected ? views[selected] : undefined;
  const rawRevision = selected ? rawRevisions[selected] : undefined;
  const originalUrl = selectedSummary ? originalMaterialUrl(selectedSummary) : undefined;
  const isPdf = selectedSummary?.mimeType === "application/pdf" && !!originalUrl;
  const activeSourcePage = hoveredSourcePage ?? sourcePage;
  const selectedPlacement = selectedSummary?.placements[0];
  const selectedUnit = selectedPlacement ? pipeline.units.find(unit => unit.id === selectedPlacement.unitId) : undefined;
  const draftReady = !!selected && draftBlockId === selected && !!draftRevisionId;

  const ensureRawRevision = useCallback(async (blockId: string, revision: ContentRevision) => {
    if (rawRevisions[blockId]) return;
    setRawLoading(blockId);
    try {
      let cursor = revision;
      const seen = new Set<string>();
      while (cursor.parentRevisionId && !["materialized", "reset"].includes(cursor.kind) && !seen.has(cursor.id)) {
        seen.add(cursor.id);
        cursor = await readContentRevision(courseId, blockId, cursor.parentRevisionId);
      }
      setRawRevisions(current => ({ ...current, [blockId]: cursor }));
    } catch (error) {
      setError(message(error));
    } finally {
      setRawLoading(current => current === blockId ? undefined : current);
    }
  }, [courseId, rawRevisions]);

  useEffect(() => {
    setTab("content");
    setComparePane("left");
    setAiStatus("");
    setSelectionText("");
    setHoveredSourcePage(undefined);
    setDraft("");
    setSavedDraft("");
    setDraftBlockId(undefined);
    setDraftRevisionId(undefined);
    setSourcePage(undefined);
  }, [selected]);

  useEffect(() => {
    if (!selected || !selectedSummary?.currentRevisionId) return;
    const currentRevisionId = selectedSummary.currentRevisionId;
    const cached = selectedView;

    const hydrateDraft = (view: ContentBlockView) => {
      const revision = view.revision;
      if (!revision) return;
      const sameBlock = draftBlockId === selected;
      if (sameBlock && draft !== savedDraft && draftRevisionId !== revision.id) {
        setError("Der Inhalt wurde außerhalb dieses Editors geändert. Deine lokale Änderung wurde nicht automatisch überschrieben.");
        return;
      }
      const content = revision.content ?? "";
      setDraft(content);
      setSavedDraft(content);
      setDraftBlockId(selected);
      setDraftRevisionId(revision.id);
      setSourcePage(selectedSummary.placements[0]?.firstPage ?? revision.provenance.find(item => item.page != null)?.page ?? revision.provenance.find(item => item.slide != null)?.slide ?? undefined);
      void ensureRawRevision(selected, revision);
    };

    if (cached?.revision?.id === currentRevisionId) {
      if (draftBlockId !== selected || draftRevisionId !== currentRevisionId) hydrateDraft(cached);
      return;
    }

    const controller = new AbortController();
    void readContentBlock(courseId, selected, controller.signal).then(view => {
      if (controller.signal.aborted) return;
      setViews(current => ({ ...current, [selected]: view }));
      hydrateDraft(view);
    }).catch(error => {
      if (!controller.signal.aborted) setError(message(error));
    });
    return () => controller.abort();
  }, [courseId, selected, selectedSummary?.currentRevisionId, selectedView?.revision?.id]);

  useEffect(() => {
    if (!selected || !selectedView?.revision || rawRevisions[selected]) return;
    void ensureRawRevision(selected, selectedView.revision);
  }, [ensureRawRevision, rawRevisions, selected, selectedView?.revision]);

  const contentCandidateCount = useMemo(() => pipeline.sources.filter(item => {
    if (!item.source.present) return false;
    const placement = sourcePlacement(pipeline, item);
    const unit = placement.currentUnitId ? pipeline.units.find(candidate => candidate.id === placement.currentUnitId) : undefined;
    return !placement.hidden && !!unit && !unitHidden(unit, pipeline.units);
  }).length, [pipeline]);
  const canMaterialize = contentCandidateCount > 0 || blocks.length > 0;

  async function refresh() {
    if (busy) return;
    if (!canMaterialize) {
      setError(pipeline.pending > 0
        ? `${pipeline.pending} Quellen sind noch offen. Ordne sie unter Quellen zu oder blende sie aus.`
        : "Keine sichtbare Quelle ist einem sichtbaren Struktur-Eintrag zugeordnet.");
      return;
    }
    setBusy(true); setError("");
    try {
      const next = await materializeContent(courseId, pipeline.revision);
      setWorkspace(next);
      await hydrate(next);
      if (selected && next.blocks.some(block => block.id === selected && block.currentRevisionId)) {
        const view = await readContentBlock(courseId, selected);
        setViews(current => ({ ...current, [selected]: view }));
        const content = view.revision?.content ?? "";
        setDraft(content); setSavedDraft(content);
        setDraftBlockId(selected); setDraftRevisionId(view.revision?.id);
        setRawRevisions(current => { const nextRaw = { ...current }; delete nextRaw[selected]; return nextRaw; });
        if (view.revision) void ensureRawRevision(selected, view.revision);
      }
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }

  async function save() {
    const revisionId = selectedView?.revision?.id;
    if (!selected || !revisionId || draft === savedDraft || saving) return true;
    if (draftBlockId !== selected || !draftRevisionId || draftRevisionId !== revisionId) {
      setError("Die bearbeitete Fassung basiert nicht mehr auf der aktuellen Revision. Lade den Block neu, bevor du speicherst.");
      return false;
    }
    setSaving(true); setError("");
    try {
      const next = await saveContentBlock(courseId, selected, draftRevisionId, draft);
      setViews(current => ({ ...current, [selected]: next }));
      setSavedDraft(next.revision?.content ?? draft);
      setDraftBlockId(selected);
      setDraftRevisionId(next.revision?.id ?? draftRevisionId);
      setWorkspace(current => current ? { ...current, blocks: current.blocks.map(block => block.id === selected ? next.block : block) } : current);
      return true;
    } catch (error) { setError(message(error)); return false; }
    finally { setSaving(false); }
  }

  useEffect(() => {
    if (!editing || !selected || draftBlockId !== selected || !draftRevisionId || draftRevisionId !== selectedView?.revision?.id || draft === savedDraft || saving) return;
    const timer = window.setTimeout(() => { void save(); }, 700);
    return () => window.clearTimeout(timer);
  }, [draft, draftBlockId, draftRevisionId, editing, savedDraft, saving, selected, selectedView?.revision?.id]);

  async function reset() {
    const revisionId = selectedView?.revision?.id;
    if (!selected || !revisionId || busy) return;
    setBusy(true); setError("");
    try {
      const next = await resetContentBlock(courseId, selected, revisionId);
      setViews(current => ({ ...current, [selected]: next }));
      setDraft(next.revision?.content ?? ""); setSavedDraft(next.revision?.content ?? "");
      setDraftBlockId(selected); setDraftRevisionId(next.revision?.id);
      setRawRevisions(current => next.revision ? ({ ...current, [selected]: next.revision }) : current);
      setWorkspace(current => current ? { ...current, blocks: current.blocks.map(block => block.id === selected ? next.block : block) } : current);
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }

  async function undo() {
    const revisionId = selectedView?.revision?.id;
    if (!selected || !revisionId || busy || saving || aiBusy) return;
    setBusy(true); setError("");
    try {
      const next = await undoContentBlock(courseId, selected, revisionId);
      setViews(current => ({ ...current, [selected]: next }));
      setDraft(next.revision?.content ?? ""); setSavedDraft(next.revision?.content ?? "");
      setDraftBlockId(selected); setDraftRevisionId(next.revision?.id);
      setWorkspace(current => current ? { ...current, blocks: current.blocks.map(block => block.id === selected ? next.block : block) } : current);
      setAiStatus("Letzte Bearbeitung rückgängig gemacht.");
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }

  async function submitAi(instruction: string) {
    const summary = selectedSummary;
    const revision = selectedView?.revision;
    const prompt = instruction.trim();
    if (!selected || !summary || !revision || !prompt || aiBusy || saving) return;
    const placement = summary.placements[0];
    const unit = placement ? pipeline.units.find(candidate => candidate.id === placement.unitId) : undefined;
    const sourceBlockIds = revision.provenance
      .filter(item => sourcePage == null || item.page === sourcePage || item.slide === sourcePage)
      .map(item => item.sourceBlockId)
      .filter((id, index, values) => values.indexOf(id) === index)
      .slice(0, 30);

    if (aiProvider === "chatgpt") {
      const handoff = buildChatGptHandoffPrompt({
        courseId,
        courseName,
        learningUnitId: unit?.id,
        learningUnitTitle: unit ? unitLabel(unit) : undefined,
        contentBlockId: summary.id,
        editableRevision: revision.id,
        sourceName: summary.name,
        materialId: summary.sourceId,
        materialRevision: summary.observedMaterialRevision,
        page: sourcePage,
        sourceBlockIds,
        selectionText: selectionText || undefined,
        instruction: prompt,
      });
      window.open(buildChatGptHandoffUrl(handoff), "_blank", "noopener,noreferrer");
      setAiPrompt(""); setAiStatus("Prompt in ChatGPT geöffnet.");
      return;
    }

    setAiBusy(true); setError(""); setAiStatus("");
    try {
      const result = await runContentAgent(courseId, selected, revision.id, prompt, {
        selectionText: selectionText || undefined,
        page: sourcePage,
        sourceBlockIds,
      });
      const next = result.view;
      setViews(current => ({ ...current, [selected]: next }));
      setDraft(next.revision?.content ?? draft); setSavedDraft(next.revision?.content ?? draft);
      setDraftBlockId(selected); setDraftRevisionId(next.revision?.id);
      setWorkspace(current => current ? { ...current, blocks: current.blocks.map(block => block.id === selected ? next.block : block) } : current);
      setAiPrompt(""); setAiStatus(result.summary);
    } catch (error) { setError(message(error)); }
    finally { setAiBusy(false); }
  }


  useEffect(() => {
    if (editing || selection.kind === "source") { onTocChange?.([]); return; }
    const frame = requestAnimationFrame(() => {
      const root = readingRootRef.current;
      if (!root) { onTocChange?.([]); return; }
      const items = Array.from(root.querySelectorAll<HTMLElement>("h1,h2,h3,h4")).map((heading, index) => {
        const label = heading.textContent?.trim() || `Abschnitt ${index + 1}`;
        const slug = label.toLocaleLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "abschnitt";
        const id = `content-${slug}-${index + 1}`;
        heading.id = id;
        heading.classList.add("content-toc-anchor");
        return { id, label, level: Number(heading.tagName.slice(1)) };
      });
      onTocChange?.(items);
    });
    return () => cancelAnimationFrame(frame);
  }, [editing, selection, views, onTocChange]);

  const taskNodesFor = (unitId: string) => outline.taskGroups.find(group => group.scriptUnit?.id === unitId)?.tasks ?? [];

  function renderReadingBlock(block: ContentBlockSummary, unitId?: string) {
    const view = views[block.id];
    const preview = view?.revision?.content;
    return <article className="content-reading-block" key={block.id}>
      {editing && <button type="button" className="content-reading-source" onClick={() => onSelectSource(block.id, unitId)} title={`${block.name} bearbeiten`}>
        <Icon.File filename={block.name} size={15}/><span>{block.name}</span>{sourcePages(block) && <small>{sourcePages(block)}</small>}<small className="content-reading-edit-label"><PencilLine size={11}/>Bearbeiten</small>
      </button>}
      {preview ? <div className="content-reading-markdown"><MarkdownRenderer value={preview}/></div> : <div className="content-preview-placeholder">{block.currentRevisionId ? "Inhalt wird geladen …" : "Noch keine aufbereitete Rohfassung."}</div>}
    </article>;
  }

  function renderReadingNode(node: ContentUnitNode, depth = 0, task = false) {
    const linkedTasks = task ? [] : taskNodesFor(node.unit.id);
    return <section className="content-reading-unit" data-task={task||undefined} data-depth={depth} key={node.unit.id}>
      <header className="content-reading-unit-head">
        {task && <PencilLine size={14}/>}<h2>{unitLabel(node.unit)}</h2>{task && <span>Aufgabe</span>}
      </header>
      {node.blocks.map(block => renderReadingBlock(block, node.unit.id))}
      {node.children.map(child => renderReadingNode(child, depth + 1, task))}
      {linkedTasks.length > 0 && <div className="content-reading-task-group">
        <div className="content-reading-task-label">Aufgaben</div>
        {linkedTasks.map(item => renderReadingNode(item, depth + 1, true))}
      </div>}
    </section>;
  }

  function renderReadingSelection() {
    if (selection.kind === "script") return <div className="content-reading-script">
      {outline.script.map(node => renderReadingNode(node))}
      {outline.taskGroups.filter(group => !group.scriptUnit).length > 0 && <section className="content-reading-unassigned-tasks">
        <h2>Aufgaben</h2>{outline.taskGroups.filter(group => !group.scriptUnit).flatMap(group => group.tasks).map(node => renderReadingNode(node, 0, true))}
      </section>}
      {outline.unassignedBlocks.length > 0 && <section className="content-reading-unassigned"><h2>Weitere Inhalte</h2>{outline.unassignedBlocks.map(block => renderReadingBlock(block))}</section>}
    </div>;

    if (selection.kind === "unit") {
      const scriptNode = findNode(outline.script, selection.id);
      const taskNode = outline.taskGroups.flatMap(group => group.tasks).map(root => findNode([root], selection.id)).find((node): node is ContentUnitNode => !!node);
      const node = scriptNode ?? taskNode;
      if (!node) return <div className="content-authoring-empty">Dieser Eintrag enthält noch keinen aufbereiteten Inhalt.</div>;
      return <div className="content-reading-script">{renderReadingNode(node, 0, unitKind(node.unit) === "tasks")}</div>;
    }

    return null;
  }

  const stale = blocks.filter(block => block.stale).length;
  const selectedTitle = selection.kind === "script"
    ? "Gesamtes Skript"
    : selection.kind === "unit"
      ? pipeline.units.find(unit => unit.id === selection.id) ? unitLabel(pipeline.units.find(unit => unit.id === selection.id)!) : "Inhalt"
      : selectedSummary?.name ?? pipeline.sources.find(item => item.source.id === selection.id)?.source.name ?? "Inhalt";
  const aiContextLabel = selectedSummary ? [selectedSummary.name, selectionText ? "Auswahl" : selectedUnit ? unitLabel(selectedUnit) : undefined, sourcePage ? `Seite ${sourcePage}` : undefined].filter(Boolean).join(" · ") : "Block auswählen";
  const aiProviderOptions = [
    { id: "codex", label: "Codex", selected: aiProvider === "codex" },
    { id: "chatgpt", label: "ChatGPT", selected: aiProvider === "chatgpt" },
  ];

  if (loading) return <div className="content-authoring-loading"><Loading label="Editierbare Inhalte werden gelesen …" /></div>;

  return <div className="content-authoring content-authoring-panel" data-editing={editing||undefined}>
    <header className="content-authoring-head">
      <div className="content-authoring-title">
        <strong>{selectedTitle}</strong>
        {selected && <span>{saving ? "Speichert…" : draft !== savedDraft ? "Nicht gespeichert" : "Gespeichert"}</span>}
        {stale > 0 && <span className="content-authoring-warning"><AlertTriangle size={13}/>{stale} Quelle{stale === 1 ? "" : "n"} aktualisiert</span>}
      </div>
      {editing && <div className="content-authoring-actions">
        <Button size="sm" variant="ghost" icon="refresh" label={blocks.length ? "Inhalte aktualisieren" : "Rohfassung erstellen"} disabled={busy || !canMaterialize} onPress={() => void refresh()}/>
      </div>}
    </header>

    {selectedSummary && <div className="content-view-tabs" role="tablist" aria-label={`${selectedSummary.name} Ansicht`}>
      <button type="button" role="tab" aria-label="Inhalt" title="Inhalt" aria-selected={tab === "content"} onClick={() => setTab("content")}><FileText size={16}/></button>
      <button type="button" role="tab" aria-label="PDF mit bearbeitetem Inhalt vergleichen" title="PDF ↔ Bearbeitet" aria-selected={tab === "pdf-current"} disabled={!isPdf} onClick={() => { setTab("pdf-current"); setComparePane("left"); }}><Columns2 size={16}/></button>
      <button type="button" role="tab" aria-label="Raw mit bearbeitetem Inhalt vergleichen" title="Git-Diff: Raw ↔ Bearbeitet" aria-selected={tab === "edited-raw"} disabled={!selectedView?.revision} onClick={() => { setTab("edited-raw"); setComparePane("left"); }}><FileDiff size={16}/></button>
      <button type="button" role="tab" aria-label="Raw anzeigen" title="Raw" aria-selected={tab === "raw"} disabled={!selectedView?.revision} onClick={() => setTab("raw")}><Code2 size={16}/></button>
    </div>}

    {error && <Notice>{error}</Notice>}
    {!blocks.length && <div className="content-materialize-hint">
      <span>{contentCandidateCount === 0
        ? pipeline.pending > 0
          ? `${pipeline.pending} Quellen sind noch offen. Ordne sie unter Quellen zu oder blende sie aus.`
          : "Keine sichtbare Quelle ist einem sichtbaren Struktur-Eintrag zugeordnet."
        : "Noch keine editierbare Rohfassung aus der bestätigten Struktur."}</span>
      <Button label="Rohfassung erstellen" size="sm" disabled={busy || !canMaterialize} onPress={() => void refresh()}/>
    </div>}

    {selection.kind !== "source" ? <div ref={readingRootRef}>{renderReadingSelection()}</div> : !selectedSummary ? <div className="content-authoring-empty">Diese Datei ist noch nicht als Inhalt materialisiert.</div> : <div className="content-source-detail" ref={activeBlockRef}>
      <div className="content-source-meta">
        <Icon.File filename={selectedSummary.name} size={16}/><span>{statusLabel(selectedSummary)}</span>{sourcePages(selectedSummary) && <span>{sourcePages(selectedSummary)}</span>}{selectedSummary.stale && <AlertTriangle size={13}/>} {selectedSummary.status === "ready" && <Check size={13}/>}
      </div>
      {!selectedView && selectedSummary.currentRevisionId ? <Loading label="Inhalt wird geöffnet …"/> : !selectedView?.revision ? <div className="content-preview-placeholder">Für diese Quelle gibt es noch keine editierbare Rohfassung.</div> : !draftReady ? <Loading label="Bearbeitete Fassung wird geladen …"/> : tab === "content" ? <>
        {editing ? <MarkdownEditor value={draft} onChange={setDraft} minHeight={320}/> : <div className="content-current-render"><MarkdownRenderer value={draft}/></div>}
        {editing && <div className="content-block-footer">
          <span>{saving ? "Speichert…" : draft === savedDraft ? `Revision ${selectedView.revision.id.slice(0, 8)}` : "Änderungen werden automatisch gespeichert"}</span>
          <Button size="sm" variant="ghost" label="Auf Raw zurücksetzen" disabled={busy || saving} onPress={() => void reset()}/>
        </div>}
      </> : tab === "pdf-current" && originalUrl ? <>
        <div className="content-compare-mobile-switch" role="group" aria-label="Vergleichsansicht">
          <button type="button" aria-pressed={comparePane === "left"} onClick={() => setComparePane("left")}>PDF</button>
          <button type="button" aria-pressed={comparePane === "right"} onClick={() => setComparePane("right")}>Jetzt</button>
        </div>
        <div className="content-compare">
          <div className="content-compare-pane content-compare-pdf" data-mobile-visible={comparePane === "left" || undefined}>
            <div className="content-compare-label">Original PDF</div>
            <PdfViewer source={originalUrl} title={selectedSummary.name} initialPage={selectedSummary.placements[0]?.firstPage ?? 1} page={activeSourcePage} onPageChange={setSourcePage} customize={{className:"h-[68vh] min-h-[32rem]",reason:"Compare preserved source with current rendered Study Space content"}}/>
          </div>
          <div className="content-compare-pane content-compare-current" data-mobile-visible={comparePane === "right" || undefined}>
            <div className="content-compare-label">Jetzt</div>
            <div className="content-current-render"><ProvenancePreview content={draft} view={selectedView} activePage={activeSourcePage} onHoverPage={setHoveredSourcePage} onPinPage={setSourcePage}/></div>
          </div>
        </div>
      </> : tab === "edited-raw" ? <>
        <div className="content-diff-toolbar">
          {diffMode === "split" && <div className="content-compare-mobile-switch" role="group" aria-label="Vergleichsansicht">
            <button type="button" aria-pressed={comparePane === "left"} onClick={() => setComparePane("left")}>Raw</button>
            <button type="button" aria-pressed={comparePane === "right"} onClick={() => setComparePane("right")}>Bearbeitet</button>
          </div>}
          <div className="content-diff-mode" role="group" aria-label="Diff-Darstellung">
            <button type="button" aria-label="Inline Diff" title="Inline" aria-pressed={diffMode === "inline"} onClick={() => setDiffMode("inline")}><Rows3 size={15}/></button>
            <button type="button" aria-label="Side-by-side Diff" title="Side by side" aria-pressed={diffMode === "split"} onClick={() => setDiffMode("split")}><Columns2 size={15}/></button>
          </div>
        </div>
        {rawLoading === selected ? <Loading label="Raw wird geladen …"/> : <TextDiff
          before={rawRevision?.content ?? ""}
          after={draft}
          mode={diffMode}
          beforeLabel="Raw"
          afterLabel="Bearbeitet"
          mobileSide={comparePane === "left" ? "before" : "after"}
        />}
      </> : tab === "raw" ? rawLoading === selected ? <Loading label="Raw wird geladen …"/> : <pre className="content-raw"><code>{rawRevision?.content ?? ""}</code></pre> : null}
    </div>}

    {selectedSummary && selectedView?.revision && editing ? <div className="content-ai-wrap">
      {aiStatus ? <div className="content-ai-status" role="status"><span>{aiStatus}</span><div><Button size="sm" variant="ghost" label="Vergleich" onPress={() => setTab(isPdf ? "pdf-current" : "edited-raw")}/><Button size="sm" variant="ghost" label="Rückgängig" disabled={busy || saving || aiBusy || !selectedView.revision?.parentRevisionId} onPress={() => void undo()}/></div></div> : null}
      <div className="content-ai-context" title={aiContextLabel}>{aiContextLabel}</div>
      <Composer
        value={aiPrompt}
        onChange={setAiPrompt}
        onSubmit={(value) => void submitAi(value)}
        modelOptions={aiProviderOptions}
        onModelSelect={(option: AiOption) => setAiProvider(option.id === "chatgpt" ? "chatgpt" : "codex")}
        state={aiBusy ? "waiting" : "idle"}
        disabled={aiBusy || saving || busy}
        placeholder={selectionText ? "Auswahl bearbeiten…" : "Diesen Block bearbeiten…"}
        submitLabel={aiProvider === "chatgpt" ? "In ChatGPT" : "Senden"}
      />
    </div> : null}
  </div>;
}
