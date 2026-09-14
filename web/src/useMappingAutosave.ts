import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { MappingItem, PipelineState } from "./pipeline-api";
import { MappingAutosave } from "./mapping-autosave";

export function useMappingAutosave(courseId:number,state:PipelineState,onState:(state:PipelineState)=>void){
  const autosave=useMemo(()=>new MappingAutosave(courseId,state,onState,typeof window!=="undefined"?window.localStorage:undefined),[courseId]);
  const snapshot=useSyncExternalStore(autosave.subscribe,autosave.getSnapshot,autosave.getSnapshot);
  useEffect(()=>{autosave.start();return()=>autosave.stop();},[autosave]);
  useEffect(()=>autosave.accept(state),[autosave,state]);
  return {snapshot,enqueue:(items:MappingItem[])=>autosave.enqueue(items),flush:()=>autosave.flush(),accept:(next:PipelineState)=>autosave.accept(next),retry:()=>autosave.retry(),resolve:(next:PipelineState,keepLocal:boolean)=>autosave.resolve(next,keepLocal)};
}
