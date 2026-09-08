import type { Course } from "./api";

export type Semester = {
  key: string;
  label: string;
  shortLabel: string;
  order: number;
};
export type CourseGroup = { semester: Semester; courses: Course[] };
const general: Semester = {
  key: "general",
  label: "Allgemein",
  shortLabel: "Allgemein",
  order: -1,
};

// Only explicit HS/FS + year labels count. Dates and bare years do not establish
// a semester. Conflicting labels remain ungrouped rather than guessing.
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
      const year =
        rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
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
  if (!short || name === short || ` ${name} `.includes(` ${short} `))
    return undefined;
  return course.shortName;
}

export function groupCourses(courses: Course[], query = ""): CourseGroup[] {
  const groups = new Map<string, CourseGroup>();
  const terms = normalized(query).split(" ").filter(Boolean);
  for (const course of courses) {
    const semester = courseSemester(course) || general;
    const aliases = `${semester.shortLabel.replace(/\s/g, "")} ${semester.shortLabel.replace(/\s20/, "")}`;
    const searchable = normalized(
      `${course.name} ${course.shortName} ${semester.label} ${semester.shortLabel} ${aliases}`,
    );
    if (!terms.every((term) => searchable.includes(term))) continue;
    const group = groups.get(semester.key) || { semester, courses: [] };
    group.courses.push(course);
    groups.set(semester.key, group);
  }
  return [...groups.values()].sort(
    (a, b) => b.semester.order - a.semester.order,
  );
}

export function courseImagePath(
  course: Pick<Course, "id" | "imageUrl">,
): string | undefined {
  // The backend owns authenticated image fetching. Never send the browser to a
  // Moodle file URL or accept a different origin supplied through course data.
  const expected = `/api/providers/moodle/courses/${course.id}/image`;
  return course.imageUrl === expected ? expected : undefined;
}
