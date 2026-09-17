import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StructureRow } from "../src/StructureRow";
import { StructurePicker } from "../src/StructurePicker";
import { PipelineStructure } from "../src/PipelineStructure";
import type { PipelineSourceView, PipelineState, PipelineUnit } from "../src/pipeline-api";

const unit: PipelineUnit = { id: "a".repeat(32), title: "Block 1", parentId: null, order: 0, kind: "script", hidden: false };
const noop = () => {};

const nestedSource: PipelineSourceView = {
  source: { id: "1".repeat(64), sectionId: 10, moduleId: null, name: "2026_CDS303_Block1_1.pdf", kind: "file", mimeType: "application/pdf", sourceVersion: "f".repeat(64), materialRevision: null, acquisition: "not-imported", problem: null, warnings: [], text: "", studyUrl: null, present: true, suggestedRole: "teaching" },
  status: "pending", decision: null, sectionIds: [], exerciseIds: [],
};
const renderRow = (item: PipelineUnit, units = [item], disabled = false) => renderToStaticMarkup(
  <ul><StructureRow unit={item} units={units} disabled={disabled} expanded={false} onToggle={noop}
    onChange={noop} onHide={noop} onOpen={noop} onParent={noop} onKind={noop} /></ul>,
);

test("visible rows use an always-visible checked visibility checkbox, separate from their options", () => {
  const html = renderRow(unit);
  expect(html).toContain('class="structure-visibility-checkbox"');
  expect(html).toContain('type="checkbox"');
  expect(html).toContain('checked=""');
  expect(html).toContain("In Struktur verwenden: Block 1");
  expect(html).toContain('aria-label="Optionen: Block 1"');
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).not.toContain("structure-options");
  expect(html).not.toContain("Ursprünglicher Name");
});

test("hidden rows expose an unchecked visibility checkbox", () => {
  const html = renderRow({ ...unit, hidden: true });
  expect(html).toContain('class="structure-visibility-checkbox"');
  expect(html).toContain("In Struktur verwenden: Block 1");
  expect(html).toContain('data-hidden="true"');
  expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
});

test("visibility checkboxes respect read-only saving and inherited hidden parents", () => {
  expect(renderRow(unit, [unit], true)).toMatch(/<input[^>]*disabled=""[^>]*type="checkbox"/);
  const child = { ...unit, id: "b".repeat(32), parentId: unit.id };
  const html = renderRow(child, [{ ...unit, hidden: true }, child]);
  expect(html).toMatch(/<input[^>]*disabled=""[^>]*type="checkbox"/);
  expect(html).toContain("Zuerst den übergeordneten Eintrag einblenden");
});

test("nested structure rows keep content inline with the chevron in the leading drag slot", () => {
  const html = renderToStaticMarkup(<ul><StructureRow unit={unit} units={[unit]} disabled={false} expanded={false} onToggle={noop}
    onChange={noop} onHide={noop} onOpen={noop} onParent={noop} onKind={noop} inlineChildren nestedOpen nestedCount={3} onToggleNested={noop}>
    <div data-testid="nested-source">Quelle → Ziel</div>
  </StructureRow></ul>);
  expect(html).toContain('aria-label="Block 1 einklappen"');
  expect(html).toContain('class="structure-icon structure-leading structure-nested-toggle"');
  expect(html.indexOf('class="structure-visibility-checkbox"')).toBeLessThan(html.indexOf('aria-label="Block 1 einklappen"'));
  expect(html).not.toContain('class="structure-handle structure-drag-only"');
  expect(html).not.toContain('title="3 Inhalte"');
  expect(html).toContain('class="structure-inline-children"');
  expect(html).toContain("Quelle → Ziel");
});

test("nested task rows do not repeat their implicit script assignment", () => {
  const task: PipelineUnit = { id: "b".repeat(32), title: "Aufgabe 1", parentId: null, order: 0, kind: "tasks", hidden: false, scriptUnitIds: [unit.id] };
  const html = renderToStaticMarkup(<ul><StructureRow unit={task} units={[unit, task]} disabled={false} expanded={false} onToggle={noop}
    onChange={noop} onHide={noop} onOpen={noop} onParent={noop} onKind={noop} inlineChildren /></ul>);
  expect(html).not.toContain('class="structure-links"');
  expect(html).not.toContain("Block 1</button>");
  expect(html).toContain("In Struktur verwenden: Aufgabe 1");
  expect(html).toContain('aria-label="Optionen: Aufgabe 1"');
});

test("parent picker uses a controlled styled button, not a native disclosure", () => {
  const html = renderToStaticMarkup(<StructurePicker label="Übergeordneter Eintrag" units={[unit]} selected={[unit.id]} onChange={noop} />);
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('aria-controls=');
  expect(html).toContain('aria-label="Übergeordneter Eintrag: Block 1"');
  expect(html).not.toMatch(/<(details|summary)\b/);
});

test("combined structure surface exposes content next and optional focus mode", () => {
  const state = { courseId: 7, revision: 1, units: [unit], suggestedUnits: [], sources: [], history: [], pending: 0, blocked: 0, groups: [], observedHash: "x", persisted: true, problem: null, unattributedSections: [] } as PipelineState;
  const html = renderToStaticMarkup(<PipelineStructure state={state} busy={false} onSave={async () => state} onState={noop}
    onOpenSource={noop} onFocus={noop} onContent={noop} />);
  expect(html).not.toContain("Struktur speichern");
  expect(html).toContain("Verschachtelt");
  expect(html).toContain('aria-label="Strukturansicht"');
  expect(html).toContain(">Fokus<");
  expect(html).toContain('role="switch"');
  expect(html).toContain('aria-checked="false"');
  expect(html).toContain("Ausgeblendete anzeigen");
  expect(html).toContain("Alle auswählen");
  expect(html).toContain("Alle abwählen");
  expect(html).toContain("Inhalt");
  expect(html).not.toMatch(/<(details|summary)\b/);
});

test("hidden structure entries are filtered by default and counted by the reveal switch", () => {
  const hidden = { ...unit, id: "b".repeat(32), title: "Ausgeblendeter Block", order: 1, hidden: true };
  const state = { courseId: 7, revision: 1, units: [unit, hidden], suggestedUnits: [], sources: [], history: [], pending: 0, blocked: 0, groups: [], observedHash: "x", persisted: true, problem: null, unattributedSections: [] } as PipelineState;
  const html = renderToStaticMarkup(<PipelineStructure state={state} busy={false} onSave={async () => state} onState={noop}
    onOpenSource={noop} onFocus={noop} onContent={noop} />);
  expect(html).not.toContain("Ausgeblendeter Block");
  expect(html).toContain("Ausgeblendete anzeigen (1)");
});


test("nested sources use their containing section and component-library file icon", () => {
  const nestedUnit = { ...unit, sourceGroupId: 10 };
  const state = { courseId: 7, revision: 1, units: [nestedUnit], suggestedUnits: [], sources: [nestedSource], history: [], pending: 1, blocked: 0, groups: [{ id: 10, title: "Block 1", order: 0, parentId: null }], observedHash: "x", persisted: true, problem: null, unattributedSections: [] } as PipelineState;
  const html = renderToStaticMarkup(<PipelineStructure state={state} busy={false} onSave={async () => state} onState={noop}
    onOpenSource={noop} onFocus={noop} onContent={noop} />);
  expect(html).toContain('data-compact="true"');
  expect(html).toContain("2026_CDS303_Block1_1.pdf");
  expect(html).toContain('data-ui-component="Icon.File"');
  expect(html).toContain('class="mapping-selection-checkbox"');
  expect(html).toContain("Quelle verwenden: 2026_CDS303_Block1_1.pdf");
  expect(html).not.toContain('class="mapping-eye"');
  expect(html).not.toContain('class="mapping-handle"');
  expect(html).not.toContain('class="mapping-value"');
});

test("explicitly excluded nested sources are filtered with hidden items", () => {
  const nestedUnit = { ...unit, sourceGroupId: 10 };
  const excluded: PipelineSourceView = {
    ...nestedSource,
    status: "excluded",
    decision: { sourceId: nestedSource.source.id, sourceVersion: nestedSource.source.sourceVersion, disposition: "exclude", uses: [], reason: "Hidden", actor: "user", decidedAt: "2026-09-16T00:00:00Z" },
  };
  const state = { courseId: 7, revision: 1, units: [nestedUnit], suggestedUnits: [], sources: [excluded], history: [], pending: 0, blocked: 0, groups: [{ id: 10, title: "Block 1", order: 0, parentId: null }], observedHash: "x", persisted: true, problem: null, unattributedSections: [] } as PipelineState;
  const html = renderToStaticMarkup(<PipelineStructure state={state} busy={false} onSave={async () => state} onState={noop}
    onOpenSource={noop} onFocus={noop} onContent={noop} />);
  expect(html).not.toContain("2026_CDS303_Block1_1.pdf");
  expect(html).toContain("Ausgeblendete anzeigen (1)");
});

test("nested source checkbox reflects an explicit use decision, not merely a pending proposal", () => {
  const nestedUnit = { ...unit, sourceGroupId: 10 };
  const pendingState = { courseId: 7, revision: 1, units: [nestedUnit], suggestedUnits: [], sources: [nestedSource], history: [], pending: 1, blocked: 0, groups: [{ id: 10, title: "Block 1", order: 0, parentId: null }], observedHash: "x", persisted: true, problem: null, unattributedSections: [] } as PipelineState;
  const pendingHtml = renderToStaticMarkup(<PipelineStructure state={pendingState} busy={false} onSave={async () => pendingState} onState={noop}
    onOpenSource={noop} onFocus={noop} onContent={noop} />);
  const pendingRow = pendingHtml.match(new RegExp(`<li[^>]*data-source-id="${nestedSource.source.id}"[\\s\\S]*?<\\/li>`))?.[0] ?? "";
  const pendingCheckbox = pendingRow.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0] ?? "";
  expect(pendingCheckbox).not.toContain('checked=""');

  const reviewedSource: PipelineSourceView = {
    ...nestedSource,
    status: "reviewed",
    decision: {
      sourceId: nestedSource.source.id,
      sourceVersion: nestedSource.source.sourceVersion,
      disposition: "use",
      uses: [{ unitId: nestedUnit.id, role: "teaching", order: 0 }],
      reason: "Bestätigt",
      actor: "user",
      decidedAt: "2026-09-16T00:00:00Z",
    },
  };
  const reviewedState = { ...pendingState, sources: [reviewedSource], pending: 0 };
  const reviewedHtml = renderToStaticMarkup(<PipelineStructure state={reviewedState} busy={false} onSave={async () => reviewedState} onState={noop}
    onOpenSource={noop} onFocus={noop} onContent={noop} />);
  const reviewedRow = reviewedHtml.match(new RegExp(`<li[^>]*data-source-id="${nestedSource.source.id}"[\\s\\S]*?<\\/li>`))?.[0] ?? "";
  const reviewedCheckbox = reviewedRow.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0] ?? "";
  expect(reviewedCheckbox).toContain('checked=""');
});

test("embedded authoring structure shows assigned files as selectable content rows without making them structure nodes", () => {
  const nestedUnit = { ...unit, sourceGroupId: 10 };
  const state = { courseId: 7, revision: 1, units: [nestedUnit], suggestedUnits: [], sources: [nestedSource], history: [], pending: 1, blocked: 0, groups: [{ id: 10, title: "Block 1", order: 0, parentId: null }], observedHash: "x", persisted: true, problem: null, unattributedSections: [] } as PipelineState;
  const html = renderToStaticMarkup(<PipelineStructure state={state} busy={false} onSave={async () => state} onState={noop}
    onOpenSource={noop} onFocus={noop} embedded editing onSelectUnit={noop} />);
  expect(html).toContain("Sichtbarkeit");
  expect(html).toContain("2026_CDS303_Block1_1.pdf");
  expect(html).toContain('class="structure-source-links"');
  expect(html).not.toContain('class="structure-visibility-checkbox"');
  expect(html).not.toContain('class="structure-branch-label">Aufgaben');
});

test("visibility mode keeps the checkbox in a fixed trailing column and preserves inherited child state", () => {
  const child = { ...unit, id: "b".repeat(32), title: "Kind", parentId: unit.id, hidden: false };
  const hiddenParent = { ...unit, hidden: true };
  const html = renderToStaticMarkup(<ul><StructureRow unit={child} units={[hiddenParent, child]} disabled={false} expanded={false} onToggle={noop}
    onChange={noop} onHide={noop} onOpen={noop} onParent={noop} onKind={noop} visibilityMode onVisibilityToggle={noop} /></ul>);
  expect(html).toContain('data-visibility-mode="true"');
  expect(html).toContain('class="structure-visibility-checkbox structure-visibility-checkbox-right"');
  expect(html).toMatch(/<input[^>]*checked=""[^>]*disabled=""[^>]*type="checkbox"|<input[^>]*disabled=""[^>]*type="checkbox"[^>]*checked=""/);
  expect(html.indexOf("structure-visibility-row")).toBeLessThan(html.indexOf("structure-visibility-checkbox-right"));
});

test("embedded tasks are highlighted inline without a separate task branch label", () => {
  const task: PipelineUnit = { id: "c".repeat(32), title: "Aufgabe 1", parentId: null, order: 0, kind: "tasks", hidden: false, scriptUnitIds: [unit.id] };
  const state = { courseId: 7, revision: 1, units: [unit, task], suggestedUnits: [], sources: [], history: [], pending: 0, blocked: 0, groups: [], observedHash: "x", persisted: true, problem: null, unattributedSections: [] } as PipelineState;
  const html = renderToStaticMarkup(<PipelineStructure state={state} busy={false} onSave={async () => state} onState={noop}
    onOpenSource={noop} onFocus={noop} embedded editing onSelectUnit={noop} />);
  expect(html).toContain('data-kind="tasks"');
  expect(html).toContain("Aufgabe 1");
  expect(html).not.toContain('class="structure-branch-label">Aufgaben');
});
