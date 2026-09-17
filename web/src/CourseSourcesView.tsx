import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Icon } from "@dotnaos/ui-base";
import { RotateCcw } from "lucide-react";
import { api, message } from "./api";
import { DialogShell } from "./DialogShell";
import { MaterialPreparation } from "./MaterialPreparation";
import type { MaterialState } from "./material-api";
import { pipelinePath, readPipeline, type PipelineSourceView, type PipelineState } from "./pipeline-api";
import type { SourceSelection } from "./SourceViewer";
import { StructurePicker } from "./StructurePicker";
import { unitHidden } from "./learning-structure";
import { Loading, Notice } from "./shared";
import { currentUse, placementPath, placementRole, placementUnits, sourcePlacement } from "./source-placement";

export function CourseSourcesView({
  courseId,
  materials,
  connected,
  onSource,
  onGraph,
}: {
  courseId: number;
  materials: MaterialState;
  connected: boolean;
  onSource: (source: SourceSelection) => void;
  onGraph: () => void;
}) {
  const [state, setState] = useState<PipelineState>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string>();
  const [editing, setEditing] = useState<PipelineSourceView>();

  const load = useCallback(async () => {
    try {
      setState(await readPipeline(courseId));
      setError("");
    } catch (error) {
      setError(message(error));
    }
  }, [courseId]);

  useEffect(() => { void load(); }, [load]);

  const units = useMemo(() => state ? placementUnits(state) : [], [state]);
  const visibleUnits = useMemo(() => units.filter(unit => !unitHidden(unit, units)), [units]);

  async function syncInventory() {
    if (!state || busy) return;
    setBusy("__sync");
    setError("");
    try {
      setState(await api<PipelineState>(`${pipelinePath(courseId)}/sync`, {
        method: "POST",
        body: JSON.stringify({ expectedRevision: state.revision }),
      }));
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function update(item: PipelineSourceView, disposition: "use" | "exclude" | "clear", unitId?: string) {
    if (!state || busy) return;
    setBusy(item.source.id);
    setError("");
    try {
      const target = unitId ? units.find(unit => unit.id === unitId) : undefined;
      const existing = currentUse(item);
      const use = unitId ? {
        unitId,
        role: placementRole(item, target),
        firstPage: null,
        lastPage: null,
        relatedSourceId: existing?.role === "solution" ? existing.relatedSourceId ?? null : null,
        order: existing?.order ?? 0,
      } : undefined;
      const next = await api<PipelineState>(`${pipelinePath(courseId)}/mapping`, {
        method: "POST",
        body: JSON.stringify({
          expectedRevision: state.revision,
          items: [{
            sourceId: item.source.id,
            sourceVersion: item.source.sourceVersion,
            disposition,
            uses: use ? [use] : [],
          }],
          actor: "user",
          reason: disposition === "clear" ? "Quellenzuordnung auf Standard zurückgesetzt." : disposition === "exclude" ? "Quelle ausgeblendet." : "Quelle neu zugeordnet.",
        }),
      });
      setState(next);
      setEditing(undefined);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(undefined);
    }
  }

  return <div className="mt-5 space-y-5">
    <MaterialPreparation materials={materials} connected={connected} onSource={onSource} />
    <section aria-label="Quellenverzeichnis" className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2">
        <div>
          <h2 className="text-sm font-medium">Quellenverzeichnis</h2>
          <p className="mt-1 text-xs text-text-muted">Jede sichtbare Quelle gehört zu genau einem Struktur-Eintrag oder ist ausgeblendet.</p>
        </div>
        <div className="flex items-center gap-1"><Button size="sm" variant="ghost" icon="refresh" label="Aktualisieren" disabled={!!busy || !state} onPress={() => void syncInventory()}/><Button size="sm" variant="ghost" icon="git-branch" label="Graph" onPress={onGraph}/></div>
      </header>
      {error && <Notice>{error}</Notice>}
      {!state ? !error && <Loading label="Quellen werden geladen …"/> : <div className="overflow-x-auto">
        <table className="w-full min-w-[42rem] border-collapse text-sm">
          <thead><tr className="border-b border-border text-left text-xs text-text-muted"><th className="py-2 pr-4 font-medium">Quelle</th><th className="py-2 pr-4 font-medium">Zuordnung</th><th className="py-2 pr-4 font-medium">Status</th><th className="w-24 py-2 text-right font-medium">Aktion</th></tr></thead>
          <tbody>{state.sources.filter(item => item.source.present).map(item => {
            const placement = sourcePlacement(state, item);
            const current = placement.hidden ? "Ausgeblendet" : placementPath(units, placement.currentUnitId);
            const standard = placementPath(units, placement.defaultUnitId);
            const canOpen = !!item.source.materialRevision;
            const status = placement.unresolved ? "Nicht zugeordnet"
              : item.status === "stale" ? "Erneut prüfen"
              : item.status === "not-returned" ? "Nicht mehr verfügbar"
              : item.status === "partial" ? "Teilweise zugeordnet"
              : item.status === "structure-hidden" ? "Durch Struktur ausgeblendet"
              : placement.hidden ? "Ausgeblendet"
              : "Zugeordnet";
            return <tr key={item.source.id} className="border-b border-border/60 align-top">
              <td className="py-3 pr-4"><button type="button" disabled={!canOpen} className="flex max-w-md items-center gap-2 text-left disabled:cursor-default" onClick={() => item.source.materialRevision && onSource({materialId:item.source.id,revision:item.source.materialRevision,name:item.source.name})}><Icon.File filename={item.source.name} size={17}/><span className="break-words">{item.source.name}</span></button></td>
              <td className="py-3 pr-4"><div className="max-w-md break-words">{current}</div>{placement.overridden && <div className="mt-1 flex items-center gap-1 text-xs text-text-muted"><span>Standard: {standard}</span><button type="button" className="inline-flex rounded p-1 hover:bg-bg-1" title="Auf Standard zurücksetzen" aria-label={`${item.source.name} auf Standard zurücksetzen`} disabled={busy === item.source.id} onClick={() => void update(item,"clear")}><RotateCcw size={13}/></button></div>}</td>
              <td className="py-3 pr-4 text-xs text-text-muted">{status}</td>
              <td className="py-2 text-right"><Button size="sm" variant="ghost" label="Ändern" disabled={busy === item.source.id || !state.units.length} onPress={() => setEditing(item)}/></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
    </section>
    {editing && state && <DialogShell title="Quellenzuordnung" onClose={() => setEditing(undefined)}>
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-2 text-sm"><Icon.File filename={editing.source.name} size={18}/><span className="min-w-0 break-words">{editing.source.name}</span></div>
        <StructurePicker label="Zuordnung" units={visibleUnits} selected={sourcePlacement(state, editing).currentUnitId ? [sourcePlacement(state, editing).currentUnitId!] : []} emptyLabel="Nicht zugeordnet" disabled={!!busy} onChange={ids => ids[0] && void update(editing,"use",ids[0])}/>
        <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-3">
          <Button size="sm" variant="ghost" label="Auf Standard zurücksetzen" disabled={!!busy || !sourcePlacement(state,editing).defaultUnitId} onPress={() => void update(editing,"clear")}/>
          <Button size="sm" variant="secondary" label="Ausblenden" disabled={!!busy} onPress={() => void update(editing,"exclude")}/>
        </div>
      </div>
    </DialogShell>}
  </div>;
}
