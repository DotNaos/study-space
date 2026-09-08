import { lazy, Suspense, useEffect, useState } from "react";
import { Button, Input } from "@dotnaos/ui-base";
import {
  api,
  ApiError,
  message,
  safeWebUrl,
  type Discovery,
  type Login,
  type LoginMethod,
  type ProjectConfig,
} from "./api";
import { Loading, Notice, linkClass } from "./shared";
import { BrowserLoginStep } from "./BrowserLoginStep";
import { supportsBrowserLogin } from "./browser-login";
const QrUpload = lazy(() =>
  import("./QrUpload").then((module) => ({ default: module.QrUpload })),
);
export function MoodleLogin({
  initialUrl,
  onConnected,
}: {
  initialUrl?: string | null;
  onConnected: () => Promise<void>;
}) {
  const [siteUrl, setSiteUrl] = useState(initialUrl ?? "");
  const [discovery, setDiscovery] = useState<Discovery>();
  const [login, setLogin] = useState<Login>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const browserSupported = supportsBrowserLogin();

  useEffect(() => {
    if (!login || login.status !== "pending") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (stopped || !login) return;
      if (Date.parse(login.expiresAt) <= Date.now()) {
        setLogin((previous) => ({ ...previous!, status: "expired" }));
        return;
      }
      try {
        const updated = await api<Login>(
          `/api/providers/moodle/login/${encodeURIComponent(login.id)}`,
        );
        if (stopped) return;
        if (updated.status === "completed") {
          await onConnected();
          return;
        }
        if (updated.status !== "pending") {
          setLogin((previous) => ({ ...previous!, ...updated }));
          return;
        }
        setError("");
      } catch (error) {
        if (
          !stopped &&
          error instanceof ApiError &&
          [404, 410].includes(error.status)
        ) {
          setLogin((previous) => ({ ...previous!, status: "expired" }));
          return;
        }
        if (!stopped) setError("Die Verbindung wird erneut geprüft.");
      }
      if (!stopped) timer = setTimeout(() => void poll(), 4000);
    }
    timer = setTimeout(() => void poll(), 4000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [login, onConnected]);

  async function start(method: LoginMethod, source = discovery) {
    if (!source) return;
    setBusy(true);
    setError("");
    try {
      setLogin(
        await api<Login>("/api/providers/moodle/login/start", {
          method: "POST",
          body: JSON.stringify({ siteUrl: source.siteUrl, method }),
        }),
      );
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function discover(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setDiscovery(undefined);
    setLogin(undefined);
    try {
      const value = siteUrl.trim();
      let url: URL;
      try {
        url = new URL(value.includes("://") ? value : `https://${value}`);
      } catch {
        throw new Error("Bitte eine gültige Moodle-Adresse eingeben.");
      }
      if (url.protocol !== "https:" || url.username || url.password)
        throw new Error(
          "Bitte die HTTPS-Adresse deiner Moodle-Plattform eingeben.",
        );
      const config = await api<ProjectConfig>("/api/config", {
        method: "PUT",
        body: JSON.stringify({ moodle: { siteUrl: url.href } }),
      });
      const configuredUrl = config.moodle.siteUrl;
      if (!configuredUrl)
        throw new Error("Die Moodle-Adresse wurde nicht gespeichert.");
      setSiteUrl(configuredUrl);
      const result = await api<Discovery>("/api/providers/moodle/discover", {
        method: "POST",
        body: JSON.stringify({ siteUrl: configuredUrl }),
      });
      setDiscovery(result);
      setSiteUrl(result.siteUrl);
      if (result.methods.includes("browser-sso") && browserSupported)
        await start("browser-sso", result);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function changeSite() {
    setBusy(true);
    setError("");
    try {
      if (login)
        await api(
          `/api/providers/moodle/login/${encodeURIComponent(login.id)}`,
          { method: "DELETE" },
        );
      setDiscovery(undefined);
      setLogin(undefined);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  const launchUrl = safeWebUrl(login?.launchUrl);
  return (
    <div className="max-w-md space-y-6">
      {!discovery && (
        <form onSubmit={(event) => void discover(event)} className="space-y-4">
          <label htmlFor="moodle-url" className="block text-sm text-text-muted">
            Moodle-Adresse
          </label>
          <Input
            id="moodle-url"
            accessibilityLabel="Moodle-Adresse"
            placeholder="moodle.deine-hochschule.ch"
            inputMode="url"
            autoComplete="url"
            fullWidth
            required
            value={siteUrl}
            onValueChange={(value) => {
              setSiteUrl(value);
              setError("");
            }}
            disabled={busy}
          />
          <Button
            type="submit"
            variant="primary"
            label={busy ? "Wird verbunden …" : "Weiter"}
            disabled={busy || !siteUrl.trim()}
          />
        </form>
      )}
      {discovery && (
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 break-all text-sm text-text-muted">
            {discovery.siteUrl.replace(/^https:\/\//, "")}
          </p>
          <Button
            variant="ghost"
            label="Ändern"
            onPress={() => void changeSite()}
            disabled={busy}
          />
        </div>
      )}
      {error && <Notice>{error}</Notice>}
      {discovery && !login && !busy && (
        <div className="space-y-4">
          {discovery.methods.includes("browser-sso") && browserSupported ? (
            <Button
              variant="primary"
              label="Im Browser anmelden"
              onPress={() => void start("browser-sso")}
            />
          ) : discovery.methods.includes("qr") ? (
            <Button
              variant="primary"
              label="Mit QR-Code verbinden"
              onPress={() => void start("qr")}
            />
          ) : (
            <Notice>
              {discovery.methods.includes("browser-sso")
                ? "Bitte öffne Study Space in Chrome oder Edge, um dich anzumelden."
                : discovery.warnings[0] ||
                  "Diese Plattform unterstützt noch keine Anmeldung ohne Passwort."}
            </Notice>
          )}
        </div>
      )}
      {login?.status === "pending" && (
        <div className="space-y-5">
          {login.method === "browser-sso" ? (
            <BrowserLoginStep key={login.id} login={login} />
          ) : (
            <>
              <p className="text-sm leading-6 text-text-muted">
                Öffne in deinem Moodle-Profil den QR-Code für die mobile App.
              </p>
              {launchUrl && (
                <a
                  className={linkClass}
                  href={launchUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Moodle-Profil öffnen
                </a>
              )}
              <Suspense
                fallback={<Loading label="QR-Erkennung wird geladen …" />}
              >
                <QrUpload
                  key={login.id}
                  loginId={login.id}
                  onComplete={onConnected}
                />
              </Suspense>
              <p className="text-xs leading-5 text-text-muted">
                Moodle im Browser und Study Space müssen dieselbe öffentliche
                Internetverbindung verwenden.
              </p>
            </>
          )}
        </div>
      )}
      {login && login.status !== "pending" && login.status !== "completed" && (
        <div className="space-y-4">
          <Notice>
            {login.message ||
              (login.status === "failed"
                ? "Die Anmeldung ist fehlgeschlagen. Bitte versuche es erneut."
                : "Die Anmeldung ist abgelaufen.")}
          </Notice>
          <Button
            variant="primary"
            label="Erneut anmelden"
            onPress={() => void start(login.method || "browser-sso")}
            disabled={busy}
          />
        </div>
      )}
      {discovery && (
        <details className="border-t border-border pt-4 text-sm">
          <summary className="cursor-pointer text-text-muted outline-offset-4">
            Andere Optionen
          </summary>
          <div className="space-y-4 pt-4">
            {discovery.methods.includes("qr") && login?.method !== "qr" && (
              <Button
                label="Mit QR-Code verbinden"
                onPress={() => void start("qr")}
                disabled={busy}
              />
            )}
            {discovery.methods.includes("browser-sso") &&
              browserSupported &&
              login?.method === "qr" && (
                <Button
                  label="Im Browser anmelden"
                  onPress={() => void start("browser-sso")}
                  disabled={busy}
                />
              )}
            <p className="text-xs leading-5 text-text-muted">
              Die Browser-Anmeldung funktioniert in Chrome und Edge am Computer.
              Erlaube Study Space die Rückkehr in den Website-Einstellungen,
              falls keine Anfrage erscheint.
            </p>
            <p className="text-xs leading-5 text-text-muted">
              Du meldest dich nur bei deiner Hochschule an. Study Space
              speichert den Zugang verschlüsselt auf deinem Rechner.
            </p>
          </div>
        </details>
      )}
    </div>
  );
}
