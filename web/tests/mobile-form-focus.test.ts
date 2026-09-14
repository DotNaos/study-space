import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("touch-first editable form controls keep iOS focus text at 16px", () => {
  expect(css).toContain("@media (hover: none) and (pointer: coarse)");
  expect(css).toContain('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"])');
  expect(css).toContain("textarea,");
  expect(css).toContain("select,");
  expect(css).toContain('[contenteditable="true"]');
  expect(css).toContain("font-size: 16px !important");
});
