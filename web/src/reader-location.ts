export function readerLocation(search: string) {
  const params = new URLSearchParams(search);
  const path = params.get("path") ?? "";
  const kind = params.get("kind");
  if (!/^\/api\/providers\/moodle\/courses\/[1-9]\d*\/modules\/[1-9]\d*\/resources\/[a-f0-9]{64}\/preview$/.test(path) || (kind !== "pdf" && kind !== "image")) return undefined;
  return { path, kind, name: (params.get("name") || "Dokument").slice(0, 300), theme: params.get("theme") === "dark" ? "dark" : "light" } as const;
}
