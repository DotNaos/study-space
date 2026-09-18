import { expect, test } from "bun:test";
import type { PipelineSourceView } from "../src/pipeline-api";
import { matchingSolutionSource, matchingTaskSource, solutionLike, taskLike, taskPairKey } from "../src/task-pairing";

function source(id: string, name: string, suggestedRole: string, sectionId = 10): PipelineSourceView {
  return {
    source: {
      id: id.repeat(64).slice(0, 64),
      sectionId,
      moduleId: null,
      name,
      kind: "file",
      mimeType: "application/pdf",
      sourceVersion: "v".repeat(64),
      materialRevision: null,
      acquisition: "not-imported",
      problem: null,
      warnings: [],
      text: "",
      studyUrl: null,
      present: true,
      suggestedRole,
    },
    status: "pending",
    decision: null,
    sectionIds: [],
    exerciseIds: [],
  };
}

test("task pair key removes solution marker and filename punctuation", () => {
  expect(taskPairKey("Übungsblatt_CDS_Mathe3_Sto1_Lösungen.pdf")).toBe(taskPairKey("Übungsblatt_CDS_Mathe3_Sto1.pdf"));
  expect(taskPairKey("Sheet 4 - Musterloesung.pdf")).toBe(taskPairKey("Sheet 4.pdf"));
});

test("pairs one exact task and solution in the same Moodle section", () => {
  const task = source("a", "Übungsblatt_CDS_Mathe3_DGL1.pdf", "task");
  const solution = source("b", "Übungsblatt_CDS_Mathe3_DGL1_Lösungen.pdf", "solution");
  const other = source("c", "Übungsblatt_CDS_Mathe3_Norm.pdf", "task");
  expect(taskLike(task)).toBe(true);
  expect(solutionLike(solution)).toBe(true);
  expect(matchingSolutionSource(task, [task, solution, other])?.source.id).toBe(solution.source.id);
  expect(matchingTaskSource(solution, [task, solution, other])?.source.id).toBe(task.source.id);
});

test("ambiguous matches are not paired automatically", () => {
  const task = source("a", "Sheet 1.pdf", "task");
  const duplicate = source("b", "Sheet 1.pdf", "task");
  const solution = source("c", "Sheet 1 Solutions.pdf", "solution");
  expect(matchingTaskSource(solution, [task, duplicate, solution])).toBeUndefined();
});

test("source suggestion still identifies a legacy solution that was previously mapped as task", () => {
  const task = source("a", "Übungsblatt_CDS_Mathe3_Norm.pdf", "task");
  const solution = source("b", "Übungsblatt_CDS_Mathe3_Norm_Lösungen.pdf", "solution");
  solution.decision = {
    sourceId: solution.source.id,
    sourceVersion: solution.source.sourceVersion,
    disposition: "use",
    uses: [{ unitId: "c".repeat(32), role: "task", order: 0 }],
    reason: "legacy explorer move",
    actor: "user",
    decidedAt: "2026-09-18T00:00:00Z",
  };
  expect(solutionLike(solution)).toBe(true);
  expect(matchingSolutionSource(task, [task, solution])?.source.id).toBe(solution.source.id);
});
