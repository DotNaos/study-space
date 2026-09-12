import { useEffect, useState } from "react";
import { Button } from "@dotnaos/ui-base";
import { message } from "./api";
import type { MaterialBlock, MaterialDocument } from "./material-api";
import { sourceAssetPath } from "./SourceViewer";
import { fetchPreviewBytes } from "./resource-preview";
import { safeBounds } from "./script-provenance";
import { Loading, Notice, linkClass } from "./shared";

export function ComparisonSource({
  document,
  page,
  selectedBlocks,
  linkedBlocks,
  activeBlock,
  onSelect,
  openOnly,
}: {
  document: MaterialDocument;
  page: number | null;
  selectedBlocks: Set<string>;
  linkedBlocks: Set<string>;
  activeBlock?: string;
  onSelect: (block: MaterialBlock) => void;
  openOnly: boolean;
}) {
  const blocks = document.blocks.filter(
    (block) => (block.page ?? block.slide) === page,
  );
  const asset =
    document.assets.find(
      (item) =>
        item.kind === "page-image" && (item.page ?? item.slide) === page,
    ) ??
    document.assets.find(
      (item) =>
        item.kind === "original" &&
        /^image\/(png|jpeg|webp|gif)$/.test(item.mimeType),
    );
  const path = asset && sourceAssetPath(document, asset);
  const original = document.assets.find((item) => item.kind === "original");
  const originalPath = original && sourceAssetPath(document, original);
  const [image, setImage] = useState<{ path: string; url: string }>();
  const [error, setError] = useState("");
  useEffect(() => {
    setImage(undefined);
    setError("");
    if (!path) return;
    const controller = new AbortController();
    let url: string | undefined;
    void fetchPreviewBytes(path, "image", controller.signal)
      .then((file) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(
          new Blob([file.bytes.slice().buffer], { type: file.mimeType }),
        );
        setImage({ path, url });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error));
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);
  const missingCoordinates = blocks.some(
    (block) => selectedBlocks.has(block.id) && !safeBounds(block.bounds),
  );
  const hasImage = image?.path === path && !!image?.url && !error;
  return (
    <>
      {error && <Notice>{error}</Notice>}
      {path && !image && !error && (
        <Loading label="Originalseite wird geladen …" />
      )}
      {hasImage && (
        <div className="comparison-page">
          <img
            src={image.url}
            alt={`${document.name} · ${page === null ? "Original" : `Seite ${page}`}`}
            onError={() =>
              setError("Die Originalseite konnte nicht geladen werden.")
            }
            onLoad={(event) => {
              if (
                event.currentTarget.naturalWidth *
                  event.currentTarget.naturalHeight >
                32 * 1024 * 1024
              )
                setError("Die Quellenseite ist für diese Vorschau zu groß.");
            }}
          />
          {asset?.kind === "page-image" &&
            blocks.map((block) => {
              const bounds = safeBounds(block.bounds);
              if (!bounds) return null;
              const selected =
                selectedBlocks.has(block.id) || activeBlock === block.id;
              return (
                <div
                  key={block.id}
                  className={`comparison-region${selected ? " is-active" : ""}${openOnly && !linkedBlocks.has(block.id) ? " is-open" : ""}`}
                  style={{
                    left: `${bounds.x * 100}%`,
                    top: `${bounds.y * 100}%`,
                    width: `${bounds.width * 100}%`,
                    height: `${bounds.height * 100}%`,
                  }}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    label=""
                    accessibilityLabel={`Quellausschnitt: ${block.text.slice(0, 140) || block.kind}`}
                    title={block.text.slice(0, 250) || block.kind}
                    onPress={() => onSelect(block)}
                  />
                </div>
              );
            })}
        </div>
      )}
      {!path && (
        <p className="comparison-notice">
          Für dieses Format liegt keine gerenderte Originalseite vor. Unten
          siehst du den Extrakt, nicht das ursprüngliche Layout.
        </p>
      )}
      {missingCoordinates && (
        <p className="comparison-notice">
          Die Seite ist zugeordnet, aber für diesen Ausschnitt fehlen
          Positionsdaten. Der zugehörige Extrakt ist unten markiert.
        </p>
      )}
      {originalPath && (
        <a className={`${linkClass} mt-3`} href={originalPath} download>
          Originaldatei herunterladen
        </a>
      )}
      {(!document.complete || document.warnings.length > 0) && (
        <div className="comparison-notice" role="status">
          <strong>Extraktion prüfen</strong>
          <p>
            Inhalte oder Abbildungen können im Extrakt fehlen. Das Original ist
            für den Vergleich maßgeblich.
          </p>
          {document.warnings.map((warning, index) => (
            <p key={index}>{warning}</p>
          ))}
        </div>
      )}
      <details
        className="comparison-blocks"
        open={!path || !!error || openOnly || missingCoordinates}
      >
        <summary>Quellausschnitte · {blocks.length}</summary>
        <div className="comparison-block-list">
          {blocks.map((block) => (
            <div
              key={block.id}
              data-source-block={block.id}
              className={`${selectedBlocks.has(block.id) || activeBlock === block.id ? "is-active" : ""}${openOnly && linkedBlocks.has(block.id) ? " is-muted" : ""}`}
            >
              <Button
                variant="ghost"
                size="sm"
                label={block.text || `[${block.kind}]`}
                onPress={() => onSelect(block)}
              />
              <small>
                {linkedBlocks.has(block.id)
                  ? "Textzuordnung vorhanden · Vollständigkeit nicht bestätigt"
                  : "Keine genaue Textzuordnung gespeichert"}
              </small>
            </div>
          ))}
        </div>
      </details>
    </>
  );
}
