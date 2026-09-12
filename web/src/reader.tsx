import { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@dotnaos/ui-base";
import { ImagePreview } from "./ImagePreview";
import { fetchPreviewBytes } from "./resource-preview";
import { readerLocation } from "./reader-location";
import { Loading } from "./shared";
import { ErrorBoundary } from "./ErrorBoundary";
import "./styles.css";

const PdfPreview = lazy(() => import("./PdfPreview").then(module => ({ default: module.PdfPreview })));
const location = readerLocation(window.location.search);
if (location) {
  document.documentElement.dataset.theme = location.theme;
  document.title = location.name;
}

function Reader() {
  const [file, setFile] = useState<{ bytes: Uint8Array; mimeType: string }>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!location) return;
    const controller = new AbortController();
    setFile(undefined); setError("");
    void fetchPreviewBytes(location.path, location.kind, controller.signal)
      .then(result => { if (!controller.signal.aborted) setFile(result); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Das Dokument konnte nicht geladen werden."); });
    return () => controller.abort();
  }, [attempt]);
  return <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-bg-0 text-text" aria-label={location?.name ?? "Dokument"}>
    {!location || error ? <div className="m-auto max-w-lg space-y-4 p-6" role="alert">
      <p>{!location ? "Ungültige Dokumentadresse." : error}</p>
      {location && <Button label="Erneut versuchen" onPress={() => setAttempt(value => value + 1)} />}
    </div> : !file ? <div className="m-auto p-6"><Loading label="Dokument wird geladen …" /></div> :
      <Suspense fallback={<div className="m-auto p-6"><Loading label="Dokument wird angezeigt …" /></div>}>
        {location.kind === "pdf" ? <PdfPreview bytes={file.bytes} onError={setError} /> :
          <ImagePreview bytes={file.bytes} mimeType={file.mimeType} name={location.name} onError={setError} />}
      </Suspense>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<ErrorBoundary><Reader /></ErrorBoundary>);
