import { afterEach, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  resourceAction,
  resourcePath,
  fetchPreviewBytes,
  maxPreviewBytes,
} from "../src/resource-preview";
import { CourseActivities } from "../src/CourseActivities";
import { visibleResources } from "../src/course-content";
import type { CourseModule, CourseResource } from "../src/api";

const id = "a".repeat(64);
const base = `/api/providers/moodle/courses/41/modules/501/resources/${id}`;
const resource: CourseResource = {
  id,
  type: "file",
  name: "Lesson.pdf",
  mimeType: "application/pdf",
  size: 2000,
  modifiedAt: null,
  url: null,
  previewKind: "pdf",
  previewUrl: `${base}/preview`,
  downloadUrl: `${base}/download`,
};
const module: CourseModule = {
  id: 501,
  name: "Lesson",
  type: "resource",
  url: "https://moodle.example/mod/resource/view.php?id=501",
  description: "Read before Friday",
  resources: [resource],
};
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("preview paths must match the exact course, module, resource and action", () => {
  expect(resourcePath(41, 501, resource, "preview")).toBe(`${base}/preview`);
  for (const previewUrl of [
    `https://external.test${base}/preview`,
    `//external.test${base}/preview`,
    `${base}/preview?token=x`,
    `${base}/download`,
    `${base}/preview/`,
    base.replace("/41/", "/42/") + "/preview",
  ])
    expect(
      resourcePath(41, 501, { ...resource, previewUrl }, "preview"),
    ).toBeUndefined();
  expect(resourcePath(42, 501, resource, "preview")).toBeUndefined();
  expect(resourcePath(41, 502, resource, "preview")).toBeUndefined();
  expect(
    resourcePath(41, 501, { ...resource, id: "../invalid" }, "preview"),
  ).toBeUndefined();
});

test("file actions prefer preview, safe download, then Moodle and skip known oversized files", () => {
  expect(resourceAction(41, module, resource).kind).toBe("preview");
  expect(
    resourceAction(41, module, { ...resource, previewKind: null }).kind,
  ).toBe("download");
  expect(
    resourceAction(41, module, {
      ...resource,
      previewUrl: null,
      downloadUrl: null,
    }).kind,
  ).toBe("moodle");
  expect(
    resourceAction(41, module, { ...resource, size: maxPreviewBytes + 1 }).kind,
  ).toBe("moodle");
  expect(
    resourceAction(
      41,
      { ...module, url: "javascript:alert(1)" },
      { ...resource, previewUrl: null, downloadUrl: null },
    ).kind,
  ).toBe("none");
});

test("single-file and child-file rows expose the complete row as one primary action", () => {
  const single = renderToStaticMarkup(
    createElement(CourseActivities, {
      courseId: 41,
      modules: [module],
      onPreview: () => {},
    }),
  );
  expect(single).toContain("<button");
  expect(single).toContain("Read before Friday");
  expect(single.match(/<button /g)).toHaveLength(1);
  expect(single).not.toContain("<a ");
  const folder = renderToStaticMarkup(
    createElement(CourseActivities, {
      courseId: 41,
      modules: [{ ...module, type: "folder" }],
      onPreview: () => {},
    }),
  );
  expect(folder.match(/<button /g)).toHaveLength(1);
  expect(folder.match(/<a /g)).toHaveLength(1);
  expect(folder.match(/<a[^>]*>[\s\S]*?<\/a>/)?.[0]).not.toContain("<button");
});

test("page and book bookkeeping stays hidden while real attachments remain available", () => {
  for (const type of ["page", "book", "url"]) {
    const activity = {
      ...module,
      type,
      resources: [
        { ...resource, name: "index.html", mimeType: "text/html" },
        resource,
      ],
    };
    expect(visibleResources(activity)).toEqual([resource]);
  }
});

test("fetch uses authenticated same-origin bytes without redirects", async () => {
  let seen: RequestInit | undefined;
  globalThis.fetch = (async (_input, init) => {
    seen = init;
    return new Response(new Uint8Array([37, 80, 68, 70]), {
      headers: { "Content-Type": "application/pdf" },
    });
  }) as typeof fetch;
  const result = await fetchPreviewBytes(
    `${base}/preview`,
    "pdf",
    new AbortController().signal,
  );
  expect(Array.from(result.bytes)).toEqual([37, 80, 68, 70]);
  expect(seen?.credentials).toBe("same-origin");
  expect(seen?.redirect).toBe("error");
  await expect(
    fetchPreviewBytes(
      "https://external.test/file.pdf",
      "pdf",
      new AbortController().signal,
    ),
  ).rejects.toThrow("nicht verfügbar");
});

test("fetch rejects unsafe MIME, empty files, declared and streamed oversized bodies", async () => {
  const cases = [
    new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } }),
    new Response(new Uint8Array(), {
      headers: { "Content-Type": "application/pdf" },
    }),
    new Response("small", {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(maxPreviewBytes + 1),
      },
    }),
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(maxPreviewBytes));
          controller.enqueue(new Uint8Array(1));
          controller.close();
        },
      }),
      { headers: { "Content-Type": "application/pdf" } },
    ),
  ];
  for (const response of cases) {
    globalThis.fetch = (async () => response) as typeof fetch;
    await expect(
      fetchPreviewBytes(`${base}/preview`, "pdf", new AbortController().signal),
    ).rejects.toThrow();
  }
});
