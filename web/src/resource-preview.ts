import { safeWebUrl, type CourseModule, type CourseResource } from "./api";

export type ResourcePreview = {
  name: string;
  kind: "pdf" | "image";
  path: string;
  downloadUrl?: string;
  moodleUrl?: string;
  initialPage?: number;
};
export type ResourceAction =
  | { kind: "preview"; preview: ResourcePreview }
  | { kind: "download" | "moodle"; href: string }
  | { kind: "none" };
export const maxPreviewBytes = 32 * 1024 * 1024;
const previewPathPattern =
  /^\/api\/providers\/moodle\/courses\/[1-9]\d*\/modules\/[1-9]\d*\/resources\/[a-f0-9]{64}\/preview$/;
const importedAssetPattern =
  /^\/api\/materials\/[a-f0-9]{64}\/revisions\/[a-f0-9]{64}\/assets\/[a-z0-9-]{1,80}$/;

export function resourcePath(
  courseId: number,
  moduleId: number,
  resource: CourseResource,
  action: "preview" | "download",
): string | undefined {
  if (
    !Number.isSafeInteger(courseId) ||
    courseId <= 0 ||
    !Number.isSafeInteger(moduleId) ||
    moduleId <= 0 ||
    !resource.id ||
    !/^[a-f0-9]{64}$/.test(resource.id)
  )
    return undefined;
  const expected = `/api/providers/moodle/courses/${courseId}/modules/${moduleId}/resources/${resource.id}/${action}`;
  return resource[action === "preview" ? "previewUrl" : "downloadUrl"] ===
    expected
    ? expected
    : undefined;
}

export function resourceAction(
  courseId: number,
  module: CourseModule,
  resource: CourseResource,
): ResourceAction {
  const path = resourcePath(courseId, module.id, resource, "preview");
  const downloadUrl = resourcePath(courseId, module.id, resource, "download");
  const moodleUrl = safeWebUrl(module.url);
  if (resource.size !== null && resource.size > maxPreviewBytes)
    return moodleUrl ? { kind: "moodle", href: moodleUrl } : { kind: "none" };
  if (
    path &&
    (resource.previewKind === "pdf" || resource.previewKind === "image")
  )
    return {
      kind: "preview",
      preview: {
        name: resource.name,
        kind: resource.previewKind,
        path,
        downloadUrl,
        moodleUrl,
      },
    };
  if (downloadUrl) return { kind: "download", href: downloadUrl };
  return moodleUrl ? { kind: "moodle", href: moodleUrl } : { kind: "none" };
}

// Fetch only the authenticated app endpoint, with no redirect or external URL
// handed to an image decoder/PDF renderer. Keep the same bound as the server.
export async function fetchPreviewBytes(
  path: string,
  kind: ResourcePreview["kind"],
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (!previewPathPattern.test(path) && !importedAssetPattern.test(path))
    throw new Error("Diese Vorschau ist nicht verfügbar.");
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(50000)]),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    throw new Error(
      problem?.detail ||
        "Die Datei konnte nicht geladen werden. Bitte erneut versuchen.",
    );
  }
  const mimeType = (response.headers.get("Content-Type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (
    kind === "pdf"
      ? mimeType !== "application/pdf"
      : !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
          mimeType,
        )
  )
    throw new Error("Dieses Dateiformat kann hier nicht angezeigt werden.");
  if (Number(response.headers.get("Content-Length")) > maxPreviewBytes) {
    await response.body?.cancel();
    throw new Error("Die Datei ist für die Vorschau zu groß (maximal 32 MB).");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Die Datei ist leer.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxPreviewBytes) {
        await reader.cancel();
        throw new Error(
          "Die Datei ist für die Vorschau zu groß (maximal 32 MB).",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!total) throw new Error("Die Datei ist leer.");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, mimeType };
}
