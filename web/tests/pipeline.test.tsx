import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  groupSources,
  isOpen,
  parsePipelineRoute,
  pipelineHash,
  type PipelineState,
} from "../src/pipeline-api";
import { parseLearningComponent } from "../src/learning-mdx";
import { SafeMarkdown } from "../src/SafeMarkdown";
import type { LearningVersion } from "../src/learning-api";

const version: LearningVersion = {
  id: "a".repeat(32),
  createdAt: "2026-01-01T00:00:00Z",
  snapshotId: "f".repeat(64),
  title: "Fixture",
  partial: false,
  warnings: [],
  sections: [],
  exercises: [
    {
      id: "b".repeat(64),
      title: "Actual source task",
      prompt: "Question",
      hint: "",
      solution: "",
      origin: "source",
      sources: [],
    },
  ],
  sources: [
    { materialId: "c".repeat(64), revision: "d".repeat(64), name: "Source" },
  ],
  taskAliases: { ["e".repeat(64)]: "b".repeat(64) },
};

test("drill down has one explicit level and round-trips source and unit identities", () => {
  for (const route of [
    { kind: "overview" },
    { kind: "structure" },
    { kind: "content" },
    { kind: "mapping" },
    { kind: "mapping-unit", id: "a".repeat(32) },
    { kind: "group", id: "7" },
    { kind: "source", id: "c".repeat(64) },
    { kind: "unit", id: "a".repeat(32) },
  ] as const)
    expect(parsePipelineRoute(pipelineHash(route))).toEqual(route);
  expect(parsePipelineRoute("#prepare/source/../../private")).toEqual({
    kind: "overview",
  });
  expect(parsePipelineRoute("#prepare/source/%3Cscript%3E")).toEqual({
    kind: "overview",
  });
});

test("nested source totals include descendants without duplicate occurrences or deleting empty groups", () => {
  const state = {
    groups: [
      { id: 1, parentId: null },
      { id: 2, parentId: 1 },
      { id: 3, parentId: 2 },
      { id: 4, parentId: null },
    ],
    sources: [
      { source: { id: "x", sectionId: 1 } },
      { source: { id: "y", sectionId: 3 } },
    ],
  } as PipelineState;
  expect(groupSources(state, 1, true).map((item) => item.source.id)).toEqual([
    "x",
    "y",
  ]);
  expect(groupSources(state, 1).map((item) => item.source.id)).toEqual(["x"]);
  expect(groupSources(state, 4, true)).toEqual([]);
});

test("partial page use and disappeared sources remain unresolved, not falsely complete", () => {
  for (const status of ["pending", "stale", "partial", "not-returned"])
    expect(isOpen({ status } as never)).toBe(true);
  for (const status of ["reviewed", "excluded"])
    expect(isOpen({ status } as never)).toBe(false);
});

test("literal MDX only accepts registered inert components with pinned IDs", () => {
  expect(
    parseLearningComponent(`<TaskRef id="${"b".repeat(64)}" />`)?.name,
  ).toBe("TaskRef");
  expect(
    parseLearningComponent(
      `<Figure materialId="${"c".repeat(64)}" revision="${"d".repeat(64)}" assetId="page-1" alt="Source figure" />`,
    )?.name,
  ).toBe("Figure");
  for (const bad of [
    "<TaskRef id={run()} />",
    "<script>alert(1)</script>",
    '<Figure src="https://bad.test" />',
    '<TaskRef id="../file" />',
    `<TaskRef id="${"b".repeat(64)}" onClick="run" />`,
    `<TaskRef id="${"b".repeat(64)}" id="${"e".repeat(64)}" />`,
  ])
    expect(parseLearningComponent(bad)).toBeUndefined();
});

test("MDX task reference renders the one canonical task and no arbitrary HTML or executable JS", () => {
  const html = renderToStaticMarkup(
    <SafeMarkdown
      mdx={{ version }}
    >{`# Heading\n\n<TaskRef id="${"e".repeat(64)}" />\n\n<script>alert(1)</script>`}</SafeMarkdown>,
  );
  expect(html).toContain("Actual source task");
  expect(html).toContain("button");
  expect(html).not.toContain("<script");
  expect(html).toContain("Heading");
});

test("MDX components stay literal inside code and math/GFM remain intact", () => {
  const html = renderToStaticMarkup(
    <SafeMarkdown
      mdx={{ version }}
    >{`| x | y |\n|---|---|\n| 1 | 2 |\n\n$x_{1}$\n\n\`\`\`mdx\n<TaskRef id="${"b".repeat(64)}" />\n\`\`\``}</SafeMarkdown>,
  );
  expect(html).toContain("<table>");
  expect(html).toContain("katex");
  expect(html).not.toContain("Actual source task");
  expect(html).toContain("TaskRef");
});

test("plain legacy Markdown never implicitly activates the MDX components", () => {
  const html = renderToStaticMarkup(
    <SafeMarkdown>{`<TaskRef id="${"b".repeat(64)}" />`}</SafeMarkdown>,
  );
  expect(html).not.toContain("Actual source task");
  expect(html).not.toContain("button");
});
