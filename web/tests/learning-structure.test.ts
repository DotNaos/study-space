import { expect, test } from "bun:test";
import { moveKind, moveParent, orderedSiblings, reorderUnits, unitHidden, unitLabel } from "../src/learning-structure";
import type { PipelineUnit } from "../src/pipeline-api";
const units: PipelineUnit[] = [
  {id:"a",title:"Original A",customTitle:"Introduction",kind:"script",parentId:null,order:0},
  {id:"b",title:"Original B",kind:"script",parentId:null,order:1},
  {id:"c",title:"Child",kind:"script",parentId:"a",order:0},
  {id:"t",title:"Task",kind:"tasks",parentId:null,order:0,scriptUnitIds:["a"]},
];
test("display labels preserve the original title and can be reset", () => {
  expect(unitLabel(units[0])).toBe("Introduction");
  expect(units[0].title).toBe("Original A");
  expect(unitLabel({...units[0],customTitle:null})).toBe("Original A");
});
test("drag reorders only siblings, retaining all children and task links", () => {
  const next=reorderUnits(units,"a","b");
  expect(orderedSiblings(next,"script",null).map(u=>u.id)).toEqual(["b","a"]);
  expect(next.find(u=>u.id==="c")?.parentId).toBe("a");
  expect(next.find(u=>u.id==="t")?.scriptUnitIds).toEqual(["a"]);
  expect(reorderUnits(units,"a","t")).toBe(units);
  expect(reorderUnits(units,"a","c")).toBe(units);
  expect(orderedSiblings(units,"script",null).map(u=>u.id)).toEqual(["a","b"]);
});
test("hidden parents suppress descendants without deleting anything", () => {
  const hidden=units.map(u=>u.id==="a"?{...u,hidden:true}:u);
  expect(unitHidden(hidden[2],hidden)).toBe(true);
  expect(unitHidden(hidden[3],hidden)).toBe(false);
  expect(hidden).toHaveLength(units.length);
  const restored=hidden.map(u=>({...u,hidden:false}));
  expect(restored.every(u=>!unitHidden(u,restored))).toBe(true);
});
test("task groups and script hierarchy cannot become mixed or cyclic", () => {
  expect(moveParent(units,"a","c")).toBe(units);
  expect(moveParent(units,"b","t")).toBe(units);
  const moved=moveKind(units,"c","tasks");
  const child=moved.find(u=>u.id==="c")!;
  expect(child.kind).toBe("tasks");
  expect(child.parentId).toBeNull();
  expect(child.scriptUnitIds).toEqual(["a"]);
  expect(child.title).toBe("Child");
});
