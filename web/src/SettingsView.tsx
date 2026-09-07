import { useState } from "react";
import { Button, Input } from "@dotnaos/ui-base";
import { Server, Settings2 } from "lucide-react";
import { api, message, type Settings, type SystemStatus } from "./api";
import { Notice } from "./shared";

export function SettingsView({
  settings,
  status,
  onSaved,
}: {
  settings: Settings;
  status?: SystemStatus;
  onSaved: (value: Settings) => void;
}) {
  const [name, setName] = useState(settings.displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const result = await api<Settings>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ ...settings, displayName: name.trim() }),
      });
      onSaved(result);
      setSaved(true);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="max-w-xl">
      <p className="mb-4 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-text-muted">
        <Settings2 size={14} aria-hidden="true" />
        Dein Lernort
      </p>
      <h1 className="mb-10 text-4xl font-medium tracking-tight">
        Einstellungen
      </h1>
      <form
        onSubmit={(event) => void save(event)}
        className="space-y-4 border-y border-border py-7"
      >
        <label htmlFor="display-name" className="block text-sm font-medium">
          Name deines Study Space
        </label>
        <Input
          id="display-name"
          accessibilityLabel="Name deines Study Space"
          value={name}
          onValueChange={(value) => {
            setName(value);
            setSaved(false);
          }}
          required
          fullWidth
          disabled={busy}
        />
        <p className="text-xs text-text-muted">
          Wird in der Navigation angezeigt. Die Webadresse bleibt gleich.
        </p>
        <Button
          type="submit"
          variant="primary"
          label={busy ? "Wird gespeichert …" : "Speichern"}
          disabled={busy || !name.trim() || name.trim().length > 100}
        />
        {name.trim().length > 100 && (
          <Notice>Bitte einen Namen mit höchstens 100 Zeichen wählen.</Notice>
        )}
        {error && <Notice>{error}</Notice>}
        {saved && (
          <Notice success>Deine Einstellungen wurden gespeichert.</Notice>
        )}
      </form>
      <section className="py-7">
        <h2 className="mb-5 flex items-center gap-2 text-sm font-medium">
          <Server size={16} aria-hidden="true" />
          Installation
        </h2>
        <dl className="space-y-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-text-muted">Rechner</dt>
            <dd className="break-all text-right">
              {status?.hostname || "Nicht erreichbar"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-text-muted">Version</dt>
            <dd>{status?.version || "–"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-text-muted">Datenbank</dt>
            <dd
              className={
                status?.database === "ready" ? "text-success" : "text-danger"
              }
            >
              {status?.database === "ready" ? "Bereit" : "Nicht erreichbar"}
            </dd>
          </div>
          {status?.publicUrl && (
            <div className="flex justify-between gap-4">
              <dt className="text-text-muted">Webadresse</dt>
              <dd className="break-all text-right">{status.publicUrl}</dd>
            </div>
          )}
        </dl>
      </section>
    </div>
  );
}
