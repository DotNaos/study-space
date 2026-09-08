import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SafeMarkdown } from "../src/SafeMarkdown";
import { safeCodexVerificationUrl } from "../src/codex-api";
import {
  materialDocumentPath,
  type MaterialDocument,
  type MaterialAsset,
} from "../src/material-api";
import { sourceAssetPath, SourceChips } from "../src/SourceViewer";
import { readLearningEvents } from "../src/learning-chat";

const materialId = "a".repeat(64),
  revision = "9".repeat(64);
const base = `/api/materials/${materialId}/revisions/${revision}`;
const asset: MaterialAsset = {
  id: "page-0001",
  kind: "page-image",
  mimeType: "image/png",
  name: "Seite 1",
  url: `${base}/assets/page-0001`,
  sha256: revision,
  byteLength: 2048,
  page: 1,
  slide: null,
};
const document: MaterialDocument = {
  materialId,
  revision,
  name: "Lesson.pdf",
  mimeType: "application/pdf",
  blocks: [],
  assets: [asset],
  provenance: [],
  warnings: [],
  complete: true,
};

test("generated Markdown preserves study structure and math without navigation or remote media", () => {
  const html = renderToStaticMarkup(
    createElement(SafeMarkdown, {
      children:
        '# Überschrift\n\n**Wichtig** und $x^2+1$.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n[Delete](/api/codex)\n\n![Tracker](https://external.example/track.png)\n\n<img src="https://external.example/other.png" onerror="alert(1)"><script>alert(1)</script>\n\n$\\href{https://external.example/action}{blocked}$',
    }),
  );
  expect(html).toContain("<strong>Wichtig</strong>");
  expect(html).toContain("<table");
  expect(html).toContain("katex");
  expect(html).not.toContain("<img");
  expect(html).not.toContain("<script");
  expect(html).not.toContain("href=");
  expect(html).not.toContain("src=");
});

test("device sign-in can only open the expected verification origin and path", () => {
  expect(safeCodexVerificationUrl("https://auth.openai.com/codex/device")).toBe(
    "https://auth.openai.com/codex/device",
  );
  for (const url of [
    "https://auth.openai.com.evil.test/codex/device",
    "https://auth.openai.com/codex/device?next=https://evil.test",
    "http://auth.openai.com/codex/device",
    "javascript:alert(1)",
    "//auth.openai.com/codex/device",
  ])
    expect(safeCodexVerificationUrl(url)).toBeUndefined();
});

test("pinned source document and asset links require exact immutable identity", () => {
  expect(materialDocumentPath(materialId, revision)).toBe(base);
  expect(materialDocumentPath("../other", revision)).toBeUndefined();
  expect(materialDocumentPath(materialId, "latest")).toBeUndefined();
  expect(sourceAssetPath(document, asset)).toBe(`${base}/assets/page-0001`);
  for (const url of [
    `https://external.example${asset.url}`,
    `${asset.url}?key=1`,
    `${base}/assets/other`,
    `${base}/assets/../original`,
  ])
    expect(sourceAssetPath(document, { ...asset, url })).toBeUndefined();
});

test("citations render app actions only for known source identities", () => {
  const html = renderToStaticMarkup(
    createElement(SourceChips, {
      references: [
        { materialId, revision, blockId: "b-00001", page: 2 },
        { materialId: "b".repeat(64), revision, blockId: "b-00002", page: 1 },
      ],
      sources: [{ materialId, revision, name: "Lesson.pdf" }],
      onOpen: () => {},
    }),
  );
  expect(html.match(/<button /g)).toHaveLength(1);
  expect(html).toContain("Lesson.pdf");
  expect(html).toContain("S. ");
  expect(html).not.toContain("href=");
});

test("streamed answers survive split UTF-8 and CRLF event boundaries", async () => {
  const answer = {
    id: "answer-1",
    role: "assistant",
    content: "Grüezi 👋",
    status: "completed",
  };
  const bytes = new TextEncoder().encode(
    `event: delta\r\ndata: ${JSON.stringify({ text: "Grüezi 👋" })}\r\n\r\nevent: completed\r\ndata: ${JSON.stringify({ message: answer })}\r\n\r\n`,
  );
  const deltas: string[] = [];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
  expect(await readLearningEvents(stream, (text) => deltas.push(text))).toEqual(
    answer,
  );
  expect(deltas.join("")).toBe(answer.content);
});

test("interrupted and failed streams do not falsely report completion", async () => {
  const stream = (text: string) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });
  await expect(
    readLearningEvents(
      stream('event: delta\ndata: {"text":"Part"}\n\n'),
      () => {},
    ),
  ).rejects.toThrow("unterbrochen");
  await expect(
    readLearningEvents(
      stream('event: error\ndata: {"message":"No capacity"}\n\n'),
      () => {},
    ),
  ).rejects.toThrow("No capacity");
});
