import { useCallback, useEffect, useState } from "react";
import { Button } from "@dotnaos/ui-base";
import { api, message, type Connection, type ProjectConfig } from "./api";
import { Loading, Notice } from "./shared";
import { MoodleLogin } from "./MoodleLogin";

export function Sources({
  connection,
  onConnected,
  onDisconnected,
}: {
  connection: Connection;
  onConnected: () => Promise<void>;
  onDisconnected: () => Promise<void>;
}) {
  const [config, setConfig] = useState<ProjectConfig>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const loadConfig = useCallback(async () => {
    setError("");
    try {
      setConfig(await api<ProjectConfig>("/api/config"));
    } catch (error) {
      setError(message(error));
    }
  }, []);
  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);
  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      await api("/api/providers/moodle", { method: "DELETE" });
      setConfirmDisconnect(false);
      await onDisconnected();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="max-w-xl">
      <h1 className="mb-8 text-2xl font-medium tracking-tight">
        {connection.status === "connected" ? "Quellen" : "Moodle verbinden"}
      </h1>
      {error && (
        <div className="mb-6 space-y-3">
          <Notice>{error}</Notice>
          {!config && (
            <Button label="Erneut laden" onPress={() => void loadConfig()} />
          )}
        </div>
      )}
      {connection.status === "connected" ? (
        <section aria-label="Moodle-Verbindung" className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium">
                {connection.siteName || "Moodle"}
              </h2>
              <p className="mt-1 break-all text-sm text-text-muted">
                {connection.siteUrl}
              </p>
            </div>
            <span className="text-xs text-success">Verbunden</span>
          </div>
          {confirmDisconnect ? (
            <div className="space-y-4">
              <p className="text-sm leading-6 text-text-muted">
                Moodle wirklich trennen? Der gespeicherte Zugang wird entfernt.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  label={busy ? "Wird getrennt …" : "Verbindung trennen"}
                  disabled={busy}
                  onPress={() => void disconnect()}
                />
                <Button
                  variant="ghost"
                  label="Behalten"
                  disabled={busy}
                  onPress={() => setConfirmDisconnect(false)}
                />
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              label="Verbindung trennen"
              onPress={() => setConfirmDisconnect(true)}
            />
          )}
        </section>
      ) : config ? (
        <div className="space-y-5">
          {connection.status === "expired" && (
            <Notice>
              Deine Moodle-Anmeldung ist abgelaufen. Bitte verbinde dich erneut.
            </Notice>
          )}
          <MoodleLogin
            initialUrl={config.moodle.siteUrl}
            onConnected={onConnected}
          />
        </div>
      ) : !error ? (
        <Loading />
      ) : null}
    </div>
  );
}
