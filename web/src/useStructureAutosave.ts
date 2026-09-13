import { useEffect, useState, useSyncExternalStore } from "react";
import { StructureAutosave, type StructureSave } from "./structure-autosave";
import { readPipeline, type PipelineState } from "./pipeline-api";

export function useStructureAutosave(state: PipelineState, save: StructureSave, onGuard?: (guard: (() => Promise<boolean>) | null) => void) {
  const [queue] = useState(() => {
    let storage: Storage | undefined;
    try { storage = window.sessionStorage; } catch { /* Browser storage may be unavailable. */ }
    return new StructureAutosave(state, save, storage);
  });
  const draft = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  useEffect(() => { queue.accept(state); }, [queue, state]);
  useEffect(() => {
    queue.start();
    onGuard?.(() => queue.flush());
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (queue.dirty) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { window.removeEventListener("beforeunload", beforeUnload); onGuard?.(null); queue.stop(); };
  }, [queue, onGuard]);
  return { ...draft, queue, retry: async () => {
    try {
      const remote = await readPipeline(state.courseId);
      queue.accept(remote);
      await queue.flush();
    } catch { /* Retain the original failure and its unsaved draft. */ }
  } };
}
