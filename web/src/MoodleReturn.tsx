import { useEffect, useState } from "react";
import { Button } from "@dotnaos/ui-base";
import { CheckCircle2, Link2 } from "lucide-react";
import { completeBrowserReturn } from "./browser-login";
import { message } from "./api";
import { Loading, Notice } from "./shared";

export function MoodleReturn({ onContinue }: { onContinue: () => void }) {
  const [status, setStatus] = useState<"pending" | "completed" | "failed">(
    "pending",
  );
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void completeBrowserReturn()
      .then(() => {
        if (active) setStatus("completed");
      })
      .catch((error) => {
        if (active) {
          setError(message(error));
          setStatus("failed");
        }
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="max-w-xl space-y-6" aria-labelledby="return-heading">
      <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-text-muted">
        <Link2 size={14} aria-hidden="true" />
        Deine Quellen
      </p>
      <h1 id="return-heading" className="text-4xl font-medium tracking-tight">
        {status === "completed"
          ? "Moodle ist verbunden."
          : "Zurück in Study Space."}
      </h1>
      {status === "pending" && (
        <Loading label="Deine Moodle-Anmeldung wird geprüft …" />
      )}
      {status === "completed" && (
        <>
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 size={18} aria-hidden="true" />
            Dein Zugang wurde sicher gespeichert.
          </p>
          <Button
            variant="primary"
            label="Zu meinen Kursen"
            onPress={onContinue}
          />
        </>
      )}
      {status === "failed" && (
        <>
          <Notice>{error}</Notice>
          <Button label="Zurück zu Quellen" onPress={onContinue} />
        </>
      )}
    </section>
  );
}
