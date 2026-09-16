import "./content-authoring.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Icon } from "@dotnaos/ui-base";
import { MarkdownEditor, MarkdownRenderer } from "@dotnaos/ui/markdown-editor";
import { PdfViewer } from "@dotnaos/ui/pdf-viewer";
import { AlertTriangle, Check, GitCompareArrows, PencilLine } from "lucide-react";
import { message } from "./api";
import type { PipelineState } from "./pipeline-api";
import { unitLabel } from "./learning-structure";
import { groupContentBlocks } from "./content-authoring-model";
import {
  materializeContent,
  originalMaterialUrl,
  readContentBlock,
  readContentWorkspace,
  resetContentBlock,
  saveContentBlock,
  type ContentBlockSummary,
  type ContentBlockView,
  type ContentWorkspace,
} from "./content-api";
import { Loading, Notice } from "./shared";

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

export function ContentAuthoringView({ courseId, pipeline }: { courseId: number; pipeline: PipelineState }) {
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
  const [sourcePage, setSourcePage] = useState<number>();
  const [hoveredSourcePage, setHoveredSourcePage] = useState<number>();

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

  async function refresh() {
    if (busy) return;
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
    setSelected(id); setBlockMode("edited"); setComparePane("pdf"); setError(""); setHoveredSourcePage(undefined);
    const summary = workspace?.blocks.find(block => block.id === id);
    const cachedRevision = views[id]?.revision;
    const cachedPage = cachedRevision?.provenance.find(item => item.page != null)?.page ?? cachedRevision?.provenance.find(item => item.slide != null)?.slide ?? undefined;
    setSourcePage(summary?.placements[0]?.firstPage ?? cachedPage);
    if (!force && cachedRevision) {
      const content = cachedRevision.content ?? "";
      setDraft(content); setSavedDraft(content); return;
    }
    try {
      const view = await readContentBlock(courseId, id);
      setViews(current => ({ ...current, [id]: view }));
      const content = view.revision?.content ?? "";
      const loadedPage = view.revision?.provenance.find(item => item.page != null)?.page ?? view.revision?.provenance.find(item => item.slide != null)?.slide ?? undefined;
      setSourcePage(summary?.placements[0]?.firstPage ?? loadedPage);
      setDraft(content); setSavedDraft(content);
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

  const blocks = useMemo(() => (workspace?.blocks ?? []).filter(block => block.included), [workspace]);
  const groups = useMemo(() => groupContentBlocks(blocks, pipeline.units), [blocks, pipeline.units]);
  const stale = blocks.filter(block => block.stale).length;
  const selectedSummary = blocks.find(block => block.id === selected);
  const selectedView = selected ? views[selected] : undefined;
  const originalUrl = selectedSummary ? originalMaterialUrl(selectedSummary) : undefined;
  const isPdf = selectedSummary?.mimeType === "application/pdf" && !!originalUrl;
  const activeSourcePage = hoveredSourcePage ?? sourcePage;

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
        <Button size="sm" variant="ghost" icon="refresh" label={blocks.length ? "Inhalte aktualisieren" : "Rohfassung erstellen"} disabled={busy} onPress={() => void refresh()}/>
      </div>
    </header>

    {error && <Notice>{error}</Notice>}
    {!blocks.length ? <div className="content-authoring-empty">
      <p>Noch keine editierbare Rohfassung aus der bestätigten Struktur.</p>
      <Button label="Rohfassung erstellen" disabled={busy} onPress={() => void refresh()}/>
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
          </button> : <div className="content-block-active">
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
              <PdfViewer source={originalUrl} title={block.name} initialPage={block.placements[0]?.firstPage ?? 1} customize={{className:"h-[68vh] min-h-[32rem]",reason:"Review the preserved source beside authored Study Space content"}}/>
            </div> : blockMode === "compare" && originalUrl ? <>
              <div className="content-compare-mobile-switch" role="group" aria-label="Vergleichsansicht">
                <button type="button" aria-pressed={comparePane === "pdf"} onClick={() => setComparePane("pdf")}>Original</button>
                <button type="button" aria-pressed={comparePane === "current"} onClick={() => setComparePane("current")}>Aktuell</button>
              </div>
              <div className="content-compare">
                <div className="content-compare-pane content-compare-pdf" data-mobile-visible={comparePane === "pdf" || undefined}>
                  <div className="content-compare-label">Original PDF</div>
                  <PdfViewer source={originalUrl} title={block.name} initialPage={block.placements[0]?.firstPage ?? 1} customize={{className:"h-[68vh] min-h-[32rem]",reason:"Compare preserved source with current rendered Study Space content"}}/>
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
  </div>;
}
