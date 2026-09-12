import { lazy, Suspense, useEffect, useState } from "react";
import { Button, Icon } from "@dotnaos/ui-base";
import { Download } from "lucide-react";
import { api, message } from "./api";
import {
  materialDocumentPath,
  type MaterialAsset,
  type MaterialDocument,
} from "./material-api";
import type { SourceRef, LearningSource } from "./learning-api";
import { DialogShell } from "./DialogShell";
import { Loading, Notice, linkClass } from "./shared";
import { fetchPreviewBytes, type ResourcePreview } from "./resource-preview";

const ResourceViewer = lazy(() =>
  import("./ResourceViewer").then((module) => ({
    default: module.ResourceViewer,
  })),
);
export type SourceSelection = {
  materialId: string;
  revision: string;
  name: string;
  blockId?: string;
  page?: number | null;
};

export function sourceAssetPath(
  document: MaterialDocument,
  asset: MaterialAsset,
): string | undefined {
  const base = materialDocumentPath(document.materialId, document.revision);
  const expected =
    base && /^[a-z0-9-]{1,80}$/.test(asset.id)
      ? `${base}/assets/${asset.id}`
      : undefined;
  return expected &&
    asset.url === expected &&
    document.assets.some(
      (item) => item.id === asset.id && item.url === asset.url,
    )
    ? expected
    : undefined;
}
function PinnedImage({ path, name }: { path: string; name: string }) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void fetchPreviewBytes(path, "image", controller.signal)
      .then((file) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(
          new Blob([file.bytes.slice().buffer], { type: file.mimeType }),
        );
        setUrl(objectUrl);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error));
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);
  return error ? (
    <Notice>{error}</Notice>
  ) : url ? (
    <img
      src={url}
      alt={name}
      className="mx-auto block h-auto max-h-[60vh] max-w-full object-contain"
      onLoad={(event) => {
        if (
          event.currentTarget.naturalWidth * event.currentTarget.naturalHeight >
          32 * 1024 * 1024
        )
          setError("Die Abbildung ist für diese Vorschau zu groß.");
      }}
      onError={() =>
        setError("Die gespeicherte Abbildung konnte nicht angezeigt werden.")
      }
    />
  ) : (
    <Loading label="Quellenseite wird geladen …" />
  );
}
export function SourceViewer({
  source,
  onClose,
}: {
  source: SourceSelection;
  onClose: () => void;
}) {
  const [document, setDocument] = useState<MaterialDocument>();
  const [error, setError] = useState("");
  const [original, setOriginal] = useState<ResourcePreview>();
  useEffect(() => {
    const path = materialDocumentPath(source.materialId, source.revision);
    if (!path) {
      setError("Diese Quellenangabe ist nicht gültig.");
      return;
    }
    const controller = new AbortController();
    void api<MaterialDocument>(path, { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return;
        if (
          value.materialId !== source.materialId ||
          value.revision !== source.revision ||
          (source.blockId &&
            !value.blocks.some(
              (block) =>
                block.id === source.blockId &&
                (source.page == null || block.page === source.page),
            ))
        )
          throw new Error(
            "Der zitierte Ausschnitt ist in dieser gespeicherten Quelle nicht vorhanden.",
          );
        setDocument(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error));
      });
    return () => controller.abort();
  }, [source.materialId, source.revision, source.blockId, source.page]);
  const selectedBlock = document?.blocks.find(
    (block) => block.id === source.blockId,
  );
  const page = source.page ?? selectedBlock?.page;
  const blocks =
    document?.blocks.filter((block) =>
      page != null
        ? block.page === page
        : source.blockId
          ? block.id === source.blockId
          : true,
    ) ?? [];
  const pageAsset =
    document?.assets.find(
      (asset) =>
        page != null && asset.kind === "page-image" && asset.page === page,
    ) ?? document?.assets.find((asset) => asset.id === selectedBlock?.assetId);
  const originalAsset = document?.assets.find(
    (asset) => asset.kind === "original",
  );
  const originalPath =
    document && originalAsset && sourceAssetPath(document, originalAsset);
  const pagePath =
    document && pageAsset && sourceAssetPath(document, pageAsset);
  function openOriginal() {
    if (!originalAsset || !originalPath) return;
    const kind =
      originalAsset.mimeType === "application/pdf"
        ? "pdf"
        : ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
              originalAsset.mimeType,
            )
          ? "image"
          : undefined;
    if (kind)
      setOriginal({
        kind,
        path: originalPath,
        downloadUrl: originalPath,
        name: source.name,
        initialPage: page ?? undefined,
      });
  }
  const originalPreviewable =
    originalAsset &&
    (originalAsset.mimeType === "application/pdf" ||
      ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
        originalAsset.mimeType,
      ));
  return (
    <>
      <DialogShell
        title={`${source.name}${page != null ? ` · Seite ${page}` : ""}`}
        onClose={onClose}
        wide
      >
        <div className="space-y-5 p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-text-muted">
              Gespeicherte Quelle dieses Lernbereichs
            </p>
            {originalPath && (
              <div className="flex items-center gap-4">
                {originalPreviewable && (
                  <Button
                    variant="ghost"
                    label="Original anzeigen"
                    onPress={openOriginal}
                  />
                )}
                <a className={linkClass} href={originalPath} download>
                  <Download size={15} /> Herunterladen
                </a>
              </div>
            )}
          </div>
          {error ? (
            <Notice>{error}</Notice>
          ) : !document ? (
            <Loading label="Quellenausschnitt wird geladen …" />
          ) : (
            <>
              {pagePath && pageAsset && (
                <PinnedImage
                  path={pagePath}
                  name={`${source.name}${page != null ? `, Seite ${page}` : ""}`}
                />
              )}
              {!document.complete && (
                <p className="text-sm text-warning">
                  Diese Quelle wurde teilweise erfasst. Abbildungen oder weitere
                  Inhalte können fehlen.
                </p>
              )}
              {blocks.length ? (
                <div className="space-y-4">
                  {blocks.map((block) => (
                    <div
                      key={block.id}
                      className={
                        block.id === source.blockId
                          ? "rounded-md border-l-2 border-accent bg-bg-1 px-4 py-3"
                          : "px-4"
                      }
                    >
                      {block.page != null && page == null && (
                        <p className="mb-1 text-xs text-text-muted">
                          Seite {block.page}
                        </p>
                      )}
                      {block.slide != null && (
                        <p className="mb-1 text-xs text-text-muted">
                          Folie {block.slide}
                        </p>
                      )}
                      {block.cells?.length ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-sm">
                            <tbody>
                              {block.cells.map((row, rowIndex) => (
                                <tr key={rowIndex}>
                                  {row.map((cell, index) => (
                                    <td
                                      key={index}
                                      className="border-b border-border px-3 py-2 align-top"
                                    >
                                      {cell}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap break-words text-sm leading-7">
                          {block.text}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-text-muted">
                  Für diese Quelle ist kein auslesbarer Text gespeichert.
                </p>
              )}
              {!!document.warnings.length && (
                <ul className="space-y-1 text-xs text-text-muted">
                  {document.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </DialogShell>
      {original && (
        <Suspense fallback={<Loading />}>
          <ResourceViewer
            preview={original}
            onClose={() => setOriginal(undefined)}
          />
        </Suspense>
      )}
    </>
  );
}
export function SourceChips({
  references,
  sources,
  onOpen,
}: {
  references: SourceRef[];
  sources: LearningSource[];
  onOpen: (source: SourceSelection) => void;
}) {
  const uniqueReferences = references.filter(
    (reference, index) =>
      references.findIndex(
        (candidate) =>
          candidate.materialId === reference.materialId &&
          candidate.revision === reference.revision &&
          (reference.page != null
            ? candidate.page === reference.page
            : candidate.page == null && candidate.blockId === reference.blockId),
      ) === index,
  );
  return (
    <div className="mt-3 flex flex-wrap gap-2" aria-label="Quellen">
      {uniqueReferences.map((reference) => {
        const source = sources.find(
          (source) =>
            source.materialId === reference.materialId &&
            source.revision === reference.revision,
        );
        if (
          !source ||
          !materialDocumentPath(reference.materialId, reference.revision) ||
          !/^[a-z0-9-]{1,80}$/.test(reference.blockId)
        )
          return null;
        return (
          <button
            key={`${reference.materialId}-${reference.revision}-${reference.blockId}`}
            type="button"
            onClick={() => onOpen({ ...reference, name: source.name })}
            className="inline-flex w-full max-w-full items-center gap-1.5 rounded-md border border-border px-2 py-1 text-left text-xs text-text-muted hover:bg-bg-1 hover:text-text focus-visible:outline-2 focus-visible:outline-focus-ring sm:w-auto"
            title={source.name}
          >
            <Icon.File filename={source.name} size={16} />
            <span className="min-w-0 flex-1 truncate sm:max-w-60">{source.name}</span>
            {reference.page != null && (
              <span className="shrink-0">· S. {reference.page}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
