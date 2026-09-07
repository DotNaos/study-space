import { useState } from "react";
import { Upload } from "lucide-react";
import jsQR from "jsqr";
import { api, message } from "./api";
import { Loading, Notice } from "./shared";

export function QrUpload({
  loginId,
  onComplete,
}: {
  loginId: string;
  onComplete: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function upload(file?: File) {
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      if (file.size > 12 * 1024 * 1024)
        throw new Error("Bitte ein Bild unter 12 MB auswählen.");
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
        throw new Error("Bitte ein PNG-, JPG- oder WebP-Bild auswählen.");
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 4096 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        bitmap.close();
        throw new Error("Das Bild konnte nicht gelesen werden.");
      }
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const qr = jsQR(pixels.data, pixels.width, pixels.height);
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (!qr)
        throw new Error(
          "Kein QR-Code erkannt. Bitte den vollständigen QR-Code gut lesbar aufnehmen.",
        );
      if (!qr.data.startsWith("moodlemobile://"))
        throw new Error(
          "Das ist kein Moodle-App-QR-Code. Bitte den Code im Moodle-Profil verwenden.",
        );
      await api(
        `/api/providers/moodle/login/${encodeURIComponent(loginId)}/complete`,
        {
          method: "POST",
          body: JSON.stringify({ qrCode: qr.data }),
        },
      );
      await onComplete();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <label
        className={`relative flex min-h-32 items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-bg-1 p-6 text-sm font-medium transition-colors focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-focus-ring ${busy ? "opacity-60" : "cursor-pointer hover:bg-bg-2"}`}
      >
        <input
          aria-label="Moodle-QR-Code als Bild auswählen"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          onChange={(event) => {
            void upload(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        {busy ? (
          <Loading label="QR-Code wird geprüft …" />
        ) : (
          <>
            <Upload size={20} aria-hidden="true" />
            <span>QR-Code als Bild auswählen</span>
          </>
        )}
      </label>
      <p className="text-xs leading-5 text-text-muted">
        PNG, JPG oder WebP, bis 12 MB. Das Bild wird hier im Browser gelesen und
        nicht gespeichert.
      </p>
      {error && <Notice>{error}</Notice>}
    </div>
  );
}
