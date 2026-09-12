import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { currentChapterIndex, chapterReadingOffset } from "../src/useCurrentChapter";

test("reading position is the last chapter starting above the reading line", () => {
  expect(currentChapterIndex([], 100)).toBe(-1);
  expect(currentChapterIndex([500], 0)).toBe(0);
  expect(currentChapterIndex([500, 1000, 1700], 900)).toBe(0);
  expect(currentChapterIndex([500, 1000, 1700], 1000)).toBe(1);
  expect(currentChapterIndex([500, 1000, 1700], 1600)).toBe(1);
  expect(currentChapterIndex([500, 1000, 1700], 9999)).toBe(2);
  expect(chapterReadingOffset).toBe(96);
});

test("long scripts support large jumps, upward scrolling and refreshed layout offsets", () => {
  const tops = Array.from({ length: 120 }, (_, i) => 500 + i * 900);
  expect(currentChapterIndex(tops, tops[119])).toBe(119);
  expect(currentChapterIndex(tops, tops[10] + 30)).toBe(10);
  expect(currentChapterIndex(tops.map((top) => top + 200), tops[10] + 30)).toBe(9);
});

test("passive scrolling does not overwrite the saved reading position or send API writes", () => {
  const source = readFileSync(new URL("../src/useCurrentChapter.ts", import.meta.url), "utf8");
  expect(source).toContain("requestAnimationFrame");
  expect(source).toContain("ResizeObserver");
  expect(source).toContain("passive: true");
  expect(source).not.toContain("fetch(");
  expect(source).not.toContain("localStorage");
  expect(source).not.toContain("onPosition(");
});
