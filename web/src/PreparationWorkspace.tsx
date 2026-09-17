import "./preparation-workspace.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ListTree, PanelLeftOpen, PanelRightOpen, PencilLine } from "lucide-react";
import type { PipelineSourceView, PipelineState, PipelineUnit } from "./pipeline-api";
import { unitHidden, unitKind } from "./learning-structure";
import type { StructureSave } from "./structure-autosave";
import { ContentAuthoringView, type ContentSelection, type ContentTocItem } from "./ContentAuthoringView";
import { DialogShell } from "./DialogShell";
import { AuthoringExplorer } from "./AuthoringExplorer";

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
  onSave: _onSave,
  onState: _onState,
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
  onRefresh: () => void;
}) {
  const firstUnit = useMemo(() => state.units
    .filter(unit => unitKind(unit) === "script" && unit.parentId === null && !unitHidden(unit, state.units))
    .sort((a, b) => a.order - b.order)[0], [state.units]);
  const [selection, setSelection] = useState<ContentSelection>({ kind: "script" });
  const [editing, setEditing] = useState(false);
  const [toc, setToc] = useState<ContentTocItem[]>([]);
  const [activeToc, setActiveToc] = useState<string>();
  const [tocOpen, setTocOpen] = useState(false);
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

  function tocList(close = false) {
    return toc.length ? <nav className="preparation-toc-nav"><ol>{toc.map(item => <li key={item.id} data-level={item.level} data-active={activeToc === item.id || undefined}><a href={`#${item.id}`} onClick={() => close && setTocOpen(false)}>{item.label}</a></li>)}</ol></nav> : <p>Noch keine Überschriften.</p>;
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
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.body.classList.remove("authoring-resizing");
    };
    document.body.classList.add("authoring-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  return <section className="preparation-workspace" data-editing={editing || undefined}>
    <header className="preparation-workspace-head">
      <div>
        <strong>Inhalt</strong>
        {editing && <span>{state.pending ? `${state.pending} Quellen offen` : "Struktur vollständig"}</span>}
      </div>
      <div className="preparation-workspace-actions">
        {!editing && toc.length > 0 && <button type="button" className="preparation-toc-mobile-button" onClick={() => setTocOpen(true)}><ListTree size={14}/><span>Inhaltsverzeichnis</span></button>}
        <button type="button" className="preparation-edit-toggle" aria-pressed={editing} onClick={toggleEditing}>
          {editing ? <Check size={14}/> : <PencilLine size={14}/>}<span>{editing ? "Fertig" : "Bearbeiten"}</span>
        </button>
      </div>
    </header>

    {editing ? <div className="preparation-authoring-shell">
      {explorerCollapsed ? <div className="preparation-collapsed-rail" data-side="left">
        <button type="button" className="preparation-panel-restore" onClick={() => { setExplorerCollapsed(false); setViewCollapsed(false); }} title="Explorer öffnen" aria-label="Explorer öffnen"><PanelLeftOpen size={15}/></button>
      </div> : <aside className="preparation-explorer-panel" style={{ width: viewCollapsed ? "auto" : explorerWidth }}>
        <AuthoringExplorer
          courseId={courseId}
          state={state}
          selection={selection}
          refreshing={busy}
          onRefresh={onRefresh}
          onSelectScript={() => setSelection({ kind: "script" })}
          onSelectUnit={selectUnit}
          onSelectSource={selectSource}
          onCollapse={() => { setExplorerCollapsed(true); setViewCollapsed(false); }}
        />
      </aside>}

      {!explorerCollapsed && !viewCollapsed && <div className="preparation-panel-splitter" role="separator" aria-orientation="vertical" aria-label="Explorer-Breite ändern" onPointerDown={beginResize}><span/></div>}

      {viewCollapsed ? <div className="preparation-collapsed-rail" data-side="right">
        <button type="button" className="preparation-panel-restore" onClick={() => { setViewCollapsed(false); setExplorerCollapsed(false); }} title="View öffnen" aria-label="View öffnen"><PanelRightOpen size={15}/></button>
      </div> : <main className="preparation-content-panel preparation-authoring-view" aria-label="Inhalt">
        <ContentAuthoringView
          courseId={courseId}
          courseName={courseName}
          pipeline={state}
          selection={selection}
          editing
          onSelectSource={(id, unitId) => setSelection({ kind: "source", id, unitId })}
          onTocChange={updateToc}
          onCollapseView={() => { setViewCollapsed(true); setExplorerCollapsed(false); }}
        />
      </main>}
    </div> : <div className="preparation-workspace-panels">
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
