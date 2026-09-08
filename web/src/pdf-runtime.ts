import { getDocument, PDFWorker, AnnotationMode } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// Vite emits package-owned resources beside the app. Only exact entries in
// these build-time maps may be fetched; PDF-provided paths never become URLs.
const cMaps = import.meta.glob<string>(
  "../node_modules/pdfjs-dist/cmaps/*.bcmap",
  { eager: true, query: "?url&no-inline", import: "default" },
);
const fonts = import.meta.glob<string>(
  "../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}",
  { eager: true, query: "?url&no-inline", import: "default" },
);

class LocalPdfDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const asset =
      kind === "cMapUrl"
        ? cMaps[`../node_modules/pdfjs-dist/cmaps/${filename}`]
        : kind === "standardFontDataUrl"
          ? fonts[`../node_modules/pdfjs-dist/standard_fonts/${filename}`]
          : undefined;
    if (!asset)
      throw new Error("PDF-Schrift oder Zeichensatz ist nicht verfügbar.");
    const url = new URL(asset, window.location.href);
    if (url.origin !== window.location.origin)
      throw new Error("Externe PDF-Ressourcen sind nicht erlaubt.");
    const response = await fetch(url.href, {
      credentials: "same-origin",
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(
        "PDF-Schrift oder Zeichensatz konnte nicht geladen werden.",
      );
    return new Uint8Array(await response.arrayBuffer());
  }
}

export function openLocalPdf(bytes: Uint8Array) {
  // Supply a real local worker explicitly; do not silently fall back to parsing
  // on the UI thread. Version 6 has no eval option and uses its JS interpreter
  // when WASM is disabled. No viewer scripting/action/annotation layer is used.
  const nativeWorker = new Worker(workerUrl, { type: "module" });
  const worker = PDFWorker.create({ port: nativeWorker });
  const task = getDocument({
    data: bytes.slice(),
    worker,
    BinaryDataFactory: LocalPdfDataFactory,
    useWorkerFetch: false,
    useWasm: false,
    enableXfa: false,
    disableAutoFetch: true,
    disableRange: true,
    disableStream: true,
    maxImageSize: 16 * 1024 * 1024,
    canvasMaxAreaInBytes: 64 * 1024 * 1024,
    useSystemFonts: false,
    stopAtErrors: true,
    verbosity: 0,
  });
  let disposed = false;
  return {
    task,
    dispose() {
      if (disposed) return;
      disposed = true;
      const stop = () => {
        worker.destroy();
        nativeWorker.terminate();
      };
      // A busy worker may never acknowledge PDF.js's graceful Terminate request.
      // Closing the preview must still stop its work promptly and unconditionally.
      const timeout = window.setTimeout(stop, 100);
      void task
        .destroy()
        .catch(() => {})
        .finally(() => {
          window.clearTimeout(timeout);
          stop();
        });
    },
  };
}

export const pdfAnnotationMode = AnnotationMode.DISABLE;
export const maxCanvasPixels = 8 * 1024 * 1024;
