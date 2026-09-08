import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseRoute, AppLink } from "../src/navigation";
import { formatFileSize } from "../src/course-content";

test("course routes survive direct links without accepting invalid course IDs", () => {
  expect(parseRoute("/courses/42")).toEqual({ page: "courses", courseId: 42 });
  expect(parseRoute("/courses/42/")).toEqual({ page: "courses", courseId: 42 });
  for (const path of [
    "/courses/-1",
    "/courses/0",
    "/courses/1x",
    "/courses/99999999999999999999",
    "/unknown",
  ])
    expect(parseRoute(path)).toEqual({ page: "not-found" });
  expect(parseRoute("/sources")).toEqual({ page: "sources" });
  expect(parseRoute("/moodle-return")).toEqual({ page: "moodle-return" });
});

test("course navigation retains real URLs and escapes untrusted labels", () => {
  const html = renderToStaticMarkup(
    createElement(AppLink, {
      navigate: () => {},
      href: "/courses/42",
      children: '<img src=x onerror="alert(1)">',
    }),
  );
  expect(html).toContain('href="/courses/42"');
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;img");
});

test("file size handles empty and unknown resource metadata", () => {
  expect(formatFileSize(null)).toBeUndefined();
  expect(formatFileSize(-1)).toBeUndefined();
  expect(formatFileSize(Number.NaN)).toBeUndefined();
  expect(formatFileSize(0)).toBe("0 B");
  expect(formatFileSize(2048)).toBe("2 KB");
  expect(formatFileSize(2621440)).toBe("2.5 MB");
});
