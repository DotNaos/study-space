import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("course primary tabs expose Inhalt and Quellen while legacy graph and learning stay off the primary tab row", () => {
  const source = readFileSync(new URL("../src/CourseDetail.tsx", import.meta.url), "utf8");
  const start = source.indexOf('aria-label="Kursansicht"');
  const tabs = source.slice(start, source.indexOf("!tabChosen", start));
  expect(tabs).toContain('label="Inhalt"');
  expect(tabs).toContain('label="Quellen"');
  expect(tabs).not.toContain('label="Lernen"');
  expect(tabs).not.toContain('label="Aufbereitung"');
  expect(tabs).not.toContain('label="Graph"');
  expect(source).toContain('import("./ContentGraphView")');
});

test("view mode derives a rendered heading TOC while edit mode owns the structure sidebar", () => {
  const workspace = readFileSync(new URL("../src/PreparationWorkspace.tsx", import.meta.url), "utf8");
  const content = readFileSync(new URL("../src/ContentAuthoringView.tsx", import.meta.url), "utf8");
  expect(workspace).toContain('aria-label="Inhaltsverzeichnis"');
  expect(workspace).toContain('aria-label="Struktur"');
  expect(workspace).toContain("!editing && <aside");
  expect(workspace).toContain("editing && <aside");
  expect(content).toContain('querySelectorAll<HTMLElement>("h1,h2,h3,h4")');
  expect(content).toContain('heading.classList.add("content-toc-anchor")');
});
