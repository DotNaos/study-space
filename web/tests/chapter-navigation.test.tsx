import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { ChapterNavigation, matchingChapters } from "../src/ChapterNavigation";

const sections = Array.from({ length: 120 }, (_, index) => ({
  id: `chapter-${index + 1}`,
  title: index === 119 ? "Ökologische Beziehungen und biologische Vielfalt" : `Zellstruktur und Membrantransport · Teil ${index + 1}`,
  markdown: "Synthetic material.",
  sources: [],
}));
const render = (count: number, currentSectionId: string | null = null) => renderToStaticMarkup(
  createElement(ChapterNavigation, { sections: sections.slice(0, count), currentSectionId, onSelect: () => {} }),
);

test("long scripts have a sticky side index with the visible chapter marked", () => {
  const html = render(120, "chapter-120");
  expect(html).toContain("sticky");
  expect(html).toContain("lg:col-start-2");
  expect(html).toContain("Aktuelles Kapitel 120 von 120");
  expect(html).toContain('aria-current="page"');
  expect(html.match(/data-ui-action="chapter-/g)).toHaveLength(120);
  expect(html).toContain("Ökologische Beziehungen");
  expect(html).toContain('type="search"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('aria-controls=');
  expect(html).not.toContain("<details");
});

test("chapter search keeps original numbers and identities, including the last chapter", () => {
  expect(matchingChapters(sections, "120")).toEqual([{ section: sections[119], number: 120 }]);
  expect(matchingChapters(sections, "  BIOLOGISCHE ökologische  ")).toEqual([{ section: sections[119], number: 120 }]);
  expect(matchingChapters(sections, "unbekannt")).toEqual([]);
  expect(matchingChapters(sections, "  ")).toHaveLength(120);
});

test("small scripts need no search, and a single chapter needs no index", () => {
  expect(render(1)).toBe("");
  expect(render(0)).toBe("");
  expect(render(6)).not.toContain('type="search"');
  expect(render(6).match(/data-ui-action="chapter-/g)).toHaveLength(6);
  expect(render(7)).toContain('type="search"');
});

test("navigation uses the real shared DotNaos primitives", () => {
  const source = readFileSync(new URL("../src/ChapterNavigation.tsx", import.meta.url), "utf8");
  expect(source).toContain('from "@dotnaos/ui/layout"');
  expect(source).toContain("<SidebarItem");
  expect(source).toContain("<Input");
  expect(source).toContain("<Button");
  expect(source).not.toContain("<button");
  expect(source).not.toContain("<input");
});
