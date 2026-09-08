import type { CourseModule, CourseResource } from "./api";

export function cleanCourseText(value: string): string {
  return value
    .split(/\r?\n/)
    .filter((line) => !/^[\s_\-=–—·.…]{3,}$/.test(line))
    .join("\n")
    .trim();
}

export function visibleResources(module: CourseModule): CourseResource[] {
  // Moodle URL activities expose bookkeeping contents as well as the activity
  // link. They are not downloadable files; do not display them as "0 B" files.
  return module.resources.filter(
    (resource) => resource.type === "file" && cleanCourseText(resource.name),
  );
}

export function visibleModule(module: CourseModule): boolean {
  if (module.type !== "label") return true;
  return Boolean(
    cleanCourseText(module.name) ||
    cleanCourseText(module.description) ||
    visibleResources(module).length,
  );
}

export function duplicateResourceName(
  moduleName: string,
  fileName: string,
): boolean {
  const normalize = (value: string) =>
    value
      .replace(/\.[a-z0-9]{1,6}$/i, "")
      .toLocaleLowerCase("de")
      .replace(/[^\p{L}\p{N}]/gu, "");
  return normalize(moduleName) === normalize(fileName);
}

export function formatFileSize(size: number | null): string | undefined {
  if (size === null || !Number.isFinite(size) || size < 0) return undefined;
  const unit = size >= 1024 * 1024 ? "MB" : size >= 1024 ? "KB" : "B";
  const divisor = unit === "MB" ? 1024 * 1024 : unit === "KB" ? 1024 : 1;
  return `${new Intl.NumberFormat("de-CH", { maximumFractionDigits: 1 }).format(size / divisor)} ${unit}`;
}
