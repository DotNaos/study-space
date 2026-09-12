import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const src = new URL("../src/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, src), "utf8");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : /\.(tsx?|jsx?)$/.test(entry.name)
        ? [path]
        : [];
  });
}

test("generic Study Space controls come from the DotNaos component library", () => {
  const learning = read("LearningPanel.tsx");
  expect(learning).toContain("Button, Checkbox, Select");
  expect(learning).toContain("<Checkbox");
  expect(learning).toContain("<Select");

  const answer = read("ExerciseAnswer.tsx");
  expect(answer).toContain("Form, Textarea");
  expect(answer).toContain("<Form.Field");
  expect(answer).toContain("<Textarea");

  const shared = read("shared.tsx");
  expect(shared).toContain("Container, Icon, Spinner, Text");
  expect(shared).toContain("<Spinner");

  const theme = read("ThemeToggle.tsx");
  expect(theme).toContain("<Button");
  expect(theme).not.toContain("<button");

  const activities = read("CourseActivities.tsx");
  expect(activities).toContain("Icon.File");
  expect(activities).not.toContain('from "lucide-react"');
});

test("native form primitives are not duplicated in app source", () => {
  const files = sourceFiles(new URL("../src/", import.meta.url).pathname);
  const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
  expect(source).not.toContain("<textarea");
  expect(source).not.toContain("<select");
  expect(source).not.toContain('type="checkbox"');
});
