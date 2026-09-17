import "./preparation-workspace.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ListTree, PencilLine } from "lucide-react";
import type { PipelineSourceView, PipelineState, PipelineUnit } from "./pipeline-api";
import { unitHidden, unitKind } from "./learning-structure";
import type { StructureSave } from "./structure-autosave";
import { PipelineStructure } from "./PipelineStructure";
import { ContentAuthoringView, type ContentSelection, type ContentTocItem } from "./ContentAuthoringView";
import { DialogShell } from "./DialogShell";

export function PreparationWorkspace({
  courseId,
  courseName,
  state,
  busy,
  onSave,
  onState,
  onFocus,
  onGuard,
}: {
  courseId: number;
  courseName: string;
  state: PipelineState;
  busy: boolean;
  onSave: StructureSave;
  onState: (state: PipelineState) => void;
  onFocus: () => void;
  onGuard?: (guard: (() => Promise<boolean>) | null) => void;
}) {
  const firstUnit = useMemo(() => state.units
    .filter(unit => unitKind(unit) === "script" && unit.parentId === null && !unitHidden(unit, state.units))
    .sort((a, b) => a.order - b.order)[0], [state.units]);
  const [selection, setSelection] = useState<ContentSelection>({ kind: "script" });
  const [editing, setEditing] = useState(false);
  const [toc, setToc] = useState<ContentTocItem[]>([]);
  const [activeToc, setActiveToc] = useState<string>();
  const [tocOpen, setTocOpen] = useState(false);
  const updateToc = useCallback((items: ContentTocItem[]) => setToc(items), []);

  useEffect(() => {
    if (selection.kind === "unit" && !state.units.some(unit => unit.id === selection.id && !unitHidden(unit, state.units))) {
      setSelection(editing && firstUnit ? { kind: "unit", id: firstUnit.id } : { kind: "script" });
    }
    if (selection.kind === "source" && !state.sources.some(item => item.source.id === selection.id && item.source.present)) {
      setSelection(editing && firstUnit ? { kind: "unit", id: firstUnit.id } : { kind: "script" });
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
      if (next && selection.kind === "script" && firstUnit) setSelection({ kind: "unit", id: firstUnit.id });
      if (!next) setSelection({ kind: "script" });
      return next;
    });
  }

  function tocList(close = false) {
    return toc.length ? <nav className="preparation-toc-nav"><ol>{toc.map(item => <li key={item.id} data-level={item.level} data-active={activeToc === item.id || undefined}><a href={`#${item.id}`} onClick={() => close && setTocOpen(false)}>{item.label}</a></li>)}</ol></nav> : <p>Noch keine Überschriften.</p>;
  }

  const selectSource = (item: PipelineSourceView, unitId?: string) => setSelection({ kind: "source", id: item.source.id, unitId });
  const selectUnit = (unit: PipelineUnit) => setSelection({ kind: "unit", id: unit.id });

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

    <div className="preparation-workspace-panels">
      <main className="preparation-content-panel" aria-label="Inhalt">
        <ContentAuthoringView
          courseId={courseId}
          courseName={courseName}
          pipeline={state}
          selection={selection}
          editing={editing}
          onSelectSource={(id, unitId) => setSelection({ kind: "source", id, unitId })}
          onTocChange={updateToc}
        />
      </main>
      {!editing && <aside className="preparation-toc-panel" aria-label="Inhaltsverzeichnis">
        <div className="preparation-toc-sticky">
          <h2>Inhaltsverzeichnis</h2>
          {tocList()}
        </div>
      </aside>}
      {editing && <aside className="preparation-structure-panel" aria-label="Struktur">
        <PipelineStructure
          state={state}
          busy={busy}
          onSave={onSave}
          onState={onState}
          onOpenSource={selectSource}
          onFocus={onFocus}
          onContent={() => {}}
          onGuard={onGuard}
          embedded
          editing
          allSelected={selection.kind === "script"}
          selectedUnitId={selection.kind === "unit" ? selection.id : undefined}
          selectedSourceId={selection.kind === "source" ? selection.id : undefined}
          onSelectAll={() => setSelection({ kind: "script" })}
          onSelectUnit={selectUnit}
        />
      </aside>}
    </div>
    {tocOpen && <DialogShell title="Inhaltsverzeichnis" onClose={() => setTocOpen(false)}><div className="preparation-toc-dialog">{tocList(true)}</div></DialogShell>}
  </section>;
}
