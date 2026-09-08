import { useEffect, useRef, useState } from "react";
import { Minus, Plus, ScanLine } from "lucide-react";
import { ViewerButton } from "./ViewerButton";

export function ImagePreview({
  bytes,
  mimeType,
  name,
  onError,
}: {
  bytes: Uint8Array;
  mimeType: string;
  name: string;
  onError: (error: string) => void;
}) {
  const [url, setUrl] = useState<string>();
  const [zoom, setZoom] = useState(1);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = viewportRef.current;
    if (!host) return;
    const measure = () =>
      setAvailable({
        width: Math.max(1, host.clientWidth - 32),
        height: Math.max(1, host.clientHeight - 32),
      });
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    measure();
    return () => observer.disconnect();
  }, []);
  const fit = natural.width
    ? Math.min(
        1,
        available.width / natural.width,
        available.height / natural.height,
      )
    : 1;
  const imageWidth = natural.width * fit * zoom;
  const imageHeight = natural.height * fit * zoom;
  useEffect(() => {
    const objectUrl = URL.createObjectURL(
      new Blob([bytes.slice().buffer], { type: mimeType }),
    );
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [bytes, mimeType]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-end gap-1 border-b border-border px-3 py-1.5">
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
        <ViewerButton
          label="Bild einpassen"
          onClick={() => {
            setZoom(1);
            viewportRef.current?.scrollTo({ top: 0, left: 0 });
          }}
        >
          <ScanLine size={17} />
        </ViewerButton>
      </div>
      <div ref={viewportRef} className="min-h-0 flex-1 overflow-auto bg-bg-1">
        <div
          className="flex min-h-full min-w-full items-center justify-center p-4"
          style={{ width: imageWidth + 32, height: imageHeight + 32 }}
        >
          {url && (
            <img
              src={url}
              alt={name}
              className="block max-w-none shrink-0 object-contain"
              style={{
                width: imageWidth || undefined,
                height: imageHeight || undefined,
                visibility: natural.width ? "visible" : "hidden",
              }}
              onLoad={(event) => {
                const { naturalWidth: width, naturalHeight: height } =
                  event.currentTarget;
                setNatural({ width, height });
                if (
                  event.currentTarget.naturalWidth *
                    event.currentTarget.naturalHeight >
                  32 * 1024 * 1024
                )
                  onError(
                    "Das Bild ist für die Vorschau zu groß. Bitte lade es herunter.",
                  );
              }}
              onError={() =>
                onError(
                  "Dieses Bild konnte nicht angezeigt werden. Bitte lade es herunter.",
                )
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
