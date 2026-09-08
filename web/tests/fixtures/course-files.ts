import type { CourseSection, CourseResource } from "../../src/api";
import { syntheticCourseImage } from "./course-images";

// Entirely synthetic PDF: text, two distinct pages, and inert hostile actions.
export function syntheticPdf() {
  const stream = (page: number) =>
    `0.15 0.35 0.45 rg 40 590 515 180 re f\nBT /F1 28 Tf 1 1 1 rg 60 710 Td (Study Space - Page ${page}) Tj 0 -42 Td /F1 16 Tf (Synthetic course material) Tj ET\nBT /F1 18 Tf 0 0 0 rg 60 530 Td (Chapter ${page}: ${page === 1 ? "Functions and sets" : "Exercises and solutions"}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /JavaScript /JS (app.alert('SHOULD_NOT_RUN')) >> >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R /Annots [8 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...[1, 2].map(
      (page) =>
        `<< /Length ${stream(page).length} >>\nstream\n${stream(page)}\nendstream`,
    ),
    "<< /Type /Annot /Subtype /Link /Rect [40 590 555 770] /A << /S /URI /URI (https://example.invalid/should-not-request) >> >>",
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  return new TextEncoder().encode(
    `${pdf}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`,
  );
}
function file(
  courseId: number,
  moduleId: number,
  digit: string,
  name: string,
  kind: "pdf" | "image" | null,
  size = 2048,
): CourseResource {
  const id = digit.repeat(64),
    path = `/api/providers/moodle/courses/${courseId}/modules/${moduleId}/resources/${id}`;
  return {
    id,
    type: "file",
    name,
    mimeType:
      kind === "image"
        ? "image/png"
        : kind === "pdf"
          ? "application/pdf"
          : "application/msword",
    size,
    modifiedAt: null,
    url: null,
    previewKind: kind,
    previewUrl: kind ? `${path}/preview` : null,
    downloadUrl: `${path}/download`,
  };
}
export function fileSections(
  input: CourseSection[],
  courseId: number,
  site: string,
): CourseSection[] {
  const sections = structuredClone(input);
  sections[0].modules[0].resources = [
    file(courseId, 501, "a", "Kursübersicht_Herbstsemester_2026.pdf", "pdf"),
  ];
  sections[1].modules[0].resources = [
    file(
      courseId,
      502,
      "b",
      "Vorlesung_01_Funktionen_und_Abbildungen_mit_ausführlichen_Beispielen.pdf",
      "pdf",
    ),
    file(courseId, 502, "c", "Diagramm_Funktionen.png", "image"),
    file(courseId, 502, "d", "Abgabevorlage.doc", null),
    file(courseId, 502, "7", "Portraitdiagramm.png", "image"),
  ];
  const cases: [number, string, string, string, number][] = [
    [509, "e", "Beschädigte Datei", "defekt.pdf", 2048],
    [510, "f", "Nicht verfügbare Datei", "fehler.pdf", 2048],
    [511, "1", "Langsam ladende Datei", "langsam.pdf", 2048],
    [512, "4", "Große Unterlagen", "gross.pdf", 40 * 1024 * 1024],
  ];
  sections.push({
    id: 4,
    name: "Vorschau-Testfälle",
    summary: "Synthetische Testdateien",
    modules: cases.map(([id, digit, name, filename, size]) => ({
      id,
      name,
      type: "resource",
      url: `${site}/mod/resource/view.php?id=${id}`,
      description: "",
      resources: [file(courseId, id, digit, filename, "pdf", size)],
    })),
  });
  sections[1].modules.push({
    id: 514,
    name: "Online-Lektion",
    type: "page",
    url: `${site}/mod/page/view.php?id=514`,
    description: "",
    resources: [
      {
        ...file(courseId, 514, "6", "index.html", null),
        mimeType: "text/html",
      },
    ],
  });
  return sections;
}
export async function fileResponse(
  path: string,
): Promise<Response | undefined> {
  const match = path.match(
    /^\/api\/providers\/moodle\/courses\/\d+\/modules\/\d+\/resources\/([a-f0-9]{64})\/(preview|download)$/,
  );
  if (!match) return;
  const digit = match[1][0],
    download = match[2] === "download";
  if (digit === "f")
    return Response.json(
      { detail: "Die Testdatei ist derzeit nicht verfügbar." },
      { status: 503 },
    );
  if (digit === "1") await Bun.sleep(5000);
  const bytes =
    digit === "7"
      ? syntheticCourseImage(42, 600, 1600)
      : digit === "c"
        ? syntheticCourseImage(41)
        : digit === "d"
          ? new TextEncoder().encode(
              "{\\rtf1\\ansi Synthetic assignment template}",
            )
          : digit === "e"
            ? new TextEncoder().encode("This is not a PDF")
            : syntheticPdf();
  return new Response(bytes, {
    headers: {
      "Content-Type": download
        ? "application/octet-stream"
        : ["c", "7"].includes(digit)
          ? "image/png"
          : "application/pdf",
      "Cache-Control": "no-store",
      ...(download
        ? {
            "Content-Disposition": `attachment; filename="${digit === "d" ? "Abgabevorlage.doc" : "datei.pdf"}"`,
          }
        : {}),
    },
  });
}
