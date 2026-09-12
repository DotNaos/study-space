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

export async function api<T>(path: string): Promise<T> {
  const response = await fetch(studyUrl(path), {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      problem?.code,
      problem?.detail ?? problem?.title ?? `Die Anfrage ist fehlgeschlagen (${response.status}).`,
    );
  }

  return response.json() as Promise<T>;
}

export function message(error: unknown): string {
  if (error instanceof TypeError) {
    return "Study Space ist nicht erreichbar. Prüfe Tailscale und den Study-Space-Host.";
  }
  return error instanceof Error ? error.message : "Die Verbindung ist fehlgeschlagen.";
}
