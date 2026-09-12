import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFileSync(new URL(`src/${path}`, root), "utf8");
test("screens use shared native list, search, section and file-icon components", () => {
  const courses = source("app/index.tsx");
  const course = source("components/course-screen.tsx");
  assert.match(courses, /from "@dotnaos\/ui\/native"/);
  assert.match(courses, /<Screen footer={<SearchField/);
  assert.match(courses, /<SectionHeader/);
  assert.match(courses, /<ListItem/);
  assert.match(course, /<Icon\.File filename={resource.name} mimeType={resource.mimeType}/);
  assert.match(course, /titleNumberOfLines={0}/);
  assert.doesNotMatch(courses + course, /<Card|textTransform:\s*["']uppercase|sf:/);
  assert.equal(existsSync(new URL("src/components/study-list-item.tsx", root)), false);
  assert.equal(existsSync(new URL("src/lib/theme.ts", root)), false);
});
test("no application code uses an Expo icon pack or SF-symbol image source", () => {
  function scan(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const path = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
      return entry.isDirectory() ? scan(path) : /\.tsx?$/.test(entry.name) ? [readFileSync(path, "utf8")] : [];
    });
  }
  assert.doesNotMatch(scan(new URL("src/", root)).join("\n"), /sf:|@expo\/vector-icons|expo-symbols/);
  const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  assert.equal(manifest.dependencies["expo-symbols"], undefined);
});
test("the installed preview is source-pinned and its archive matches npm lock integrity", () => {
  const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  const lock = JSON.parse(readFileSync(new URL("package-lock.json", root), "utf8"));
  const dependency = manifest.dependencies["@dotnaos/ui"];
  assert.match(dependency, /^file:vendor\/dotnaos-ui-0\.0\.0-native\.[a-f0-9]{12}\.tgz$/);
  const bytes = readFileSync(new URL(dependency.slice(5), root));
  const digest = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  assert.equal(lock.packages["node_modules/@dotnaos/ui"].integrity, digest);
  const installed = JSON.parse(readFileSync(new URL("node_modules/@dotnaos/ui/package.json", root), "utf8"));
  assert.match(installed.dotnaosSourceCommit, /^[a-f0-9]{40}$/);
  assert.ok(dependency.includes(installed.dotnaosSourceCommit.slice(0, 12)));
  assert.ok(installed.exports["./native"]);
  assert.equal(installed.dependencies["lucide-react-native"], "0.562.0");
});
