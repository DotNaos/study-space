export type SystemStatus = {
  app: string;
  version: string;
  commit: string;
  hostname: string;
  publicUrl: string;
  database: "ready" | "unavailable";
};
export type Settings = { displayName: string; locale: string };
export type Connection = {
  status: "disconnected" | "connected" | "expired";
  siteUrl?: string | null;
  siteName?: string | null;
  displayName?: string | null;
  lastVerifiedAt?: string | null;
};
export type LoginMethod = "browser-sso" | "qr";
export type Discovery = {
  siteUrl: string;
  siteName: string;
  loginMode: string;
  methods: LoginMethod[];
  warnings: string[];
};
export type Login = {
  id: string;
  status: "pending" | "completed" | "expired" | "failed";
  method?: LoginMethod;
  expiresAt: string;
  launchUrl?: string | null;
  pairingUrl?: string | null;
  instructions?: string[];
  message?: string | null;
};
export type Course = {
  id: number;
  name: string;
  shortName: string;
  summary: string;
  imageUrl?: string | null;
  startDate?: number | null;
  endDate?: number | null;
};

export type ProjectConfig = { moodle: { siteUrl: string | null } };
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

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    signal: options?.signal ?? AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      problem?.code,
      problem?.detail ||
        problem?.title ||
        `Die Anfrage ist fehlgeschlagen (${response.status}).`,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export function message(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError")
    return "Die Anfrage dauert zu lange. Bitte die Verbindung prüfen und erneut versuchen.";
  if (error instanceof TypeError)
    return "Study Space ist gerade nicht erreichbar. Bitte die Verbindung prüfen und erneut versuchen.";
  return error instanceof Error
    ? error.message
    : "Die Verbindung ist fehlgeschlagen. Bitte erneut versuchen.";
}

export function safeWebUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
