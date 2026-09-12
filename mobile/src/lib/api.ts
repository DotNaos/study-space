export const STUDY_BASE_URL = (
  process.env.EXPO_PUBLIC_STUDY_BASE_URL ??
  "https://study.os-pc.vpn.os-home.net"
).replace(/\/$/, "");

export type Course = {
  id: number;
  name: string;
  shortName: string;
  summary: string;
  imageUrl?: string | null;
  startDate?: number | null;
  endDate?: number | null;
};

export type CourseResource = {
  id?: string | null;
  previewUrl?: string | null;
  downloadUrl?: string | null;
  previewKind?: "pdf" | "image" | null;
  type: string;
  name: string;
  mimeType: string | null;
  size: number | null;
  modifiedAt: number | null;
  url: string | null;
};

export type CourseModule = {
  id: number;
  name: string;
  type: string;
  url: string | null;
  description: string;
  resources: CourseResource[];
  subsectionId?: number | null;
};

export type CourseSection = {
  id: number;
  name: string;
  summary: string;
  modules: CourseModule[];
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    detail: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

export function studyUrl(path: string): string {
  if (!path.startsWith("/")) throw new Error("Study API paths must be absolute.");
  return `${STUDY_BASE_URL}${path}`;
}

export async function api<T>(path: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 60000);
  try {
    const response = await fetch(studyUrl(path), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => null);
      throw new ApiError(
        response.status,
        problem?.code,
        problem?.detail ?? problem?.title ?? `Die Anfrage ist fehlgeschlagen (${response.status}).`,
      );
    }
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export function message(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "Die Anfrage dauert zu lange. Bitte erneut versuchen.";
  }
  if (error instanceof TypeError) {
    return "Study Space ist nicht erreichbar. Prüfe Tailscale und den Study-Space-Host.";
  }
  return error instanceof Error ? error.message : "Die Verbindung ist fehlgeschlagen.";
}
