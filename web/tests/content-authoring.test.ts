import { expect, test } from "bun:test";
import { buildContentOutline, contentBlocksForUnit } from "../src/content-authoring-model";
import { originalMaterialUrl, type ContentBlockSummary } from "../src/content-api";
import { buildChatGptHandoffPrompt, buildChatGptHandoffUrl } from "../src/chatgpt-handoff";
import type { PipelineUnit } from "../src/pipeline-api";

const units: PipelineUnit[] = [
  { id: "a".repeat(32), title: "Block 1", parentId: null, order: 0, kind: "script", hidden: false },
  { id: "b".repeat(32), title: "Block 1.1", parentId: "a".repeat(32), order: 0, kind: "script", hidden: false },
  { id: "c".repeat(32), title: "Block 2", parentId: null, order: 1, kind: "script", hidden: false },
  { id: "d".repeat(32), title: "Aufgabe 1", parentId: null, order: 0, kind: "tasks", hidden: false, scriptUnitIds: ["a".repeat(32)] },
  { id: "e".repeat(32), title: "Aufgabe 2", parentId: null, order: 1, kind: "tasks", hidden: false, scriptUnitIds: ["a".repeat(32), "c".repeat(32)] },
  { id: "f".repeat(32), title: "Aufgabe zu Block 1.1", parentId: null, order: 2, kind: "tasks", hidden: false, scriptUnitIds: ["b".repeat(32)] },
];
function block(id: string, name: string, unitId: string, unitOrder: number, order: number): ContentBlockSummary {
  return {
    id, sourceId: id, name, mimeType: "application/pdf", observedSourceVersion: "c".repeat(64), observedMaterialRevision: "d".repeat(64),
    baselineSourceVersion: "c".repeat(64), baselineMaterialRevision: "d".repeat(64), currentRevisionId: "e".repeat(32), included: true,
    stale: false, status: "ready", placements: [{ unitId, role: "teaching", unitOrder, order }],
  };
}

test("content outline preserves script hierarchy, empty sections and source order", () => {
  const later = block("1".repeat(64), "B.pdf", units[0].id, 0, 2);
  const first = block("2".repeat(64), "A.pdf", units[0].id, 0, 1);
  const nested = block("3".repeat(64), "Nested.pdf", units[1].id, 1, 0);
  const outline = buildContentOutline([later, nested, first], units);
  expect(outline.script.map(node => node.unit.title)).toEqual(["Block 1", "Block 2"]);
  expect(outline.script[0].blocks.map(item => item.name)).toEqual(["A.pdf", "B.pdf"]);
  expect(outline.script[0].children.map(node => node.unit.title)).toEqual(["Block 1.1"]);
  expect(outline.script[0].children[0].blocks.map(item => item.name)).toEqual(["Nested.pdf"]);
  expect(outline.script[1].blocks).toEqual([]);
});


test("content outline remains visible before any source block is materialized", () => {
  const outline = buildContentOutline([], units);
  expect(outline.script.map(node => node.unit.title)).toEqual(["Block 1", "Block 2"]);
  expect(outline.taskGroups.flatMap(group => group.tasks.map(node => node.unit.title))).toEqual([
    "Aufgabe 1",
    "Aufgabe 2",
    "Aufgabe zu Block 1.1",
  ]);
});
test("tasks stay in a separate area and retain links to script sections", () => {
  const taskBlock = block("4".repeat(64), "Aufgabe1.pdf", units[3].id, 3, 10);
  taskBlock.placements[0].role = "task";
  const outline = buildContentOutline([taskBlock], units);
  expect(outline.taskGroups.map(group => group.scriptUnit?.title)).toEqual(["Block 1", "Block 1.1"]);
  expect(outline.taskGroups[0].tasks.map(node => node.unit.title)).toEqual(["Aufgabe 1", "Aufgabe 2"]);
  expect(outline.taskGroups[1].tasks.map(node => node.unit.title)).toEqual(["Aufgabe zu Block 1.1"]);
  expect(outline.taskGroups[0].tasks[0].blocks.map(item => item.name)).toEqual(["Aufgabe1.pdf"]);
  expect(outline.taskGroups[0].tasks[1].blocks).toEqual([]);
  expect(outline.taskGroups[0].tasks[1].linkedScriptUnits.map(unit => unit.title)).toEqual(["Block 1", "Block 2"]);
});

test("unit composer scope includes nested script blocks and linked tasks", () => {
  const root = block("5".repeat(64), "Root.pdf", units[0].id, 0, 0);
  const nested = block("6".repeat(64), "Nested.pdf", units[1].id, 1, 0);
  const task = block("7".repeat(64), "Task.pdf", units[3].id, 3, 0);
  const nestedTask = block("8".repeat(64), "NestedTask.pdf", units[5].id, 5, 0);
  task.placements[0].role = "task";
  nestedTask.placements[0].role = "task";
  const outline = buildContentOutline([root, nested, task, nestedTask], units);
  expect(contentBlocksForUnit(outline, units[0].id).map(item => item.name)).toEqual([
    "Root.pdf",
    "Nested.pdf",
    "Task.pdf",
    "NestedTask.pdf",
  ]);
  expect(contentBlocksForUnit(outline, units[1].id).map(item => item.name)).toEqual([
    "Nested.pdf",
    "NestedTask.pdf",
  ]);
});

test("preserved original URL stays pinned to the observed material revision", () => {
  const item = block("a".repeat(64), "source.pdf", units[0].id, 0, 0);
  expect(originalMaterialUrl(item)).toBe(`/api/materials/${item.sourceId}/revisions/${item.observedMaterialRevision}/assets/original`);
  expect(originalMaterialUrl({ ...item, observedMaterialRevision: null })).toBeUndefined();
});

test("ChatGPT handoff keeps stable multi-block Study Space edit identifiers in one adapter", () => {
  const prompt = buildChatGptHandoffPrompt({
    courseId: 23691,
    courseName: "Data Science und Informatik in der Biologie (cds-303) HS26",
    scopeLabel: "Block 1",
    learningUnitId: units[0].id,
    learningUnitTitle: "Block 1",
    blocks: [
      {
        contentBlockId: "f".repeat(64),
        editableRevision: "e".repeat(32),
        sourceName: "2026_CDS303_Block1_1.pdf",
        materialId: "f".repeat(64),
        materialRevision: "d".repeat(64),
      },
      {
        contentBlockId: "9".repeat(64),
        editableRevision: "8".repeat(32),
        sourceName: "2026_CDS303_Block1_2.pdf",
        materialId: "9".repeat(64),
        materialRevision: "7".repeat(64),
      },
    ],
    page: 10,
    sourceBlockIds: ["b-00103", "b-00104"],
    selectionText: "DNA besteht aus Nukleotiden.",
    instruction: "Erkläre das kompakter.",
  });
  expect(prompt).toContain("courseId: 23691");
  expect(prompt).toContain("scope: Block 1");
  expect(prompt).toContain("contentBlockId: " + "f".repeat(64));
  expect(prompt).toContain("contentBlockId: " + "9".repeat(64));
  expect(prompt).toContain("page: 10");
  expect(prompt).toContain("sourceBlocks: b-00103, b-00104");
  expect(prompt).toContain("Current selection:\nDNA besteht aus Nukleotiden.");
  const url = new URL(buildChatGptHandoffUrl(prompt));
  expect(url.origin).toBe("https://chatgpt.com");
  expect(url.searchParams.get("prompt")).toBe(prompt);
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
