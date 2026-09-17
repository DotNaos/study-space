import { expect, test } from "bun:test";
import type { PipelineSourceView, PipelineState, PipelineUnit } from "../src/pipeline-api";
import { placementPath, sourcePlacement } from "../src/source-placement";

const root: PipelineUnit = { id: "a".repeat(32), title: "Block 1", parentId: null, order: 0, kind: "script", hidden: false, sourceGroupId: 10 };
const child: PipelineUnit = { id: "b".repeat(32), title: "Grundlagen", parentId: root.id, order: 0, kind: "script", hidden: false, sourceGroupId: 11 };
const moved: PipelineUnit = { id: "c".repeat(32), title: "Sequenzanalyse", parentId: root.id, order: 1, kind: "script", hidden: false, sourceGroupId: 12 };
const source = {
  source: { id: "1".repeat(64), sectionId: 11, moduleId: null, name: "DPP4.pdf", kind: "file", mimeType: "application/pdf", sourceVersion: "2".repeat(64), materialRevision: null, acquisition: "not-imported", problem: null, warnings: [], text: "", studyUrl: null, present: true, suggestedRole: "teaching" },
  status: "pending", decision: null, sectionIds: [], exerciseIds: [],
} satisfies PipelineSourceView;
const state = { courseId: 7, revision: 1, observedHash: "x", persisted: true, problem: null, groups: [], sources: [source], units: [root, child, moved], suggestedUnits: [], history: [], pending: 1, blocked: 0, unattributedSections: [] } satisfies PipelineState;

test("source placement defaults to the imported hierarchy without provider-specific state", () => {
  expect(sourcePlacement(state, source)).toMatchObject({ defaultUnitId: child.id, currentUnitId: child.id, hidden: false, overridden: false, unresolved: false });
  expect(placementPath(state.units, child.id)).toBe("Block 1 / Grundlagen");
});

test("explicit move overrides the default while clear can project back to default", () => {
  const item: PipelineSourceView = { ...source, status: "reviewed", decision: { sourceId: source.source.id, sourceVersion: source.source.sourceVersion, disposition: "use", uses: [{ unitId: moved.id, role: "teaching", order: 0 }], reason: "move", actor: "user", decidedAt: "2026-09-17T00:00:00Z" } };
  expect(sourcePlacement(state, item)).toMatchObject({ defaultUnitId: child.id, currentUnitId: moved.id, hidden: false, overridden: true });
  expect(sourcePlacement(state, { ...item, decision: null })).toMatchObject({ currentUnitId: child.id, overridden: false });
});

test("explicit exclusion is hidden but retains the reset target", () => {
  const item: PipelineSourceView = { ...source, status: "excluded", decision: { sourceId: source.source.id, sourceVersion: source.source.sourceVersion, disposition: "exclude", uses: [], reason: "hide", actor: "user", decidedAt: "2026-09-17T00:00:00Z" } };
  expect(sourcePlacement(state, item)).toMatchObject({ defaultUnitId: child.id, currentUnitId: undefined, hidden: true, overridden: true });
});
