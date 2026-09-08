import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, X, ArrowUpRight } from "lucide-react";
import { Button } from "@dotnaos/ui-base";
import { fetchPreviewBytes, type ResourcePreview } from "./resource-preview";
import { message } from "./api";
import { ImagePreview } from "./ImagePreview";
import { Loading, Notice, linkClass } from "./shared";
import { viewerButtonClass } from "./ViewerButton";

const PdfPreview = lazy(() =>
  import("./PdfPreview").then((module) => ({ default: module.PdfPreview })),
);

export function ResourceViewer({
  preview,
  onClose,
}: {
  preview: ResourcePreview;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [file, setFile] = useState<{ bytes: Uint8Array; mimeType: string }>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setFile(undefined);
    setError("");
    void fetchPreviewBytes(preview.path, preview.kind, controller.signal)
      .then((file) => {
        if (!controller.signal.aborted) setFile(file);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setError(message(error));
      });
    return () => controller.abort();
  }, [preview.path, preview.kind, attempt]);
  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="fixed inset-0 m-auto h-dvh max-h-none w-screen max-w-none flex-col overflow-hidden border border-border bg-bg-0 p-0 text-text shadow-2xl backdrop:bg-black/45 open:flex sm:h-[92dvh] sm:w-[94vw] sm:max-w-6xl sm:rounded-xl"
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2.5 sm:px-5">
        <FileText
          size={18}
          className="hidden shrink-0 text-text-muted sm:block"
          aria-hidden="true"
        />
        <h2
          id={titleId}
          className="min-w-0 flex-1 break-words text-sm font-medium leading-5"
        >
          {preview.name}
        </h2>
        {preview.downloadUrl && (
          <a
            href={preview.downloadUrl}
            download
            className={viewerButtonClass}
            aria-label="Datei herunterladen"
            title="Datei herunterladen"
          >
            <Download size={18} />
          </a>
        )}
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className={viewerButtonClass}
          aria-label="Vorschau schließen"
          title="Vorschau schließen"
        >
          <X size={20} />
        </button>
      </div>
      {error ? (
        <div className="m-auto max-w-lg space-y-5 p-6">
          <Notice>{error}</Notice>
          <div className="flex flex-wrap items-center gap-4">
            <Button
              label="Erneut versuchen"
              onPress={() => setAttempt((value) => value + 1)}
            />
            {preview.moodleUrl && (
              <a
                href={preview.moodleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
              >
                In Moodle öffnen <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            )}
          </div>
        </div>
      ) : !file ? (
        <div className="m-auto p-6">
          <Loading label="Datei wird geladen …" />
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="m-auto p-6">
              <Loading label="PDF-Vorschau wird geladen …" />
            </div>
          }
        >
          {preview.kind === "pdf" ? (
            <PdfPreview bytes={file.bytes} onError={setError} />
          ) : (
            <ImagePreview
              bytes={file.bytes}
              mimeType={file.mimeType}
              name={preview.name}
              onError={setError}
            />
          )}
        </Suspense>
      )}
    </dialog>,
    document.body,
  );
}
