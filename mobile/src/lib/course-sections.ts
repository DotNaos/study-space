import type { CourseModule, CourseSection } from "./api";

/** Follow Moodle's explicit relationship, never a similar-looking section name. */
export function subsectionFor(module: CourseModule, sections: CourseSection[]): CourseSection | undefined {
  if (module.type !== "subsection" || !Number.isSafeInteger(module.subsectionId) || (module.subsectionId ?? 0) <= 0)
    return undefined;
  return sections.find((section) => section.id === module.subsectionId);
}

/** Delegated sections appear at their parent activity instead of again at the end. */
export function rootCourseSections(sections: CourseSection[]): CourseSection[] {
  const children = new Map(sections.map((section) => [section.id, section.modules
    .map((module) => subsectionFor(module, sections))
    .filter((child): child is CourseSection => child !== undefined && child.id !== section.id)]));
  const nested = new Set([...children.values()].flat().map((section) => section.id));
  const roots = sections.filter((section) => !nested.has(section.id));
  const visited = new Set<number>();
  const visit = (section: CourseSection) => {
    if (visited.has(section.id)) return;
    visited.add(section.id);
    children.get(section.id)?.forEach(visit);
  };
  roots.forEach(visit);
  // Preserve otherwise unreachable/orphaned sections, including malformed cycles.
  for (const section of sections) {
    if (!visited.has(section.id)) {
      roots.push(section);
      visit(section);
    }
  }
  return roots;
}
