import "./content-authoring.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Icon } from "@dotnaos/ui-base";
import { MarkdownEditor, MarkdownRenderer } from "@dotnaos/ui/markdown-editor";
import { PdfViewer } from "@dotnaos/ui/pdf-viewer";
import { AssistantComposer as Composer, type AiOption } from "@dotnaos/ui/ai";
import { AlertTriangle, Check, GitCompareArrows, PencilLine } from "lucide-react";
import { message } from "./api";
import type { PipelineState } from "./pipeline-api";
import { unitHidden, unitLabel } from "./learning-structure";
import { groupContentBlocks } from "./content-authoring-model";
import {
  materializeContent,
  originalMaterialUrl,
  readContentBlock,
  readContentWorkspace,
  resetContentBlock,
  runContentAgent,
  saveContentBlock,
  undoContentBlock,
  type ContentBlockSummary,
  type ContentBlockView,
  type ContentWorkspace,
} from "./content-api";
import { Loading, Notice } from "./shared";
import { buildChatGptHandoffPrompt, buildChatGptHandoffUrl } from "./chatgpt-handoff";

type SurfaceMode = "edit" | "review";
type BlockMode = "edited" | "pdf" | "compare";

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

export function ContentAuthoringView({ courseId, courseName, pipeline }: { courseId: number; courseName: string; pipeline: PipelineState }) {
  const [workspace, setWorkspace] = useState<ContentWorkspace>();
  const [selected, setSelected] = useState<string>();
  const [hovered, setHovered] = useState<string>();
  const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>("edit");
  const [blockMode, setBlockMode] = useState<BlockMode>("edited");
  const [comparePane, setComparePane] = useState<"pdf" | "current">("pdf");
  const [views, setViews] = useState<Record<string, ContentBlockView>>({});
  const [draft, setDraft] = useState("");
  const [savedDraft, setSavedDraft] = useState("");
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
      const selection = window.getSelection();
      const root = activeBlockRef.current;
      if (!selection || selection.isCollapsed || !root || !selection.anchorNode || !selection.focusNode ||
          !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) {
        setSelectionText("");
        return;
      }
      setSelectionText(selection.toString().trim().slice(0, 8000));
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [selected]);

  const contentCandidateCount = useMemo(() => pipeline.sources.filter(item => {
    if (!item.source.present || item.decision?.disposition !== "use") return false;
    return item.decision.uses.some(use => {
      const unit = pipeline.units.find(candidate => candidate.id === use.unitId);
      return !!unit && !unitHidden(unit, pipeline.units);
    });
  }).length, [pipeline]);
  const canMaterialize = contentCandidateCount > 0 || (workspace?.blocks.length ?? 0) > 0;

  async function refresh() {
    if (busy) return;
    if (!canMaterialize) {
      setError(pipeline.pending > 0
        ? `${pipeline.pending} Quellen sind noch offen. Bestätige in der Struktur zuerst mindestens eine Quellenzuordnung.`
        : "Keine bestätigte Quelle ist einer sichtbaren Lerneinheit zugeordnet.");
      return;
    }
    setBusy(true); setError("");
    try {
      const next = await materializeContent(courseId, pipeline.revision);
      setWorkspace(next);
      void hydrate(next);
      const current = selected ? next.blocks.find(block => block.id === selected) : undefined;
      if (current?.currentRevisionId) await openBlock(current.id, true);
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }

  async function openBlock(id: string, force = false) {
    setSelected(id); setBlockMode("edited"); setComparePane("pdf"); setError(""); setAiStatus(""); setSelectionText(""); setHoveredSourcePage(undefined);
    const summary = workspace?.blocks.find(block => block.id === id);
    const cachedRevision = views[id]?.revision;
    setSourcePage(summary?.placements[0]?.firstPage ?? cachedRevision?.provenance.find(item => item.page != null || item.slide != null)?.page ?? cachedRevision?.provenance.find(item => item.slide != null)?.slide ?? undefined);
    if (!force && cachedRevision) {
      const content = cachedRevision.content ?? "";
      setDraft(content); setSavedDraft(content); return;
    }
    try {
      const view = await readContentBlock(courseId, id);
      setViews(current => ({ ...current, [id]: view }));
      const content = view.revision?.content ?? "";
      setDraft(content); setSavedDraft(content);
      setSourcePage(summary?.placements[0]?.firstPage ?? view.revision?.provenance.find(item => item.page != null)?.page ?? view.revision?.provenance.find(item => item.slide != null)?.slide ?? undefined);
    } catch (error) { setError(message(error)); }
  }

  async function save() {
    const view = selected ? views[selected] : undefined;
    const revisionId = view?.revision?.id;
    if (!selected || !revisionId || draft === savedDraft || saving) return true;
    setSaving(true); setError("");
    try {
      const next = await saveContentBlock(courseId, selected, revisionId, draft);
      setViews(current => ({ ...current, [selected]: next }));
      setSavedDraft(next.revision?.content ?? draft);
      setWorkspace(current => current ? { ...current, blocks: current.blocks.map(block => block.id === selected ? next.block : block) } : current);
      return true;
    } catch (error) { setError(message(error)); return false; }
    finally { setSaving(false); }
  }

  useEffect(() => {
    if (!selected || draft === savedDraft || saving) return;
    const timer = window.setTimeout(() => { void save(); }, 700);
    return () => window.clearTimeout(timer);
  }, [draft, savedDraft, saving, selected]);

  async function reset() {
    const view = selected ? views[selected] : undefined;
    if (!selected || !view?.revision?.id || busy) return;
    setBusy(true); setError("");
    try {
      const next = await resetContentBlock(courseId, selected, view.revision.id);
      setViews(current => ({ ...current, [selected]: next }));
      setDraft(next.revision?.content ?? ""); setSavedDraft(next.revision?.content ?? "");
      setWorkspace(current => current ? { ...current, blocks: current.blocks.map(block => block.id === selected ? next.block : block) } : current);
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }

  async function undo() {
    const view = selected ? views[selected] : undefined;
    if (!selected || !view?.revision?.id || busy || saving || aiBusy) return;
    setBusy(true); setError("");
    try {
      const next = await undoContentBlock(courseId, selected, view.revision.id);
      setViews(current => ({ ...current, [selected]: next }));
      setDraft(next.revision?.content ?? ""); setSavedDraft(next.revision?.content ?? "");
      setWorkspace(current => current ? { ...current, blocks: current.blocks.map(block => block.id === selected ? next.block : block) } : current);
      setAiStatus("Letzte Bearbeitung rückgängig gemacht.");
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }

  async function submitAi(instruction: string) {
    const summary = selected ? (workspace?.blocks ?? []).find(block => block.id === selected) : undefined;
    const view = selected ? views[selected] : undefined;
    const revision = view?.revision;
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
      setWorkspace(current => current ? { ...current, blocks: current.blocks.map(block => block.id === selected ? next.block : block) } : current);
      setAiPrompt(""); setAiStatus(result.summary);
    } catch (error) { setError(message(error)); }
    finally { setAiBusy(false); }
  }

  const blocks = useMemo(() => (workspace?.blocks ?? []).filter(block => block.included), [workspace]);
  const groups = useMemo(() => groupContentBlocks(blocks, pipeline.units), [blocks, pipeline.units]);
  const stale = blocks.filter(block => block.stale).length;
  const selectedSummary = blocks.find(block => block.id === selected);
  const selectedView = selected ? views[selected] : undefined;
  const originalUrl = selectedSummary ? originalMaterialUrl(selectedSummary) : undefined;
  const isPdf = selectedSummary?.mimeType === "application/pdf" && !!originalUrl;
  const activeSourcePage = hoveredSourcePage ?? sourcePage;
  const selectedPlacement = selectedSummary?.placements[0];
  const selectedUnit = selectedPlacement ? pipeline.units.find(unit => unit.id === selectedPlacement.unitId) : undefined;
  const aiContextLabel = selectedSummary ? [selectedSummary.name, selectionText ? "Auswahl" : selectedUnit ? unitLabel(selectedUnit) : undefined, sourcePage ? `Seite ${sourcePage}` : undefined].filter(Boolean).join(" · ") : "Block auswählen";
  const aiProviderOptions = [
    { id: "codex", label: "Codex", selected: aiProvider === "codex" },
    { id: "chatgpt", label: "ChatGPT", selected: aiProvider === "chatgpt" },
  ];

  if (loading) return <div className="content-authoring-loading"><Loading label="Editierbare Inhalte werden gelesen …" /></div>;

  return <div className="content-authoring" data-mode={surfaceMode}>
    <header className="content-authoring-head">
      <div className="content-authoring-title">
        <strong>Inhalt</strong>
        <span>{saving ? "Speichert…" : draft !== savedDraft && selected ? "Nicht gespeichert" : "Gespeichert"}</span>
        {stale > 0 && <span className="content-authoring-warning"><AlertTriangle size={13}/>{stale} Quelle{stale === 1 ? "" : "n"} aktualisiert</span>}
      </div>
      <div className="content-authoring-actions">
        <div className="content-mode-switch" role="group" aria-label="Inhaltsansicht">
          <button type="button" aria-pressed={surfaceMode === "edit"} onClick={() => setSurfaceMode("edit")}><PencilLine size={14}/>Bearbeiten</button>
          <button type="button" aria-pressed={surfaceMode === "review"} onClick={() => setSurfaceMode("review")}><GitCompareArrows size={14}/>Review</button>
        </div>
        <Button size="sm" variant="ghost" icon="refresh" label={blocks.length ? "Inhalte aktualisieren" : "Rohfassung erstellen"} disabled={busy || !canMaterialize} onPress={() => void refresh()}/>
      </div>
    </header>

    {error && <Notice>{error}</Notice>}
    {!blocks.length ? <div className="content-authoring-empty">
      <p>{contentCandidateCount === 0
        ? pipeline.pending > 0
          ? `${pipeline.pending} Quellen sind noch offen. Bestätige in der Struktur zuerst mindestens eine Quellenzuordnung.`
          : "Keine bestätigte Quelle ist einer sichtbaren Lerneinheit zugeordnet."
        : "Noch keine editierbare Rohfassung aus der bestätigten Struktur."}</p>
      <Button label="Rohfassung erstellen" disabled={busy || !canMaterialize} onPress={() => void refresh()}/>
    </div> : <div className="content-block-list">
      {groups.map(group => <section className="content-unit-group" key={group.unitId}>
        <h2>{group.unit ? unitLabel(group.unit) : "Weitere Inhalte"}</h2>
        <div className="content-unit-blocks">
      {group.blocks.map(block => {
        const active = block.id === selected;
        const highlighted = block.id === hovered || active;
        const unit = group.unit;
        const cached = views[block.id];
        const preview = cached?.revision?.content;
        return <section key={block.id} className="content-source-block" data-active={active || undefined} data-highlighted={highlighted || undefined} data-review={surfaceMode === "review" || undefined}
          onMouseEnter={() => setHovered(block.id)} onMouseLeave={() => setHovered(current => current === block.id ? undefined : current)}>
          <button type="button" className="content-source-head" onClick={() => void openBlock(block.id)} aria-pressed={active}>
            <Icon.File filename={block.name} size={16}/>
            <span className="content-source-name">{block.name}</span>
            {surfaceMode === "review" && unit && <span className="content-source-unit">{unitLabel(unit)}</span>}
            {sourcePages(block) && <span className="content-source-pages">{sourcePages(block)}</span>}
            <span className={`content-source-status${block.stale ? " stale" : ""}`}>{block.status === "ready" ? <Check size={13}/> : block.stale ? <AlertTriangle size={13}/> : null}{statusLabel(block)}</span>
          </button>

          {!active ? <button type="button" className="content-block-preview" onClick={() => void openBlock(block.id)}>
            {preview ? <MarkdownRenderer value={preview}/> : <span className="content-preview-placeholder">{block.currentRevisionId ? "Zum Bearbeiten öffnen" : block.observedMaterialRevision ? "Rohfassung beim Aktualisieren erstellen" : "Quelle noch nicht extrahiert"}</span>}
          </button> : <div className="content-block-active" ref={activeBlockRef}>
            {surfaceMode === "review" && <div className="content-block-tabs" role="tablist" aria-label={`${block.name} Ansicht`}>
              <button type="button" role="tab" aria-selected={blockMode === "edited"} onClick={() => setBlockMode("edited")}>Bearbeitet</button>
              <button type="button" role="tab" aria-selected={blockMode === "pdf"} disabled={!isPdf} onClick={() => setBlockMode("pdf")}>PDF</button>
              <button type="button" role="tab" aria-selected={blockMode === "compare"} disabled={!isPdf} onClick={() => setBlockMode("compare")}>Vergleich</button>
            </div>}

            {!selectedView && block.currentRevisionId ? <Loading label="Block wird geöffnet …"/> : !selectedView?.revision ? <div className="content-preview-placeholder">Für diese Quelle gibt es noch keine editierbare Rohfassung.</div> : blockMode === "edited" || surfaceMode === "edit" ? <>
              <MarkdownEditor value={draft} onChange={setDraft} minHeight={320}/>
              <div className="content-block-footer">
                <span>{saving ? "Speichert…" : draft === savedDraft ? `Revision ${selectedView.revision.id.slice(0, 8)}` : "Änderungen werden automatisch gespeichert"}</span>
                <Button size="sm" variant="ghost" label="Auf Original zurücksetzen" disabled={busy || saving || !selectedView.revision} onPress={() => void reset()}/>
              </div>
            </> : blockMode === "pdf" && originalUrl ? <div className="content-pdf-viewer">
              <PdfViewer source={originalUrl} title={block.name} initialPage={block.placements[0]?.firstPage ?? 1} page={activeSourcePage} onPageChange={setSourcePage} customize={{className:"h-[68vh] min-h-[32rem]",reason:"Review the preserved source beside authored Study Space content"}}/>
            </div> : blockMode === "compare" && originalUrl ? <>
              <div className="content-compare-mobile-switch" role="group" aria-label="Vergleichsansicht">
                <button type="button" aria-pressed={comparePane === "pdf"} onClick={() => setComparePane("pdf")}>Original</button>
                <button type="button" aria-pressed={comparePane === "current"} onClick={() => setComparePane("current")}>Aktuell</button>
              </div>
              <div className="content-compare">
                <div className="content-compare-pane content-compare-pdf" data-mobile-visible={comparePane === "pdf" || undefined}>
                  <div className="content-compare-label">Original PDF</div>
                  <PdfViewer source={originalUrl} title={block.name} initialPage={block.placements[0]?.firstPage ?? 1} page={activeSourcePage} onPageChange={setSourcePage} customize={{className:"h-[68vh] min-h-[32rem]",reason:"Compare preserved source with current rendered Study Space content"}}/>
                </div>
                <div className="content-compare-pane content-compare-current" data-mobile-visible={comparePane === "current" || undefined}>
                  <div className="content-compare-label">Aktueller Stand</div>
                  <div className="content-current-render"><ProvenancePreview content={draft} view={selectedView} activePage={activeSourcePage} onHoverPage={setHoveredSourcePage} onPinPage={setSourcePage}/></div>
                </div>
              </div>
            </> : null}
          </div>}
        </section>;
      })}
        </div>
      </section>)}
    </div>}
    {selectedSummary && selectedView?.revision ? <div className="content-ai-wrap">
      {aiStatus ? <div className="content-ai-status" role="status"><span>{aiStatus}</span><div><Button size="sm" variant="ghost" label="Review" onPress={() => { setSurfaceMode("review"); setBlockMode(isPdf ? "compare" : "edited"); }}/><Button size="sm" variant="ghost" label="Rückgängig" disabled={busy || saving || aiBusy || !selectedView.revision?.parentRevisionId} onPress={() => void undo()}/></div></div> : null}
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
