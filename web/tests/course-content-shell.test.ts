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

test("Quellen owns generic placement controls and keeps graph secondary", () => {
  const sources = readFileSync(new URL("../src/CourseSourcesView.tsx", import.meta.url), "utf8");
  expect(sources).toContain("Quellenverzeichnis");
  expect(sources).toContain("Standard:");
  expect(sources).toContain("Auf Standard zurücksetzen");
  expect(sources).toContain("Quelle neu zugeordnet.");
  expect(sources).toContain("Quelle ausgeblendet.");
  expect(sources).toContain('label="Graph"');
  expect(sources).not.toContain("Moodle placement");
  expect(sources).not.toContain("Moodle-Zuordnung");
});

test("mobile content exposes the rendered TOC through one compact control", () => {
  const workspace = readFileSync(new URL("../src/PreparationWorkspace.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/preparation-workspace.css", import.meta.url), "utf8");
  expect(workspace).toContain("preparation-toc-mobile-button");
  expect(workspace).toContain('title="Inhaltsverzeichnis"');
  expect(css).toContain(".preparation-toc-mobile-button { display:flex;");
  expect(css).toContain(".preparation-toc-panel { display:none;");
});


test("edit-mode unit content exposes an explicit path into block editor, diff and composer", () => {
  const content = readFileSync(new URL("../src/ContentAuthoringView.tsx", import.meta.url), "utf8");
  expect(content).toContain('<PencilLine size={11}/>Bearbeiten');
  expect(content).toContain('setTab("edited-raw")');
  expect(content).toContain('<Composer');
  expect(content).toContain('<MarkdownEditor');
});

test("content drafts hydrate from the loaded revision before autosave", () => {
  const content = readFileSync(new URL("../src/ContentAuthoringView.tsx", import.meta.url), "utf8");
  expect(content).toContain("draftBlockId");
  expect(content).toContain("draftRevisionId");
  expect(content).toContain("selectedSummary?.currentRevisionId, selectedView?.revision?.id");
  expect(content).toContain("draftRevisionId !== selectedView?.revision?.id");
  expect(content).toContain('Bearbeitete Fassung wird geladen …');
});
