import { useEffect, useState } from "react";
import { api, message } from "./api";
import { materialDocumentPath, type MaterialDocument } from "./material-api";
import { sourceAssetPath } from "./SourceViewer";
import { fetchPreviewBytes } from "./resource-preview";
import { Notice } from "./shared";
import type { LearningVersion } from "./learning-api";

export function LearningFigure({
  materialId,
  revision,
  assetId,
  alt,
  version,
}: {
  materialId?: string;
  revision?: string;
  assetId?: string;
  alt?: string;
  version: LearningVersion;
}) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState("");
  const allowed = version.sources.some(
    (source) =>
      source.materialId === materialId && source.revision === revision,
  );
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setUrl(undefined);
    setError("");
    const path = materialDocumentPath(materialId ?? "", revision ?? "");
    if (!allowed || !path || !assetId || !alt) {
      setError("Abbildung ohne gültige gespeicherte Quellenreferenz.");
      return;
    }
    void api<MaterialDocument>(path, { signal: controller.signal })
      .then(async (document) => {
        if (
          document.materialId !== materialId ||
          document.revision !== revision
        )
          throw new Error("Quellenrevision stimmt nicht überein.");
        const asset = document.assets.find((asset) => asset.id === assetId);
        const url = asset && sourceAssetPath(document, asset);
        if (
          !asset ||
          !url ||
          !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
            asset.mimeType,
          )
        )
          throw new Error("Diese gespeicherte Abbildung ist nicht verfügbar.");
        const file = await fetchPreviewBytes(url, "image", controller.signal);
        if (!controller.signal.aborted) {
          objectUrl = URL.createObjectURL(
            new Blob([file.bytes.slice().buffer], { type: file.mimeType }),
          );
          setUrl(objectUrl);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error));
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [materialId, revision, assetId, alt, allowed]);
  return error ? (
    <Notice>{error}</Notice>
  ) : (
    <figure className="my-4">
      {url ? (
        <img
          src={url}
          alt={alt}
          className="max-h-[70vh] max-w-full object-contain"
        />
      ) : (
        <span>Abbildung wird geladen …</span>
      )}
      <figcaption className="mt-2 text-xs text-text-muted">{alt}</figcaption>
    </figure>
  );
}
