import { lazy, Suspense, useEffect, useState } from "react";
import { Button } from "@dotnaos/ui-base";
import { CheckCircle2, Sparkles } from "lucide-react";
import { DialogShell } from "./DialogShell";
import { safeCodexVerificationUrl, type useCodexConnection } from "./codex-api";
import { Loading, Notice } from "./shared";

const DeviceCodeLogin = lazy(() =>
  import("./ui-ai").then((module) => ({ default: module.DeviceCodeLogin })),
);
export type CodexState = ReturnType<typeof useCodexConnection>;

export function CodexConnectionControl({ codex }: { codex: CodexState }) {
  const [open, setOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  useEffect(() => {
    setCopied(false);
    setCopyError("");
  }, [codex.login?.userCode]);
  const connected = codex.connection?.status === "connected";
  const pending = codex.login?.status === "pending";
  const failure =
    codex.error ||
    (codex.login?.status === "expired"
      ? "Der Anmeldecode ist abgelaufen. Bitte erneut verbinden."
      : codex.login?.status === "failed"
        ? "Die Anmeldung ist fehlgeschlagen. Bitte erneut versuchen."
        : codex.connection?.status === "unavailable"
          ? codex.connection.message || "Codex ist gerade nicht verfügbar."
          : "");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          {connected ? (
            <CheckCircle2 size={16} className="shrink-0 text-success" />
          ) : (
            <Sparkles size={16} className="shrink-0 text-text-muted" />
          )}
          <span>
            {connected ? "ChatGPT verbunden" : "ChatGPT für deinen Lernbereich"}
            {connected && codex.connection?.accountLabel && (
              <span className="ml-2 break-all text-xs text-text-muted">
                {codex.connection.accountLabel}
              </span>
            )}
          </span>
        </div>
        <Button
          variant="ghost"
          label={
            connected
              ? "Verbindung verwalten"
              : pending
                ? "Anmeldung fortsetzen"
                : "Mit ChatGPT verbinden"
          }
          onPress={() => {
            setOpen(true);
            if (!connected && !pending) void codex.start();
          }}
        />
      </div>
      {!open && failure && <Notice>{failure}</Notice>}
      {open && (
        <DialogShell
          title={connected ? "ChatGPT-Verbindung" : "Mit ChatGPT verbinden"}
          onClose={() => setOpen(false)}
        >
          <div className="p-5">
            {connected ? (
              <div className="space-y-5">
                <p className="text-sm leading-6">
                  Dein ChatGPT-Konto ist mit Study Space verbunden. Lernbereiche
                  und Antworten bleiben beim Trennen gespeichert.
                </p>
                {confirmDisconnect ? (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted">
                      Den ChatGPT-Zugang für diese Study-Space-Installation
                      entfernen?
                    </p>
                    <div className="flex gap-2">
                      <Button
                        label="Verbindung trennen"
                        disabled={codex.busy}
                        onPress={() =>
                          void codex
                            .disconnect()
                            .then(() => setConfirmDisconnect(false))
                        }
                      />
                      <Button
                        label="Behalten"
                        variant="ghost"
                        onPress={() => setConfirmDisconnect(false)}
                      />
                    </div>
                  </div>
                ) : (
                  <Button
                    label="Verbindung trennen"
                    variant="ghost"
                    onPress={() => setConfirmDisconnect(true)}
                  />
                )}
              </div>
            ) : (
              <Suspense
                fallback={<Loading label="Anmeldung wird geöffnet …" />}
              >
                <DeviceCodeLogin
                  state={
                    codex.busy
                      ? "starting"
                      : failure
                        ? "error"
                        : pending
                          ? "pending"
                          : "idle"
                  }
                  userCode={codex.login?.userCode}
                  errorMessage={failure || undefined}
                  onStart={() => void codex.start()}
                  onCancel={() => void codex.cancel()}
                  onCopyCode={() => {
                    if (codex.login?.userCode)
                      void navigator.clipboard
                        .writeText(codex.login.userCode)
                        .then(() => {
                          setCopied(true);
                          setCopyError("");
                        })
                        .catch(() =>
                          setCopyError(
                            "Der Code konnte nicht kopiert werden. Bitte markiere ihn und kopiere ihn manuell.",
                          ),
                        );
                  }}
                  onOpenVerification={() => {
                    const url =
                      codex.login &&
                      safeCodexVerificationUrl(codex.login.verificationUrl);
                    if (url) window.open(url, "_blank", "noopener,noreferrer");
                    else
                      codex.setError(
                        "Die Anmeldeadresse ist nicht verfügbar. Bitte erneut verbinden.",
                      );
                  }}
                  customize={{
                    className:
                      "!w-full !border-0 !bg-transparent !p-0 !shadow-none",
                    reason:
                      "Embed the published login component in the course connection dialog",
                  }}
                />
                {copyError && <Notice>{copyError}</Notice>}
                {pending && (
                  <p className="mt-4 text-xs text-text-muted">
                    {copied ? "Code kopiert. " : ""}Die Bestätigung wird
                    automatisch erkannt. Der Code wird nur für diese Anmeldung
                    angezeigt.
                  </p>
                )}
              </Suspense>
            )}
            {connected && codex.error && <Notice>{codex.error}</Notice>}
          </div>
        </DialogShell>
      )}
    </div>
  );
}
