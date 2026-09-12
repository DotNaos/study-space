import assert from "node:assert/strict";
import { test } from "node:test";
import { rootCourseSections, subsectionFor } from "../src/lib/course-sections.ts";

const link = (id, name = "Aufgabe 1") => ({
  id: 99, name, type: "subsection", url: null, description: "", resources: [], subsectionId: id,
});
const section = (id, modules = [], name = "Aufgabe 1") => ({
  id, name, summary: "", modules,
});

test("subsections open by explicit ID even with duplicate titles", () => {
  const all = [section(1), section(276020), section(276259)];
  assert.equal(subsectionFor(link(276259), all), all[2]);
});
test("never guesses a matching title when the relationship is absent or invalid", () => {
  const all = [section(276020)];
  for (const id of [null, 0, -1, 1.5, 999, Number.MAX_SAFE_INTEGER + 1])
    assert.equal(subsectionFor(link(id), all), undefined);
  assert.equal(subsectionFor({ ...link(276020), type: "resource" }, all), undefined);
});
test("delegated sections are not repeated as top-level content", () => {
  const all = [section(1, [link(276020), link(276259)]), section(2), section(276020), section(276259)];
  assert.deepEqual(rootCourseSections(all).map((s) => s.id), [1, 2]);
  assert.equal(subsectionFor(all[0].modules[0], all)?.id, 276020);
});
test("unreferenced sections are preserved; names do not define hierarchy", () => {
  const all = [section(1), section(2)];
  assert.deepEqual(rootCourseSections(all), all);
});
test("missing or unavailable targets do not hide unrelated materials", () => {
  const all = [section(1, [link(404)]), section(2)];
  assert.deepEqual(rootCourseSections(all), all);
});
test("nested subsections stay reachable without repeating them at the root", () => {
  const all = [section(1, [link(2)]), section(2, [link(3)]), section(3)];
  assert.deepEqual(rootCourseSections(all).map((s) => s.id), [1]);
  assert.equal(subsectionFor(all[1].modules[0], all)?.id, 3);
});
test("malformed cycles and self-references cannot lose course contents or loop forever", () => {
  const all = [section(1), section(2, [link(3)]), section(3, [link(2)]), section(4, [link(4)])];
  assert.deepEqual(rootCourseSections(all).map((s) => s.id), [1, 4, 2]);
});
test("empty course remains empty", () => assert.deepEqual(rootCourseSections([]), []));
