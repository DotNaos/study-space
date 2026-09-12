import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { activityPath, parseRoute } from "../src/navigation";
import { CourseActivities } from "../src/CourseActivities";
import type { CourseModule } from "../src/api";

const id = "a".repeat(64);
const navigate = () => {};

describe("canonical activity links", () => {
  test("uses course-module identity, not assignment identity or titles", () => {
    expect(activityPath(23691, 1015573)).toBe(
      "/courses/23691/activities/1015573",
    );
    expect(parseRoute("/courses/23691/activities/1015573")).toEqual({
      page: "courses",
      courseId: 23691,
      moduleId: 1015573,
    });
    expect(parseRoute("/courses/23691/activities/1015573/")).toEqual({
      page: "courses",
      courseId: 23691,
      moduleId: 1015573,
    });
    expect(parseRoute("/courses/23691")).toEqual({
      page: "courses",
      courseId: 23691,
    });
  });
  test("round-trips resource selection, independently of unrelated query parameters", () => {
    expect(activityPath(41, 501, id)).toBe(
      `/courses/41/activities/501?resource=${id}`,
    );
    expect(
      parseRoute("/courses/41/activities/501", `?resource=${id}&unused=1`),
    ).toEqual({ page: "courses", courseId: 41, moduleId: 501, resourceId: id });
  });
  test.each([
    "/courses/0/activities/1",
    "/courses/1/activities/0",
    "/courses/-1/activities/1",
    "/courses/1/activities/2x",
    "/courses/1/activities/9007199254740992",
    "/courses/9007199254740992/activities/1",
    "/courses/1/activities/2/extra",
  ])("rejects invalid target %s", (path) => {
    expect(parseRoute(path)).toEqual({ page: "not-found" });
  });
  test.each([
    "?resource=",
    "?resource=other-file",
    "?resource=https://evil.test/x",
    `?resource=${id}&resource=${id}`,
    `?resource=${"A".repeat(64)}`,
  ])(
    "rejects invalid/ambiguous resource instead of opening another file: %s",
    (search) => {
      expect(parseRoute("/courses/41/activities/501", search)).toEqual({
        page: "not-found",
      });
    },
  );
  test("does not construct unsafe links", () => {
    expect(() => activityPath(0, 1)).toThrow();
    expect(() => activityPath(1, Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(() => activityPath(1, 1, "../../outside")).toThrow();
  });
  test("assignments are real internal anchors, allowing fresh-tab opening", () => {
    const module: CourseModule = {
      id: 1015573,
      name: "Aufgabe 1",
      type: "assign",
      url: "https://upstream.test/mod/assign/view.php?id=1015573",
      description: "",
      resources: [],
    };
    const html = renderToStaticMarkup(
      <CourseActivities
        courseId={23691}
        modules={[module]}
        navigate={navigate}
      />,
    );
    expect(html).toContain('href="/courses/23691/activities/1015573"');
    expect(html).not.toContain("upstream.test");
    expect(html).not.toContain('target="_blank"');
  });
  test("each file in a multi-resource module receives an exact resource link", () => {
    const module: CourseModule = {
      id: 501,
      name: "Materialien",
      type: "folder",
      url: null,
      description: "",
      resources: [id, "b".repeat(64)].map((resourceId, i) => ({
        id: resourceId,
        type: "file",
        name: `Datei${i}.pdf`,
        mimeType: "application/pdf",
        size: 123,
        modifiedAt: null,
        url: null,
      })),
    };
    const html = renderToStaticMarkup(
      <CourseActivities courseId={41} modules={[module]} navigate={navigate} />,
    );
    expect(html).toContain(`href="/courses/41/activities/501?resource=${id}"`);
    expect(html).toContain(
      `href="/courses/41/activities/501?resource=${"b".repeat(64)}"`,
    );
  });
});
