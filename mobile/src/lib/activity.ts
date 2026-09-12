import type { CourseResource } from "./api";

export type Assignment = {
  assignmentId: number | null;
  title: string;
  description: string;
  opensAt: number | null;
  dueAt: number | null;
  cutoffAt: number | null;
  status: string;
  submissionStatus: string | null;
  gradingStatus: string | null;
  canSubmit: boolean | null;
  locked: boolean | null;
  submittedAt: number | null;
  warnings: string[];
};
export type Activity = {
  courseId: number;
  moduleId: number;
  sectionId: number;
  type: string;
  title: string;
  description: string;
  instructions: string;
  content: string;
  resources: CourseResource[];
  assignment: Assignment | null;
  submissionRequirements: {
    filesEnabled: boolean | null;
    maximumFiles: number | null;
    maximumFileBytes: number | null;
    acceptedFileTypes: string | null;
    onlineTextEnabled: boolean | null;
  } | null;
  partial: boolean;
  warnings: string[];
};
export function positiveId(value: string | undefined): number | undefined {
  if (!value || !/^[1-9]\d*$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}
export function resourceParams(courseId: number, moduleId: number, resource: CourseResource) {
  if (!Number.isSafeInteger(courseId) || courseId <= 0 || !Number.isSafeInteger(moduleId) || moduleId <= 0 || !resource.id || !/^[a-f0-9]{64}$/.test(resource.id)) return undefined;
  return { courseId: String(courseId), moduleId: String(moduleId), resourceId: resource.id };
}
export function readerPath(courseId: number, moduleId: number, resource: CourseResource, theme: string): string | undefined {
  if (!resourceParams(courseId, moduleId, resource) || !["pdf", "image"].includes(resource.previewKind ?? "")) return undefined;
  const expected = `/api/providers/moodle/courses/${courseId}/modules/${moduleId}/resources/${resource.id}/preview`;
  if (resource.previewUrl !== expected) return undefined;
  return `/reader.html?${new URLSearchParams({ path: expected, kind: resource.previewKind!, name: resource.name, theme: theme === "dark" ? "dark" : "light" })}`;
}
export function deadline(timestamp: number | null): string {
  return timestamp && Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(new Date(timestamp * 1000))
    : "Nicht angegeben";
}
export function submissionLabel(value: string | null): string {
  return ({ new: "Noch nicht abgegeben", draft: "Entwurf", submitted: "Abgegeben", reopened: "Erneut geöffnet" } as Record<string, string>)[value ?? ""] ?? "Nicht verfügbar";
}
export function gradingLabel(value: string | null): string {
  return ({ notgraded: "Noch nicht bewertet", graded: "Bewertet", inprogress: "In Bearbeitung", readyforreview: "Bereit zur Prüfung", released: "Bewertung freigegeben" } as Record<string, string>)[value ?? ""] ?? "Nicht verfügbar";
}
