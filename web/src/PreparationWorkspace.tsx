import "./preparation-workspace.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, ListTree, PanelLeftOpen, PanelRightOpen, PencilLine } from "lucide-react";
import type { PipelineSourceView, PipelineState, PipelineUnit } from "./pipeline-api";
import { unitHidden, unitKind } from "./learning-structure";
import type { StructureSave } from "./structure-autosave";
import { ContentAuthoringView, type ContentSelection, type ContentTocItem } from "./ContentAuthoringView";
import { DialogShell } from "./DialogShell";
import { AuthoringExplorer } from "./AuthoringExplorer";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

const EXPLORER_WIDTH_KEY = "study-space:authoring-explorer-width";

function initialExplorerWidth() {
  if (typeof window === "undefined") return 320;
  const value = Number(window.localStorage.getItem(EXPLORER_WIDTH_KEY));
  return Number.isFinite(value) && value >= 240 && value <= 560 ? value : 320;
}

export function PreparationWorkspace({
  courseId,
  courseName,
  state,
  busy,
  onSave,
  onState,
  onFocus: _onFocus,
  onGuard,
  onRefresh,
}: {
  courseId: number;
  courseName: string;
  state: PipelineState;
  busy: boolean;
  onSave: StructureSave;
  onState: (state: PipelineState) => void;
  onFocus: () => void;
  onGuard?: (guard: (() => Promise<boolean>) | null) => void;
  onRefresh: () => Promise<PipelineState | undefined> | void;
}) {
  const firstUnit = useMemo(() => state.units
    .filter(unit => unitKind(unit) === "script" && unit.parentId === null && !unitHidden(unit, state.units))
    .sort((a, b) => a.order - b.order)[0], [state.units]);
  const [selection, setSelection] = useState<ContentSelection>({ kind: "script" });
  const [editing, setEditing] = useState(false);
  const [toc, setToc] = useState<ContentTocItem[]>([]);
  const [activeToc, setActiveToc] = useState<string>();
  const [tocOpen, setTocOpen] = useState(false);
  const [collapsedToc, setCollapsedToc] = useState<Set<string>>(() => new Set());
  const [explorerWidth, setExplorerWidth] = useState(initialExplorerWidth);
  const [explorerCollapsed, setExplorerCollapsed] = useState(false);
  const [viewCollapsed, setViewCollapsed] = useState(false);
  const updateToc = useCallback((items: ContentTocItem[]) => setToc(items), []);

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(EXPLORER_WIDTH_KEY, String(explorerWidth));
  }, [explorerWidth]);

  useEffect(() => {
    onGuard?.(null);
    return () => onGuard?.(null);
  }, [onGuard]);

  useEffect(() => {
    if (selection.kind === "unit" && !state.units.some(unit => unit.id === selection.id && !unitHidden(unit, state.units))) {
      setSelection(editing && firstUnit ? { kind: "unit", id: firstUnit.id } : { kind: "script" });
    }
    if (selection.kind === "source" && !state.sources.some(item => item.source.id === selection.id && item.source.present)) {
      setSelection({ kind: "script" });
    }
  }, [editing, firstUnit, selection, state.sources, state.units]);

  useEffect(() => {
    if (editing || !toc.length) { setActiveToc(undefined); return; }
    const update = () => {
      let active = toc[0]?.id;
      for (const item of toc) {
        const element = document.getElementById(item.id);
        if (!element) continue;
        if (element.getBoundingClientRect().top <= 140) active = item.id;
        else break;
      }
      setActiveToc(active);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [editing, toc]);

  function toggleEditing() {
    setEditing(current => {
      const next = !current;
      setTocOpen(false);
      setSelection({ kind: "script" });
      if (!next) {
        setExplorerCollapsed(false);
        setViewCollapsed(false);
      }
      return next;
    });
  }

  function navigateToc(item: ContentTocItem, close = false) {
    const element = document.getElementById(item.id);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveToc(item.id);
    if (close) setTocOpen(false);
  }

  function toggleToc(item: ContentTocItem) {
    setCollapsedToc(current => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }

  function tocList(close = false) {
    if (!toc.length) return <p>Noch keine Überschriften.</p>;
    let collapsedLevel: number | undefined;
    return <nav className="preparation-toc-nav"><ol>{toc.map((item, index) => {
      if (collapsedLevel !== undefined && item.level > collapsedLevel) return null;
      if (collapsedLevel !== undefined && item.level <= collapsedLevel) collapsedLevel = undefined;
      const hasChildren = (toc[index + 1]?.level ?? item.level) > item.level;
      const collapsed = hasChildren && collapsedToc.has(item.id);
      if (collapsed) collapsedLevel = item.level;
      return <li key={item.id} data-level={item.level} data-active={activeToc === item.id || undefined}>
        <div className="flex min-w-0 items-center gap-0.5">
          {hasChildren ? <button
            type="button"
            className="grid size-5 shrink-0 place-items-center rounded text-text-muted transition-colors hover:bg-bg-1 hover:text-text focus-visible:outline-2 focus-visible:outline-focus-ring"
            aria-label={item.label + " " + (collapsed ? "aufklappen" : "einklappen")}
            aria-expanded={!collapsed}
            onClick={() => toggleToc(item)}
          >{collapsed ? <ChevronRight size={13}/> : <ChevronDown size={13}/>}</button> : <span className="block size-5 shrink-0" aria-hidden="true"/>}
          <a
            href={"#" + item.id}
            className="min-w-0 flex-1"
            onClick={(event) => {
              event.preventDefault();
              navigateToc(item, close);
            }}
          >{item.label}</a>
        </div>
      </li>;
    })}</ol></nav>;
  }

  const selectSource = (item: PipelineSourceView, unitId?: string) => setSelection({ kind: "source", id: item.source.id, unitId });
  const selectUnit = (unit: PipelineUnit) => setSelection({ kind: "unit", id: unit.id });

  function beginResize(event: import("react").PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = explorerWidth;
    const move = (next: PointerEvent) => {
      const width = Math.min(560, Math.max(240, startWidth + next.clientX - startX));
      setExplorerWidth(width);
    };
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  return <section className="preparation-workspace" data-editing={editing || undefined}>
    <header className="preparation-workspace-head">
      <div className="preparation-workspace-actions">
        {!editing && toc.length > 0 && <button type="button" className="preparation-toc-mobile-button" onClick={() => setTocOpen(true)}><ListTree size={14}/><span>Inhaltsverzeichnis</span></button>}
        <button type="button" className="preparation-edit-toggle" aria-pressed={editing} onClick={toggleEditing}>
          {editing ? <Check size={14}/> : <PencilLine size={14}/>}<span>{editing ? "Fertig" : "Bearbeiten"}</span>
        </button>
      </div>
    </header>

    {editing ? <div className="relative flex h-[min(76vh,58rem)] min-h-[42rem] min-w-0 overflow-hidden rounded-[.65rem] border border-border bg-bg-0 max-[800px]:h-auto max-[800px]:min-h-0 max-[800px]:flex-col max-[800px]:overflow-visible">
      {explorerCollapsed ? <div className="absolute top-0 left-0 z-20 flex h-[3.35rem] w-[2.7rem] items-center justify-center bg-transparent max-[800px]:relative max-[800px]:h-[2.15rem] max-[800px]:w-full max-[800px]:flex-[0_0_2.15rem] max-[800px]:border-b max-[800px]:border-border">
        <button type="button" className="grid size-[1.7rem] place-items-center rounded-[.35rem] text-text-muted transition-colors hover:bg-bg-1 hover:text-text" onClick={() => { setExplorerCollapsed(false); setViewCollapsed(false); }} title="Explorer öffnen" aria-label="Explorer öffnen"><PanelLeftOpen size={15}/></button>
      </div> : <aside
        className={cx(
          "min-w-0 flex-none overflow-hidden bg-bg-0 max-[800px]:w-full max-[800px]:max-h-[22rem] max-[800px]:border-b max-[800px]:border-border",
          viewCollapsed && "flex-1 [&_.authoring-explorer-header]:pr-[3.25rem]",
        )}
        style={{ width: viewCollapsed ? "auto" : explorerWidth }}
      >
        <AuthoringExplorer
          courseId={courseId}
          state={state}
          selection={selection}
          refreshing={busy}
          onRefresh={() => { void onRefresh(); }}
          onSelectScript={() => setSelection({ kind: "script" })}
          onSelectUnit={selectUnit}
          onSelectSource={selectSource}
          onSave={onSave}
          onState={onState}
          disabled={busy}
          onCollapse={() => { setExplorerCollapsed(true); setViewCollapsed(false); }}
        />
      </aside>}

      {!explorerCollapsed && !viewCollapsed && <div className="group relative z-[5] w-[5px] flex-[0_0_5px] cursor-col-resize touch-none bg-transparent max-[800px]:hidden" role="separator" aria-orientation="vertical" aria-label="Explorer-Breite ändern" onPointerDown={beginResize}><span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-[width,background-color] group-hover:w-[3px] group-hover:bg-[color-mix(in_srgb,var(--color-text-muted)_52%,var(--color-border))]"/></div>}

      {viewCollapsed ? <div className="absolute top-0 right-0 z-20 flex h-[3.35rem] w-[2.7rem] items-center justify-center bg-transparent max-[800px]:relative max-[800px]:h-[2.15rem] max-[800px]:w-full max-[800px]:flex-[0_0_2.15rem] max-[800px]:border-b max-[800px]:border-border">
        <button type="button" className="grid size-[1.7rem] place-items-center rounded-[.35rem] text-text-muted transition-colors hover:bg-bg-1 hover:text-text" onClick={() => { setViewCollapsed(false); setExplorerCollapsed(false); }} title="View öffnen" aria-label="View öffnen"><PanelRightOpen size={15}/></button>
      </div> : <main className={cx(
        "min-w-0 flex-1 overflow-auto bg-bg-0",
        explorerCollapsed && "[&_.content-authoring-header]:pl-[3.7rem]",
      )} aria-label="Inhalt">
        <ContentAuthoringView
          courseId={courseId}
          courseName={courseName}
          pipeline={state}
          selection={selection}
          editing
          onSelectSource={(id, unitId) => setSelection({ kind: "source", id, unitId })}
          onTocChange={updateToc}
          onCollapseView={() => { setViewCollapsed(true); setExplorerCollapsed(false); }}
          onRefreshPipeline={onRefresh}
        />
      </main>}
    </div> : <div className="preparation-workspace-panels mx-auto w-full max-w-[112rem]">
      <main className="preparation-content-panel" aria-label="Inhalt">
        <ContentAuthoringView
          courseId={courseId}
          courseName={courseName}
          pipeline={state}
          selection={selection}
          editing={false}
          onSelectSource={(id, unitId) => setSelection({ kind: "source", id, unitId })}
          onTocChange={updateToc}
        />
      </main>
      <aside className="preparation-toc-panel" aria-label="Inhaltsverzeichnis">
        <div className="preparation-toc-sticky">
          <h2>Inhaltsverzeichnis</h2>
          {tocList()}
        </div>
      </aside>
    </div>}
    {tocOpen && <DialogShell title="Inhaltsverzeichnis" onClose={() => setTocOpen(false)}><div className="preparation-toc-dialog">{tocList(true)}</div></DialogShell>}
  </section>;
}
