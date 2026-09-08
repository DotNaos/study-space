import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus, ScanLine } from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import {
  maxCanvasPixels,
  openLocalPdf,
  pdfAnnotationMode,
} from "./pdf-runtime";
import { ViewerButton } from "./ViewerButton";
import { Loading } from "./shared";

export function PdfPreview({
  bytes,
  onError,
}: {
  bytes: Uint8Array;
  onError: (error: string) => void;
}) {
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [rendering, setRendering] = useState(true);
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let stopped = false;
    let loading: ReturnType<typeof openLocalPdf>;
    try {
      loading = openLocalPdf(bytes);
    } catch {
      onError(
        "Die PDF-Vorschau konnte nicht gestartet werden. Bitte lade die Datei herunter.",
      );
      return;
    }
    const timeout = window.setTimeout(() => {
      if (!stopped) {
        onError(
          "Das PDF benötigt zu lange zum Öffnen. Bitte lade es herunter.",
        );
        void loading.dispose();
      }
    }, 20000);
    void loading.task.promise
      .then((document) => {
        if (!stopped) setDocument(document);
      })
      .catch((error: unknown) => {
        if (!stopped)
          onError(
            error instanceof Error && error.name === "PasswordException"
              ? "Dieses PDF ist passwortgeschützt. Bitte lade es herunter und öffne es in einem PDF-Programm."
              : "Dieses PDF konnte nicht geöffnet werden. Bitte lade es herunter oder öffne es in Moodle.",
          );
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      stopped = true;
      window.clearTimeout(timeout);
      void loading.dispose();
    };
  }, [bytes, onError]);
  useEffect(() => {
    const host = scrollRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => setWidth(host.clientWidth));
    observer.observe(host);
    setWidth(host.clientWidth);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!document || !width) return;
    let stopped = false;
    let task: RenderTask | undefined;
    const timeout = window.setTimeout(() => {
      if (!stopped) {
        stopped = true;
        task?.cancel();
        onError(
          "Diese PDF-Seite benötigt zu lange zum Anzeigen. Bitte lade die Datei herunter.",
        );
      }
    }, 20000);
    setRendering(true);
    setText("");
    void (async () => {
      const page = await document.getPage(pageNumber);
      if (stopped) return;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: Math.max(0.1, (width - 32) / base.width) * zoom,
      });
      const ratio = Math.min(
        window.devicePixelRatio || 1,
        2,
        Math.sqrt(maxCanvasPixels / (viewport.width * viewport.height)),
      );
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
      canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      canvas.setAttribute("aria-hidden", "true");
      try {
        task = page.render({
          canvas,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
          annotationMode: pdfAnnotationMode,
          background: "white",
        });
        await task.promise;
        const content = await page.getTextContent();
        if (!stopped) {
          pageRef.current?.replaceChildren(canvas);
          setText(
            content.items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" "),
          );
          setRendering(false);
          window.clearTimeout(timeout);
        }
      } finally {
        page.cleanup();
      }
    })().catch((error: unknown) => {
      if (
        !stopped &&
        !(
          error instanceof Error && error.name === "RenderingCancelledException"
        )
      )
        onError(
          "Diese PDF-Seite konnte nicht angezeigt werden. Bitte lade die Datei herunter.",
        );
    });
    return () => {
      stopped = true;
      window.clearTimeout(timeout);
      task?.cancel();
    };
  }, [document, pageNumber, zoom, width, onError]);
  function changePage(next: number) {
    setPageNumber(next);
    setPageInput(String(next));
    scrollRef.current?.scrollTo({ top: 0, left: 0 });
  }
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.target instanceof HTMLInputElement || !document) return;
        if (event.key === "ArrowRight" && pageNumber < document.numPages) {
          event.preventDefault();
          changePage(pageNumber + 1);
        }
        if (event.key === "ArrowLeft" && pageNumber > 1) {
          event.preventDefault();
          changePage(pageNumber - 1);
        }
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-3 py-1.5 sm:px-5">
        <div className="flex items-center gap-1">
          <ViewerButton
            label="Vorherige Seite"
            disabled={!document || pageNumber <= 1}
            onClick={() => changePage(pageNumber - 1)}
          >
            <ChevronLeft size={18} />
          </ViewerButton>
          {document ? (
            <form
              className="flex items-center gap-1.5 text-xs tabular-nums text-text-muted"
              onSubmit={(event) => {
                event.preventDefault();
                if (/^\d+$/.test(pageInput.trim()))
                  changePage(
                    Math.max(1, Math.min(document.numPages, Number(pageInput))),
                  );
                else setPageInput(String(pageNumber));
              }}
            >
              <label htmlFor="pdf-page-number">Seite</label>
              <input
                id="pdf-page-number"
                aria-label="Seitennummer"
                inputMode="numeric"
                value={pageInput}
                onChange={(event) => setPageInput(event.target.value)}
                className="h-8 w-10 rounded border border-border bg-bg-0 px-1 text-center text-text focus-visible:outline-2 focus-visible:outline-focus-ring"
              />
              <span aria-live="polite">/ {document.numPages}</span>
            </form>
          ) : (
            <span className="text-xs text-text-muted">PDF wird geladen</span>
          )}
          <ViewerButton
            label="Nächste Seite"
            disabled={!document || pageNumber >= document.numPages}
            onClick={() => changePage(pageNumber + 1)}
          >
            <ChevronRight size={18} />
          </ViewerButton>
        </div>
        <div className="flex items-center gap-1">
          <ViewerButton
            label="Verkleinern"
            disabled={zoom <= 0.5}
            onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
          >
            <Minus size={16} />
          </ViewerButton>
          <span className="w-10 text-center text-xs tabular-nums text-text-muted">
            {Math.round(zoom * 100)}%
          </span>
          <ViewerButton
            label="Vergrößern"
            disabled={zoom >= 3}
            onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
          >
            <Plus size={16} />
          </ViewerButton>
          <ViewerButton label="An Breite anpassen" onClick={() => setZoom(1)}>
            <ScanLine size={17} />
          </ViewerButton>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-auto bg-bg-1 p-4"
        role="document"
        aria-label={`PDF, Seite ${pageNumber}`}
        aria-busy={rendering}
      >
        {rendering && (
          <div className="sticky top-2 z-10 mx-auto mb-3 w-fit rounded-md bg-bg-0 px-3 py-2 shadow-sm">
            <Loading label="Seite wird angezeigt …" />
          </div>
        )}
        <div ref={pageRef} className="mx-auto w-fit bg-white shadow-sm" />
        <p className="sr-only">
          {text || "Die PDF-Seite enthält keinen auslesbaren Text."}
        </p>
      </div>
    </div>
  );
}
