import { readFileSync } from "node:fs";
import { test, expect } from "bun:test";

test("web branding uses the approved Study Space raster mark", async () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  expect(html).toContain('rel="icon" type="image/png" href="/favicon.png"');
  expect(html).toContain('rel="apple-touch-icon" href="/study-space-logo.png"');

  const favicon = Bun.file(new URL("../public/favicon.png", import.meta.url));
  const logo = Bun.file(new URL("../public/study-space-logo.png", import.meta.url));
  expect(await favicon.exists()).toBe(true);
  expect(await logo.exists()).toBe(true);
  expect(favicon.type).toBe("image/png");
  expect(logo.type).toBe("image/png");
  expect(favicon.size).toBeGreaterThan(1000);
  expect(logo.size).toBe(favicon.size);
});
