import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChapterNavigation, matchingChapters } from "../src/ChapterNavigation";

const sections = Array.from({ length: 120 }, (_, index) => ({
  id: `chapter-${index + 1}`,
  title:
    index === 119
      ? "Ökologische Beziehungen und biologische Vielfalt"
      : `Zellstruktur und Membrantransport · Teil ${index + 1}`,
  markdown: "Synthetic material.",
  sources: [],
}));

test("large chapter indexes start collapsed while keeping all chapters accessible", () => {
  const html = renderToStaticMarkup(
    createElement(ChapterNavigation, {
      sections,
      readingSectionId: "chapter-120",
      onSelect: () => {},
    }),
  );
  expect(html).toContain("<details");
  expect(html).not.toMatch(/<details[^>]*\sopen/);
  expect(html).toContain("120 Kapitel");
  expect(html).toContain('type="search"');
  expect(html.match(/<button /g)).toHaveLength(120);
  expect(html).toContain('aria-current="location"');
  expect(html).toContain("Ökologische Beziehungen");
});

test("chapter search keeps original numbers and identities, including the final chapter", () => {
  expect(matchingChapters(sections, "120")).toEqual([
    { section: sections[119], number: 120 },
  ]);
  expect(matchingChapters(sections, "  BIOLOGISCHE ökologische  ")).toEqual([
    { section: sections[119], number: 120 },
  ]);
  expect(matchingChapters(sections, "unbekannt")).toEqual([]);
  expect(matchingChapters(sections, "  ")).toHaveLength(120);
});

test("small scripts retain direct chapter navigation and a single chapter needs none", () => {
  const render = (count: number) =>
    renderToStaticMarkup(
      createElement(ChapterNavigation, {
        sections: sections.slice(0, count),
        readingSectionId: null,
        onSelect: () => {},
      }),
    );
  expect(render(1)).toBe("");
  expect(render(6)).not.toContain("<details");
  expect(render(6).match(/<button /g)).toHaveLength(6);
  expect(render(7)).toContain("<details");
});
