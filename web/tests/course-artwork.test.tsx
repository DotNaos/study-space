import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Icon } from "@dotnaos/ui-base";
import { CourseArtwork } from "../src/CourseArtwork";
import { courseImagePath } from "../src/course-library";
import { artworkGenerationUrl, courseArtworkPrompt } from "../src/course-artwork";

const course = { id: 7, name: "Mathematik III (cds-406) HS26", shortName: "cds-406", summary: "Differentialgleichungen" };

test("versioned course image paths remain same-origin and reject injected versions", () => {
  const base = "/api/providers/moodle/courses/7/image";
  expect(courseImagePath({ ...course, imageUrl: base, imageVersion: "a".repeat(64) })).toBe(`${base}?v=${"a".repeat(64)}`);
  expect(courseImagePath({ ...course, imageUrl: base, imageVersion: "bad&url=https://external.test" })).toBe(base);
  expect(courseImagePath({ ...course, imageUrl: "https://external.test/cover.png" })).toBeUndefined();
});

test("missing course artwork uses ImageOff rather than a book or invented cover", () => {
  const html = renderToStaticMarkup(createElement(CourseArtwork, { course }));
  expect(html).toContain("lucide-image-off");
  expect(html).not.toContain("lucide-book");
  expect(html).not.toContain("<img");
});

test("file artwork is supplied by the published component library", () => {
  for (const filename of ["lecture.pdf", "assignment.docx", "slides.pptx", "data.csv"]) {
    const html = renderToStaticMarkup(createElement(Icon.File, { filename, size: 22 }));
    expect(html).toContain("Icon.File");
    expect(html).not.toContain("lucide-file-text");
  }
});

test("generation prompt uses course context and opens only the fixed ChatGPT origin", () => {
  const prompt = courseArtworkPrompt(course);
  expect(prompt).toContain(course.name);
  expect(prompt).toContain("Differentialgleichungen");
  expect(prompt).toContain("Bildgenerierung");
  const url = new URL(artworkGenerationUrl(prompt));
  expect(url.origin).toBe("https://chatgpt.com");
  expect(url.searchParams.get("q")).toBe(prompt);
  expect(courseArtworkPrompt({ name: "A & B", summary: "x".repeat(5000) }).length).toBeLessThan(1600);
});
