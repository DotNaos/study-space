import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseRoute, AppLink } from "../src/navigation";
import { formatFileSize } from "../src/course-content";
import {
  cleanCourseText,
  visibleModule,
  visibleResources,
} from "../src/course-content";
import {
  courseImagePath,
  courseSemester,
  courseSubtitle,
  groupCourses,
} from "../src/course-library";
import { CourseArtwork } from "../src/CourseArtwork";
import { CourseLibrary } from "../src/CourseLibrary";
import { CourseActivities } from "../src/CourseActivities";
import type { Course, CourseModule } from "../src/api";

const course = (name: string, shortName = name, id = 1): Course => ({
  id,
  name,
  shortName,
  summary: "",
});

test("semesters require one unambiguous explicit HS or FS label", () => {
  for (const [name, expected] of [
    ["Kurs · 2025 FS", "2025-FS"],
    ["2025_FS_Kurs", "2025-FS"],
    ["Kurs HS24", "2024-HS"],
    ["FS26: Kurs", "2026-FS"],
    ["2026-HS", "2026-HS"],
  ]) {
    expect(courseSemester(course(name))?.key).toBe(expected);
  }
  expect(courseSemester(course("Kurs 2025 FS", "FS25"))?.key).toBe("2025-FS");
  for (const ambiguous of [
    course("Kurs HS25 / FS26"),
    course("Kurs HS25", "FS26"),
    course("Kurs 2026"),
    course("WORKSHS26"),
    course("HS20260"),
    course("FS 26a"),
  ])
    expect(courseSemester(ambiguous)).toBeUndefined();
});

test("semester groups sort newest first, keep unknown courses, and search across group labels", () => {
  const courses = [
    course("Allgemeines", "ORG", 1),
    course("Biologie 2025 FS", "BIO", 2),
    course("Mathematik HS25", "MATH", 3),
    course("Informatik FS26", "INF", 4),
  ];
  expect(groupCourses(courses).map((group) => group.semester.key)).toEqual([
    "2026-FS",
    "2025-HS",
    "2025-FS",
    "general",
  ]);
  expect(
    groupCourses(courses, "frühlingssemester").map(
      (group) => group.courses[0].id,
    ),
  ).toEqual([4, 2]);
  expect(groupCourses(courses, "FS25")[0].courses[0].id).toBe(2);
  expect(groupCourses(courses, "bio 2025")[0].courses[0].id).toBe(2);
  expect(groupCourses(courses, "Kein Treffer")).toEqual([]);
  expect(
    groupCourses(courses, "").flatMap((group) => group.courses),
  ).toHaveLength(4);
});

test("equivalent short labels are hidden without removing course titles", () => {
  expect(
    courseSubtitle(course("Seminar HS25 / FS26", "Seminar_HS25_FS26")),
  ).toBeUndefined();
  expect(courseSubtitle(course("Mathematik I", "MATH"))).toBe("MATH");
  const html = renderToStaticMarkup(
    createElement(CourseLibrary, {
      groups: groupCourses([
        course("Seminar HS25 / FS26", "Seminar_HS25_FS26"),
      ]),
      navigate: () => {},
    }),
  );
  expect(html).toContain("Seminar HS25 / FS26");
  expect(html).not.toContain("Seminar_HS25_FS26");
  expect(html).toContain("Allgemein");
});

test("course artwork uses only its own authenticated app endpoint and lazy fixed-size markup", () => {
  const imageCourse = {
    ...course("Mathematik"),
    imageUrl: "/api/providers/moodle/courses/1/image",
  };
  expect(courseImagePath(imageCourse)).toBe(imageCourse.imageUrl);
  const html = renderToStaticMarkup(
    createElement(CourseArtwork, {
      course: imageCourse,
      className: "h-16 w-20",
    }),
  );
  expect(html).toContain('loading="lazy"');
  expect(html).toContain('alt=""');
  expect(html).toContain("h-16 w-20");
  for (const imageUrl of [
    null,
    "https://moodle.example/image?token=synthetic",
    "//other.test/image",
    "/api/providers/moodle/courses/2/image",
  ]) {
    expect(courseImagePath({ ...imageCourse, imageUrl })).toBeUndefined();
    const fallback = renderToStaticMarkup(
      createElement(CourseArtwork, { course: { ...imageCourse, imageUrl } }),
    );
    expect(fallback).not.toContain("<img");
    expect(fallback).toContain("<svg");
  }
});

test("content keeps meaningful labels and files while removing separators and URL bookkeeping", () => {
  const label: CourseModule = {
    id: 1,
    type: "label",
    name: "____________…",
    description: "----",
    url: null,
    resources: [],
  };
  expect(visibleModule(label)).toBe(false);
  expect(
    visibleModule({ ...label, description: "Hinweis: a_b bleibt erhalten." }),
  ).toBe(true);
  expect(cleanCourseText("Hinweis\n_____…\nWarte…\n3 - 2 = 1")).toBe(
    "Hinweis\nWarte…\n3 - 2 = 1",
  );
  const url: CourseModule = {
    id: 2,
    type: "url",
    name: "Online-Atlas",
    description: "Nützliche Beispiele",
    url: "https://moodle.example/mod/url/view.php?id=2",
    resources: [
      {
        type: "url",
        name: "index.html",
        mimeType: null,
        size: 0,
        modifiedAt: null,
        url: null,
      },
    ],
  };
  expect(visibleResources(url)).toEqual([]);
  const file: CourseModule = {
    ...url,
    id: 3,
    type: "resource",
    name: "Übungsblatt 02",
    resources: [
      { ...url.resources[0], type: "file", name: "Übungsblatt_02.pdf" },
    ],
  };
  const html = renderToStaticMarkup(
    createElement(CourseActivities, {
      modules: [
        label,
        url,
        file,
        { ...label, id: 4, name: "Abgabehinweis", description: "<img src=x>" },
      ],
    }),
  );
  expect(html).toContain("Online-Atlas");
  expect(html).toContain("Nützliche Beispiele");
  expect(html).toContain("PDF");
  expect(html).toContain("Abgabehinweis");
  expect(html).toContain("&lt;img src=x&gt;");
  expect(html).not.toContain("0 B");
  expect(html).not.toContain("index.html");
  expect(html).not.toContain("____________");
});

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
