import "./content-authoring-overrides.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Icon } from "@dotnaos/ui-base";
import { MarkdownEditor, MarkdownRenderer } from "@dotnaos/ui/markdown-editor";
import { PdfViewer } from "@dotnaos/ui/pdf-viewer";
import { Composer, type AiOption } from "./ui-ai";
import { AlertTriangle, Check, Code2, Columns2, FileDiff, FileText, PanelRightClose, PencilLine, Rows3 } from "lucide-react";
import { message } from "./api";
import { extractMaterialSource, readMaterialSnapshot } from "./material-api";
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

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

const tabButtonClass = "relative grid size-8 min-w-8 flex-none place-items-center rounded-[.35rem] text-text-muted transition-colors hover:bg-bg-1 hover:text-text disabled:cursor-default disabled:opacity-35";
const tabButtonSelectedClass = "bg-bg-1 text-text after:absolute after:right-[.35rem] after:bottom-[-.32rem] after:left-[.35rem] after:h-px after:bg-accent after:content-['']";
const mobileCompareClass = "hidden items-center gap-[.15rem] rounded-[.4rem] border border-border bg-bg-1 p-[.15rem] max-[800px]:inline-flex";
const mobileCompareButtonClass = "min-h-[1.8rem] rounded-[.3rem] px-[.6rem] py-1 text-[.7rem] text-text-muted";
const mobileCompareButtonActiveClass = "bg-bg-0 text-text";
const diffModeButtonClass = "grid size-[1.9rem] place-items-center rounded-[.3rem] text-text-muted hover:bg-bg-0 hover:text-text";
const diffModeButtonActiveClass = "bg-bg-0 text-text shadow-sm";

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

  return <div className="flex flex-col gap-[.15rem]">
    {parts.map(part => part.page ? <div
      key={part.key}
      className={cx(
        "relative mx-[-.55rem] cursor-pointer rounded-[.2rem] border-l-2 border-transparent px-[.55rem] py-[.15rem] transition-colors",
        "hover:border-accent hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]",
        activePage === part.page && "border-accent bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]",
      )}
      onMouseEnter={() => onHoverPage(part.page)}
      onMouseLeave={() => onHoverPage(undefined)}
      onClick={() => onPinPage(part.page!)}
      title={`Original: Seite ${part.page}`}
    >
      {activePage === part.page && <span className="absolute top-[.2rem] right-[.3rem] rounded-[.25rem] bg-bg-1 px-[.3rem] py-[.05rem] text-[.6rem] leading-[1.2] text-text-muted">S. {part.page}</span>}
      <MarkdownRenderer value={part.text}/>
    </div> : <MarkdownRenderer key={part.key} value={part.text}/>)}
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
  onCollapseView,
  onRefreshPipeline,
}: {
  courseId: number;
  courseName: string;
  pipeline: PipelineState;
  selection: ContentSelection;
  editing: boolean;
  onSelectSource: (id: string, unitId?: string) => void;
  onTocChange?: (items: ContentTocItem[]) => void;
  onCollapseView?: () => void;
  onRefreshPipeline?: () => Promise<PipelineState | undefined> | void;
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
  const [extractingSourceId, setExtractingSourceId] = useState<string>();
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
  const selectedPipelineSource = selected ? pipeline.sources.find(item => item.source.id === selected) : undefined;
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

  async function extractSelectedPdf() {
    const source = selectedPipelineSource?.source;
    if (!selected || !source || source.mimeType !== "application/pdf" || source.acquisition === "unsupported" || extractingSourceId) return;
    setExtractingSourceId(selected);
    setError("");
    try {
      let snapshot = await extractMaterialSource(courseId, source.id);
      const deadline = Date.now() + 9 * 60 * 1000;
      while (snapshot.job?.status === "queued" || snapshot.job?.status === "running") {
        if (Date.now() >= deadline) throw new Error("Die PDF-Extraktion läuft länger als erwartet. Prüfe den Material-Status erneut.");
        await new Promise(resolve => window.setTimeout(resolve, 1200));
        snapshot = await readMaterialSnapshot(courseId);
      }
      const material = snapshot.materials.find(item => item.id === source.id);
      if (material?.status !== "ready") {
        throw new Error(material?.reason ?? snapshot.job?.error ?? "Die PDF-Extraktion konnte nicht abgeschlossen werden.");
      }
      const refreshedPipeline = await onRefreshPipeline?.();
      if (!refreshedPipeline) throw new Error("Die Quellenstruktur konnte nach der Extraktion nicht aktualisiert werden.");
      const nextWorkspace = await materializeContent(courseId, refreshedPipeline.revision);
      setWorkspace(nextWorkspace);
      await hydrate(nextWorkspace);
      if (selected && nextWorkspace.blocks.some(block => block.id === selected && block.currentRevisionId)) {
        const view = await readContentBlock(courseId, selected);
        setViews(current => ({ ...current, [selected]: view }));
        const content = view.revision?.content ?? "";
        setDraft(content); setSavedDraft(content);
        setDraftBlockId(selected); setDraftRevisionId(view.revision?.id);
        setRawRevisions(current => { const nextRaw = { ...current }; delete nextRaw[selected]; return nextRaw; });
        if (view.revision) void ensureRawRevision(selected, view.revision);
      }
    } catch (error) {
      setError(message(error));
    } finally {
      setExtractingSourceId(current => current === selected ? undefined : current);
    }
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

  async function rebuildStale() {
    const staleBlocks = (workspace?.blocks ?? []).filter(block => block.included && block.stale && block.currentRevisionId);
    if (!staleBlocks.length || busy || saving || aiBusy) return;
    setBusy(true); setError("");
    try {
      const replacements: ContentBlockView[] = [];
      for (const block of staleBlocks) {
        const current = views[block.id] ?? await readContentBlock(courseId, block.id);
        const revisionId = current.revision?.id;
        if (!revisionId) continue;
        replacements.push(await resetContentBlock(courseId, block.id, revisionId));
      }
      const byId = new Map(replacements.map(view => [view.block.id, view]));
      setViews(current => ({ ...current, ...Object.fromEntries(replacements.map(view => [view.block.id, view])) }));
      setWorkspace(current => current ? { ...current, blocks: current.blocks.map(block => byId.get(block.id)?.block ?? block) } : current);
      setRawRevisions(current => ({ ...current, ...Object.fromEntries(replacements.flatMap(view => view.revision ? [[view.block.id, view.revision]] : [])) }));
      const selectedNext = selected ? byId.get(selected) : undefined;
      if (selectedNext?.revision) {
        setDraft(selectedNext.revision.content); setSavedDraft(selectedNext.revision.content);
        setDraftBlockId(selected!); setDraftRevisionId(selectedNext.revision.id);
      }
      setAiStatus(`${replacements.length} aktualisierte Raw-Fassung${replacements.length === 1 ? "" : "en"} übernommen.`);
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
    return <article className="min-w-0" key={block.id}>
      {editing && <button
        type="button"
        className="mb-[.45rem] flex max-w-full items-center gap-[.4rem] rounded-[.35rem] bg-transparent px-[.3rem] py-[.2rem] text-[.67rem] text-text-muted transition-colors hover:bg-bg-1 hover:text-text"
        onClick={() => onSelectSource(block.id, unitId)}
        title={`${block.name} bearbeiten`}
      >
        <Icon.File filename={block.name} size={15}/>
        <span className="min-w-0 truncate">{block.name}</span>
        {sourcePages(block) && <small className="ml-auto whitespace-nowrap text-[.6rem] text-text-muted">{sourcePages(block)}</small>}
        <small className="ml-[.15rem] inline-flex items-center gap-[.2rem] whitespace-nowrap text-[.6rem] text-accent"><PencilLine size={11}/>Bearbeiten</small>
      </button>}
      {preview ? <div className="min-w-0 [&>:first-child]:mt-0 [&>:last-child]:mb-0"><MarkdownRenderer value={preview}/></div> : <div className="block p-3 text-[.72rem] text-text-muted">{block.currentRevisionId ? "Inhalt wird geladen …" : "Noch keine aufbereitete Rohfassung."}</div>}
    </article>;
  }

  function renderReadingNode(node: ContentUnitNode, depth = 0, task = false) {
    const linkedTasks = task ? [] : taskNodesFor(node.unit.id);
    const depthClass = depth === 1
      ? "ml-[.65rem] border-l border-border pl-4 max-[800px]:ml-1 max-[800px]:pl-[.55rem]"
      : depth >= 2
        ? "ml-[.45rem] border-l border-border pl-[.8rem] max-[800px]:ml-1 max-[800px]:pl-[.55rem]"
        : "";
    const headingSize = depth === 0 ? "text-[.95rem]" : depth === 1 ? "text-[.84rem]" : "text-[.78rem]";
    return <section
      className={cx(
        "flex min-w-0 flex-col gap-3",
        depthClass,
        task && "rounded-[.4rem] border-l-2 border-warning bg-[color-mix(in_srgb,var(--color-warning)_5%,transparent)] px-3 py-[.65rem]",
      )}
      key={node.unit.id}
    >
      <header className={cx("flex min-w-0 items-center gap-[.45rem]", task && "text-warning")}>
        {task && <PencilLine size={14}/>}
        <h2 className={cx("m-0 min-w-0 font-[620] leading-[1.3] text-text", headingSize)}>{unitLabel(node.unit)}</h2>
        {task && <span className="rounded-full bg-[color-mix(in_srgb,var(--color-warning)_14%,transparent)] px-[.35rem] py-[.12rem] text-[.6rem] text-warning">Aufgabe</span>}
      </header>
      {node.blocks.map(block => renderReadingBlock(block, node.unit.id))}
      {node.children.map(child => renderReadingNode(child, depth + 1, task))}
      {linkedTasks.length > 0 && <div className="mt-[.35rem] flex flex-col gap-[.55rem]">
        <div className="text-[.64rem] font-semibold uppercase tracking-[.04em] text-text-muted">Aufgaben</div>
        {linkedTasks.map(item => renderReadingNode(item, depth + 1, true))}
      </div>}
    </section>;
  }

  function renderReadingSelection() {
    if (selection.kind === "script") return <div className="flex flex-col gap-[1.45rem] px-[1.35rem] pt-[1.15rem] pb-8 max-[800px]:px-[.85rem] max-[800px]:pt-[.9rem] max-[800px]:pb-[1.4rem]">
      {outline.script.map(node => renderReadingNode(node))}
      {outline.taskGroups.filter(group => !group.scriptUnit).length > 0 && <section className="flex flex-col gap-[.7rem] border-t border-border pt-[.9rem] [&>h2]:m-0 [&>h2]:text-[.82rem]">
        <h2>Aufgaben</h2>{outline.taskGroups.filter(group => !group.scriptUnit).flatMap(group => group.tasks).map(node => renderReadingNode(node, 0, true))}
      </section>}
      {outline.unassignedBlocks.length > 0 && <section className="flex flex-col gap-[.7rem] border-t border-border pt-[.9rem] [&>h2]:m-0 [&>h2]:text-[.82rem]"><h2>Weitere Inhalte</h2>{outline.unassignedBlocks.map(block => renderReadingBlock(block))}</section>}
    </div>;

    if (selection.kind === "unit") {
      const scriptNode = findNode(outline.script, selection.id);
      const taskNode = outline.taskGroups.flatMap(group => group.tasks).map(root => findNode([root], selection.id)).find((node): node is ContentUnitNode => !!node);
      const node = scriptNode ?? taskNode;
      if (!node) return <div className="grid min-h-72 place-items-center gap-[.8rem] text-[.8rem] text-text-muted">Dieser Eintrag enthält noch keinen aufbereiteten Inhalt.</div>;
      return <div className="flex flex-col gap-[1.45rem] px-[1.35rem] pt-[1.15rem] pb-8 max-[800px]:px-[.85rem] max-[800px]:pt-[.9rem] max-[800px]:pb-[1.4rem]">{renderReadingNode(node, 0, unitKind(node.unit) === "tasks")}</div>;
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

  if (loading) return <div className="p-8"><Loading label="Editierbare Inhalte werden gelesen …" /></div>;

  return <div className="content-authoring m-0 max-w-none bg-bg-0 p-0 pb-44 max-[760px]:pb-48" data-editing={editing||undefined}>
    <header className={cx(
      "content-authoring-header sticky top-0 z-[4] flex items-center justify-between gap-4 border-b border-border bg-bg-1 px-4 max-[800px]:static max-[800px]:px-[.8rem] max-[800px]:py-[.65rem]",
      editing ? "h-[3.35rem] min-h-[3.35rem] py-0" : "min-h-[3.25rem] py-[.7rem]",
    )}>
      <div className="flex min-w-0 items-baseline gap-[.55rem]">
        <strong className="max-w-[min(38rem,65vw)] truncate text-[.82rem] font-semibold max-[800px]:max-w-[55vw]">{selectedTitle}</strong>
        {selected && <span className="text-[.66rem] text-text-muted">{saving ? "Speichert…" : draft !== savedDraft ? "Nicht gespeichert" : "Gespeichert"}</span>}
        {stale > 0 && <span className="inline-flex items-center gap-1 text-[.66rem] text-text-muted"><AlertTriangle size={13}/>{stale} Quelle{stale === 1 ? "" : "n"} aktualisiert</span>}
      </div>
      {editing && <div className="flex items-center gap-2 max-[760px]:w-full max-[760px]:justify-between">
        {blocks.length > 0 && <Button size="sm" variant="ghost" icon="refresh" label="Inhalte aktualisieren" disabled={busy || !canMaterialize} onPress={() => void refresh()}/>}
        {stale > 0 && <Button size="sm" variant="ghost" label="Aktualisierte Raw-Fassungen übernehmen" disabled={busy || saving || aiBusy} onPress={() => void rebuildStale()}/>}
        {onCollapseView && <button type="button" className="grid size-[1.9rem] flex-none place-items-center rounded-[.4rem] text-text-muted transition-colors hover:bg-bg-1 hover:text-text" onClick={onCollapseView} aria-label="View einklappen" title="Collapse View"><PanelRightClose size={14}/></button>}
      </div>}
    </header>

    {selectedSummary && <div className="flex min-h-[2.35rem] items-center gap-[.15rem] overflow-x-auto border-b border-border bg-bg-0 px-4 py-[.3rem] max-[800px]:px-[.7rem] max-[800px]:py-1" role="tablist" aria-label={`${selectedSummary.name} Ansicht`}>
      <button className={cx(tabButtonClass, tab === "content" && tabButtonSelectedClass)} type="button" role="tab" aria-label="Inhalt" title="Inhalt" aria-selected={tab === "content"} onClick={() => setTab("content")}><FileText size={16}/></button>
      <button className={cx(tabButtonClass, tab === "pdf-current" && tabButtonSelectedClass)} type="button" role="tab" aria-label="PDF mit bearbeitetem Inhalt vergleichen" title="PDF ↔ Bearbeitet" aria-selected={tab === "pdf-current"} disabled={!isPdf} onClick={() => { setTab("pdf-current"); setComparePane("left"); }}><Columns2 size={16}/></button>
      <button className={cx(tabButtonClass, tab === "edited-raw" && tabButtonSelectedClass)} type="button" role="tab" aria-label="Raw mit bearbeitetem Inhalt vergleichen" title="Git-Diff: Raw ↔ Bearbeitet" aria-selected={tab === "edited-raw"} disabled={!selectedView?.revision} onClick={() => { setTab("edited-raw"); setComparePane("left"); }}><FileDiff size={16}/></button>
      <button className={cx(tabButtonClass, tab === "raw" && tabButtonSelectedClass)} type="button" role="tab" aria-label="Raw anzeigen" title="Raw" aria-selected={tab === "raw"} disabled={!selectedView?.revision} onClick={() => setTab("raw")}><Code2 size={16}/></button>
    </div>}

    {error && <div className="mx-4 my-3"><Notice>{error}</Notice></div>}
    {!blocks.length && <div className="mx-auto grid min-h-[calc(min(76vh,58rem)-8rem)] place-content-center justify-items-center gap-4 px-4 py-8 text-center text-[.76rem] text-text-muted max-[760px]:min-h-56 max-[760px]:px-3 max-[760px]:py-6">
      <span className="max-w-[34rem] leading-[1.55]">{contentCandidateCount === 0
        ? pipeline.pending > 0
          ? `${pipeline.pending} Quellen sind noch offen. Ordne sie unter Quellen zu oder blende sie aus.`
          : "Keine sichtbare Quelle ist einem sichtbaren Struktur-Eintrag zugeordnet."
        : "Noch keine editierbare Rohfassung aus der bestätigten Struktur."}</span>
      <Button variant="primary" icon="sparkles" label="Rohfassung erstellen" disabled={busy || !canMaterialize} onPress={() => void refresh()}/>
    </div>}

    {blocks.length > 0 && (selection.kind !== "source" ? <div ref={readingRootRef}>{renderReadingSelection()}</div> : !selectedSummary ? <div className="grid min-h-72 place-items-center gap-[.8rem] text-[.8rem] text-text-muted">Diese Datei ist noch nicht als Inhalt materialisiert.</div> : <div className="px-[1.1rem] pt-4 pb-6 max-[800px]:p-[.8rem]" ref={activeBlockRef}>
      <div className="mb-[.8rem] flex items-center gap-[.45rem] text-[.65rem] text-text-muted [&>span+span]:border-l [&>span+span]:border-border [&>span+span]:pl-[.45rem]">
        <Icon.File filename={selectedSummary.name} size={16}/><span>{statusLabel(selectedSummary)}</span>{sourcePages(selectedSummary) && <span>{sourcePages(selectedSummary)}</span>}{selectedSummary.stale && <AlertTriangle size={13}/>} {selectedSummary.status === "ready" && <Check size={13}/>}
      </div>
      {editing && selectedSummary.status === "not-ready" && selectedPipelineSource?.source.mimeType === "application/pdf" && selectedPipelineSource.source.acquisition !== "unsupported" ? <div className="grid min-h-[22rem] place-content-center justify-items-center gap-[.7rem] px-4 py-8 text-center text-text-muted">
        <span className="inline-flex size-10 items-center justify-center rounded-[.55rem] bg-bg-1 text-text-muted"><Icon.File filename={selectedSummary.name} size={20}/></span>
        <strong className="text-[.8rem] font-[650] text-text">{extractingSourceId === selected ? "PDF wird extrahiert …" : "PDF noch nicht extrahiert"}</strong>
        <span className="max-w-[29rem] text-[.68rem] leading-[1.5]">{extractingSourceId === selected ? "Study Space liest die Quelle ein und bereitet den Inhalt auf." : "Extrahiere diese Quelle, bevor du daraus eine editierbare Rohfassung erstellst."}</span>
        <Button variant="primary" icon="file-text" label={extractingSourceId === selected ? "Extraktion läuft …" : "PDF extrahieren"} disabled={busy || !!extractingSourceId} onPress={() => void extractSelectedPdf()}/>
      </div> : !selectedView && selectedSummary.currentRevisionId ? <Loading label="Inhalt wird geöffnet …"/> : !selectedView?.revision ? <div className="p-3 text-[.72rem] text-text-muted">Für diese Quelle gibt es noch keine editierbare Rohfassung.</div> : !draftReady ? <Loading label="Bearbeitete Fassung wird geladen …"/> : tab === "content" ? <>
        {editing ? <MarkdownEditor value={draft} onChange={setDraft} minHeight={320}/> : <div className="h-[68vh] min-h-64 overflow-auto px-[.9rem] py-[.8rem] [&>:first-child]:mt-0 [&>:last-child]:mb-0"><MarkdownRenderer value={draft}/></div>}
        {editing && <div className="mt-[.6rem] flex items-center justify-between gap-3 px-0 pt-[.45rem] pb-[.1rem] text-[.68rem] text-text-muted">
          <span>{saving ? "Speichert…" : draft === savedDraft ? `Revision ${selectedView.revision.id.slice(0, 8)}` : "Änderungen werden automatisch gespeichert"}</span>
          <Button size="sm" variant="ghost" label="Auf Raw zurücksetzen" disabled={busy || saving} onPress={() => void reset()}/>
        </div>}
      </> : tab === "pdf-current" && originalUrl ? <>
        <div className={mobileCompareClass} role="group" aria-label="Vergleichsansicht">
          <button className={cx(mobileCompareButtonClass, comparePane === "left" && mobileCompareButtonActiveClass)} type="button" aria-pressed={comparePane === "left"} onClick={() => setComparePane("left")}>PDF</button>
          <button className={cx(mobileCompareButtonClass, comparePane === "right" && mobileCompareButtonActiveClass)} type="button" aria-pressed={comparePane === "right"} onClick={() => setComparePane("right")}>Jetzt</button>
        </div>
        <div className="grid min-h-[32rem] grid-cols-2 gap-[.65rem] max-[800px]:block">
          <div className={cx(
            "min-w-0 overflow-hidden rounded-md border border-border bg-bg-0",
            comparePane === "left" ? "max-[800px]:block" : "max-[800px]:hidden",
          )}>
            <div className="h-9 border-b border-border px-[.8rem] py-[.65rem] text-[.68rem] font-semibold uppercase tracking-[.04em] text-text-muted">Original PDF</div>
            <PdfViewer source={originalUrl} title={selectedSummary.name} initialPage={selectedSummary.placements[0]?.firstPage ?? 1} page={activeSourcePage} onPageChange={setSourcePage} customize={{className:"h-[68vh] min-h-[32rem]",reason:"Compare preserved source with current rendered Study Space content"}}/>
          </div>
          <div className={cx(
            "min-w-0 overflow-hidden rounded-md border border-border bg-bg-0",
            comparePane === "right" ? "max-[800px]:block" : "max-[800px]:hidden",
          )}>
            <div className="h-9 border-b border-border px-[.8rem] py-[.65rem] text-[.68rem] font-semibold uppercase tracking-[.04em] text-text-muted">Jetzt</div>
            <div className="h-[68vh] min-h-64 overflow-auto px-[.9rem] py-[.8rem] [&>:first-child]:mt-0 [&>:last-child]:mb-0"><ProvenancePreview content={draft} view={selectedView} activePage={activeSourcePage} onHoverPage={setHoveredSourcePage} onPinPage={setSourcePage}/></div>
          </div>
        </div>
      </> : tab === "edited-raw" ? <>
        <div className="mb-[.45rem] flex items-center justify-end gap-[.45rem] max-[800px]:items-center">
          {diffMode === "split" && <div className={cx(mobileCompareClass, "mr-auto")} role="group" aria-label="Vergleichsansicht">
            <button className={cx(mobileCompareButtonClass, comparePane === "left" && mobileCompareButtonActiveClass)} type="button" aria-pressed={comparePane === "left"} onClick={() => setComparePane("left")}>Raw</button>
            <button className={cx(mobileCompareButtonClass, comparePane === "right" && mobileCompareButtonActiveClass)} type="button" aria-pressed={comparePane === "right"} onClick={() => setComparePane("right")}>Bearbeitet</button>
          </div>}
          <div className="inline-flex items-center gap-[.1rem] rounded-[.4rem] border border-border bg-bg-1 p-[.12rem]" role="group" aria-label="Diff-Darstellung">
            <button className={cx(diffModeButtonClass, diffMode === "inline" && diffModeButtonActiveClass)} type="button" aria-label="Inline Diff" title="Inline" aria-pressed={diffMode === "inline"} onClick={() => setDiffMode("inline")}><Rows3 size={15}/></button>
            <button className={cx(diffModeButtonClass, diffMode === "split" && diffModeButtonActiveClass)} type="button" aria-label="Side-by-side Diff" title="Side by side" aria-pressed={diffMode === "split"} onClick={() => setDiffMode("split")}><Columns2 size={15}/></button>
          </div>
        </div>
        {rawLoading === selected ? <Loading label="Raw wird geladen …"/> : <div className="[&_.text-diff]:h-[68vh] [&_.text-diff]:min-h-[32rem] max-[800px]:[&_.text-diff]:h-[62vh] max-[800px]:[&_.text-diff]:min-h-96"><TextDiff
          before={rawRevision?.content ?? ""}
          after={draft}
          mode={diffMode}
          beforeLabel="Raw"
          afterLabel="Bearbeitet"
          mobileSide={comparePane === "left" ? "before" : "after"}
        /></div>}
      </> : tab === "raw" ? rawLoading === selected ? <Loading label="Raw wird geladen …"/> : <pre className="m-0 max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-[.45rem] border border-border bg-bg-1 p-4 font-mono text-[.7rem] leading-[1.55] text-text"><code>{rawRevision?.content ?? ""}</code></pre> : null}
    </div>)}

    {selectedSummary && selectedView?.revision && editing ? <div className="fixed right-[clamp(.75rem,3vw,2rem)] bottom-[clamp(.75rem,2vw,1.5rem)] left-[max(calc(50%_-_29rem),.75rem)] z-30 ml-auto max-w-[58rem] rounded-xl border border-border bg-[color-mix(in_srgb,var(--color-bg-0)_94%,transparent)] p-[.35rem] shadow-[0_12px_36px_rgb(0_0_0/.18)] backdrop-blur-[12px] max-[760px]:right-[.35rem] max-[760px]:bottom-[max(.35rem,env(safe-area-inset-bottom))] max-[760px]:left-[.35rem] max-[760px]:w-auto max-[760px]:max-w-none [&_[data-ui-component=Composer]]:min-w-0">
      {aiStatus ? <div className="flex items-center justify-between gap-2 px-[.35rem] pt-[.15rem] pb-[.3rem] text-[.68rem] text-text-muted max-[760px]:items-start" role="status"><span className="min-w-0 truncate max-[760px]:line-clamp-2 max-[760px]:whitespace-normal">{aiStatus}</span><div className="flex flex-none items-center gap-[.15rem]"><Button size="sm" variant="ghost" label="Vergleich" onPress={() => setTab(isPdf ? "pdf-current" : "edited-raw")}/><Button size="sm" variant="ghost" label="Rückgängig" disabled={busy || saving || aiBusy || !selectedView.revision?.parentRevisionId} onPress={() => void undo()}/></div></div> : null}
      <div className="min-w-0 truncate px-[.55rem] pt-[.15rem] pb-[.35rem] text-[.67rem] text-text-muted" title={aiContextLabel}>{aiContextLabel}</div>
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
