import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SafeMarkdown } from "../src/SafeMarkdown";
import {
  buildScriptMapping,
  scriptRanges,
  sectionReferences,
  referenceKey,
  safeBounds,
  type ScriptProvenance,
} from "../src/script-provenance";
import type {
  LearningSection,
  LearningVersion,
  SourceRef,
} from "../src/learning-api";
const ref: SourceRef = {
  materialId: "a".repeat(64),
  revision: "b".repeat(64),
  blockId: "b1",
  page: 1,
};
const section = (provenance?: ScriptProvenance): LearningSection => ({
  id: "s1",
  title: "Kapitel",
  markdown: "Quelle. Eigener Zusatz. Ungeklärt.",
  sources: [ref],
  provenance,
});
const map = (): ScriptProvenance => ({
  markdownHash: "hash",
  status: "unreviewed",
  spans: [
    { start: 0, end: 7, quote: "Quelle.", sources: [ref], origin: "source" },
    {
      start: 8,
      end: 23,
      quote: "Eigener Zusatz.",
      sources: [],
      origin: "user",
    },
  ],
});

test("chapter citations do not imply word-level coverage on legacy content", () => {
  const ranges = scriptRanges(section());
  expect(ranges).toHaveLength(1);
  expect(ranges[0].state).toBe("unknown");
  expect(ranges[0].sources).toEqual([]);
  expect(sectionReferences(section())).toEqual([ref]);
});
test("precise provenance distinguishes additions and unmapped clauses within one paragraph", () => {
  const value = section(map());
  expect(scriptRanges(value).map((range) => range.state)).toEqual([
    "source",
    "user",
    "unknown",
  ]);
  expect(scriptRanges(value)[0].reviewed).toBe(false);
});
test("an edited quote or stale source map cannot retain attribution", () => {
  const value = section(map());
  value.markdown = value.markdown.replace("Quelle", "Ändere");
  expect(scriptRanges(value)[0].state).toBe("stale");
  expect(scriptRanges(value)[0].sources).toEqual([]);
  const stale = map();
  stale.status = "stale";
  expect(scriptRanges(section(stale))[0].state).toBe("stale");
});
test("ambiguous overlapping or invalid ranges remain unknown", () => {
  const bad = map();
  bad.spans.push({ ...bad.spans[0], end: 4, quote: "Quel" });
  expect(scriptRanges(section(bad))[0].state).toBe("unknown");
  const invalid = map();
  invalid.spans[0].start = -1;
  expect(scriptRanges(section(invalid))[0].state).toBe("unknown");
});
test("reverse mappings retain multiple target locations and immutable source identities", () => {
  const value = section(map());
  const version = {
    sections: [value, { ...value, id: "s2" }],
    sources: [],
    exercises: [],
  } as unknown as LearningVersion;
  const index = buildScriptMapping(version);
  expect(index.reverse.get(referenceKey(ref))).toHaveLength(2);
  expect(
    index.reverse.has(referenceKey({ ...ref, revision: "c".repeat(64) })),
  ).toBe(false);
  expect(sectionReferences(value)).toEqual([ref]);
});
test("annotated Markdown preserves formatting and marks partial paragraphs without active HTML", () => {
  const value = section(map());
  const html = renderToStaticMarkup(
    createElement(SafeMarkdown, {
      children: value.markdown,
      provenance: { markdown: value.markdown, ranges: scriptRanges(value) },
    }),
  );
  expect(html).toContain('data-map-state="source"');
  expect(html).toContain('data-map-state="unknown"');
  expect(html).toContain('data-map-state="user"');
  expect(html).toContain('role="button"');
  const markup =
    "# Titel\n\n**Text** mit $x^2$ und [Link](https://example.com).\n\n- Eins\n- Zwei\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script>";
  const content = { ...value, markdown: markup, provenance: undefined };
  const rendered = renderToStaticMarkup(
    createElement(SafeMarkdown, {
      children: markup,
      provenance: { markdown: markup, ranges: scriptRanges(content) },
    }),
  );
  expect(rendered).toContain("<strong>");
  expect(rendered).toContain("<ul>");
  expect(rendered).toContain("<table>");
  expect(rendered).toContain('class="katex"');
  expect(rendered).not.toContain("<script>");
  expect(rendered).not.toContain('href="https://');
});
test("source regions must be normalized, finite and positive", () => {
  expect(safeBounds({ x: 0, y: 0.3, width: 0.2, height: 0.1 })).toBeDefined();
  expect(safeBounds({ x: -1, y: 0, width: 0.2, height: 0.2 })).toBeUndefined();
  expect(safeBounds({ x: 0, y: 0, width: NaN, height: 0.2 })).toBeUndefined();
  expect(safeBounds({ x: 0.9, y: 0, width: 0.3, height: 0.2 })).toBeUndefined();
});
