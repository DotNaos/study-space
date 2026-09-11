import type { Course, CourseModule, CourseResource } from "@/lib/api";

export type Semester = {
  key: string;
  label: string;
  shortLabel: string;
  order: number;
};

export type CourseGroup = { semester: Semester; data: Course[] };

const general: Semester = {
  key: "general",
  label: "Allgemein",
  shortLabel: "Allgemein",
  order: -1,
};

export function courseSemester(
  course: Pick<Course, "name" | "shortName">,
): Semester | undefined {
  const found = new Map<string, Semester>();
  for (const text of [course.name, course.shortName]) {
    const pattern =
      /(?:^|[^\p{L}\p{N}])(?:(HS|FS)[\s_./-]*((?:19|20)\d{2}|\d{2})|((?:19|20)\d{2}|\d{2})[\s_./-]*(HS|FS))(?=$|[^\p{L}\p{N}])/giu;
    for (const match of text.matchAll(pattern)) {
      const term = (match[1] || match[4]).toUpperCase();
      const rawYear = match[2] || match[3];
      const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
      const key = `${year}-${term}`;
      found.set(key, {
        key,
        label: `${term === "HS" ? "Herbstsemester" : "Frühlingssemester"} ${year}`,
        shortLabel: `${term} ${year}`,
        order: year * 2 + (term === "HS" ? 1 : 0),
      });
    }
  }
  return found.size === 1 ? found.values().next().value : undefined;
}

const normalized = (value: string) =>
  value
    .toLocaleLowerCase("de")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export function courseSubtitle(
  course: Pick<Course, "name" | "shortName">,
): string | undefined {
  const name = normalized(course.name);
  const short = normalized(course.shortName);
  if (!short || name === short || ` ${name} `.includes(` ${short} `)) return undefined;
  return course.shortName;
}

export function groupCourses(courses: Course[], query = ""): CourseGroup[] {
  const groups = new Map<string, CourseGroup>();
  const terms = normalized(query).split(" ").filter(Boolean);

  for (const course of courses) {
    const semester = courseSemester(course) ?? general;
    const aliases = `${semester.shortLabel.replace(/\s/g, "")} ${semester.shortLabel.replace(/\s20/, "")}`;
    const searchable = normalized(
      `${course.name} ${course.shortName} ${semester.label} ${semester.shortLabel} ${aliases}`,
    );
    if (!terms.every((term) => searchable.includes(term))) continue;
    const group = groups.get(semester.key) ?? { semester, data: [] };
    group.data.push(course);
    groups.set(semester.key, group);
  }

  return [...groups.values()].sort((a, b) => b.semester.order - a.semester.order);
}

export function courseImagePath(course: Pick<Course, "id" | "imageUrl">): string | undefined {
  const expected = `/api/providers/moodle/courses/${course.id}/image`;
  return course.imageUrl === expected ? expected : undefined;
}

export function visibleResources(module: CourseModule): CourseResource[] {
  return module.resources.filter((resource) => {
    if (resource.type !== "file" || !resource.name.trim()) return false;
    return !(
      ["page", "book", "url"].includes(module.type) &&
      /^index\.html?$/i.test(resource.name)
    );
  });
}

export function visibleModule(module: CourseModule): boolean {
  if (module.type !== "label") return true;
  return Boolean(module.name.trim() || module.description.trim() || visibleResources(module).length);
}

export function formatFileSize(size: number | null): string | undefined {
  if (size === null || !Number.isFinite(size) || size < 0) return undefined;
  const unit = size >= 1024 * 1024 ? "MB" : size >= 1024 ? "KB" : "B";
  const divisor = unit === "MB" ? 1024 * 1024 : unit === "KB" ? 1024 : 1;
  return `${new Intl.NumberFormat("de-CH", { maximumFractionDigits: 1 }).format(size / divisor)} ${unit}`;
}
