import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const layout = readFileSync(new URL("../src/app/_layout.tsx", import.meta.url), "utf8");
test("course library uses a compact native title instead of reserving a large-title area", () => {
  assert.match(layout, /name="index"[^\n]+title: "Kurse"[^\n]+headerLargeTitleEnabled: false/);
  assert.match(layout, /headerTitleStyle: \{ color: colors.text \}/);
  assert.doesNotMatch(layout, /headerLargeTitle(?:Enabled)?: true/);
});
test("subsections have a separate native stack route for working back navigation", () => {
  assert.match(layout, /name="course\/\[courseId\]\/section\/\[sectionId\]"/);
  const route = readFileSync(new URL("../src/app/course/[courseId]/section/[sectionId].tsx", import.meta.url), "utf8");
  assert.match(route, /components\/course-screen/);
});
