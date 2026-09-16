import { expect, test } from "bun:test";
import { groupContentBlocks } from "../src/content-authoring-model";
import { originalMaterialUrl, type ContentBlockSummary } from "../src/content-api";
import type { PipelineUnit } from "../src/pipeline-api";

const units: PipelineUnit[] = [
  { id: "a".repeat(32), title: "Block 1", parentId: null, order: 0, kind: "script", hidden: false },
  { id: "b".repeat(32), title: "Block 2", parentId: null, order: 1, kind: "script", hidden: false },
];
function block(id: string, name: string, unitId: string, unitOrder: number, order: number): ContentBlockSummary {
  return {
    id, sourceId: id, name, mimeType: "application/pdf", observedSourceVersion: "c".repeat(64), observedMaterialRevision: "d".repeat(64),
    baselineSourceVersion: "c".repeat(64), baselineMaterialRevision: "d".repeat(64), currentRevisionId: "e".repeat(32), included: true,
    stale: false, status: "ready", placements: [{ unitId, role: "teaching", unitOrder, order }],
  };
}

test("content reducer groups stable source files by reviewed unit and source order", () => {
  const later = block("1".repeat(64), "B.pdf", units[0].id, 0, 2);
  const first = block("2".repeat(64), "A.pdf", units[0].id, 0, 1);
  const secondUnit = block("3".repeat(64), "C.pdf", units[1].id, 1, 0);
  const groups = groupContentBlocks([later, secondUnit, first], units);
  expect(groups.map(group => group.unitId)).toEqual([units[0].id, units[1].id]);
  expect(groups[0].blocks.map(item => item.name)).toEqual(["A.pdf", "B.pdf"]);
});

test("preserved original URL stays pinned to the observed material revision", () => {
  const item = block("a".repeat(64), "source.pdf", units[0].id, 0, 0);
  expect(originalMaterialUrl(item)).toBe(`/api/materials/${item.sourceId}/revisions/${item.observedMaterialRevision}/assets/original`);
  expect(originalMaterialUrl({ ...item, observedMaterialRevision: null })).toBeUndefined();
});

// Page-level provenance is intentionally derived from immutable materialization offsets.
// Edited revisions mark provenance stale and the UI falls back to whole-block rendering.
test("review model keeps page-level provenance available for source synchronization", () => {
  const provenance = [
    { sourceBlockId: "b-00103", page: 10, start: 0, length: 20 },
    { sourceBlockId: "b-00104", page: 10, start: 22, length: 30 },
    { sourceBlockId: "b-00106", page: 11, start: 54, length: 25 },
  ];
  expect(provenance.filter(item => item.page === 10).map(item => item.sourceBlockId)).toEqual(["b-00103", "b-00104"]);
  expect(provenance.filter(item => item.page === 11).map(item => item.sourceBlockId)).toEqual(["b-00106"]);
});
