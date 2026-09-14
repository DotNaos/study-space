import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StructureRow } from "../src/StructureRow";
import { StructurePicker } from "../src/StructurePicker";
import { PipelineStructure } from "../src/PipelineStructure";
import type { PipelineState, PipelineUnit } from "../src/pipeline-api";

const unit: PipelineUnit = { id: "a".repeat(32), title: "Block 1", parentId: null, order: 0, kind: "script", hidden: false };
const noop = () => {};
const renderRow = (item: PipelineUnit, units = [item], disabled = false) => renderToStaticMarkup(
  <ul><StructureRow unit={item} units={units} disabled={disabled} expanded={false} onToggle={noop}
    onChange={noop} onHide={noop} onOpen={noop} onParent={noop} onKind={noop} /></ul>,
);

test("visible rows have a directly accessible hide button, separate from their options", () => {
  const html = renderRow(unit);
  expect(html).toMatch(/<button[^>]*class="structure-icon structure-visibility"[^>]*aria-label="Ausblenden: Block 1"/);
  expect(html).toContain('aria-label="Optionen: Block 1"');
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).not.toContain("structure-options");
  expect(html).not.toContain("Ursprünglicher Name");
});

test("hidden rows expose a restore button instead of a decorative eye", () => {
  const html = renderRow({ ...unit, hidden: true });
  expect(html).toMatch(/<button[^>]*class="structure-icon structure-visibility"[^>]*aria-label="Einblenden: Block 1"/);
  expect(html).toContain('data-hidden="true"');
  expect(html).not.toContain("structure-hidden-icon");
});

test("visibility controls respect read-only saving and inherited hidden parents", () => {
  expect(renderRow(unit, [unit], true)).toMatch(/class="structure-icon structure-visibility"[^>]*disabled=""/);
  const child = { ...unit, id: "b".repeat(32), parentId: unit.id };
  const html = renderRow(child, [{ ...unit, hidden: true }, child]);
  expect(html).toMatch(/class="structure-icon structure-visibility"[^>]*disabled=""/);
  expect(html).toContain("Zuerst den übergeordneten Eintrag einblenden");
});

test("nested structure rows keep content inline instead of forcing drill-down", () => {
  const html = renderToStaticMarkup(<ul><StructureRow unit={unit} units={[unit]} disabled={false} expanded={false} onToggle={noop}
    onChange={noop} onHide={noop} onOpen={noop} onParent={noop} onKind={noop} inlineChildren nestedOpen nestedCount={3} onToggleNested={noop}>
    <div data-testid="nested-source">Quelle → Ziel</div>
  </StructureRow></ul>);
  expect(html).toContain('aria-label="Block 1 einklappen"');
  expect(html).toContain('class="structure-inline-children"');
  expect(html).toContain("Quelle → Ziel");
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
  expect(html).toContain("Inhalt");
  expect(html).not.toMatch(/<(details|summary)\b/);
});
