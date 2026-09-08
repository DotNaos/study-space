import { useState } from "react";
import { Button } from "@dotnaos/ui-base";
import { registerMoodleReturn } from "./browser-login";
import { safeWebUrl, type Login } from "./api";
import { Notice } from "./shared";

export function MoodleLaunchLink({ launchUrl }: { launchUrl: string }) {
  const href = safeWebUrl(launchUrl);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-10 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-text-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus-ring"
    >
      Bei Moodle anmelden
      <span className="sr-only"> (öffnet einen neuen Tab)</span>
    </a>
  );
}

export function BrowserLoginStep({ login }: { login: Login }) {
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState("");
  const launchUrl = safeWebUrl(login.launchUrl);
  function register() {
    setError("");
    try {
      registerMoodleReturn();
      setRequested(true);
    } catch {
      setError(
        "Die Rückkehr konnte nicht eingerichtet werden. Bitte verwende Chrome oder Edge, oder wähle den QR-Code unter „Andere Optionen“.",
      );
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-text-muted">
        {requested
          ? "Bestätige die Anfrage in Chrome oder Edge mit „Zulassen“. Moodle öffnet sich in einem neuen Tab; Study Space wartet hier auf deine Anmeldung. Falls die Rückkehr ausbleibt, nutze in Moodle den Link zum Öffnen der App."
          : "Öffne Study Space in Chrome oder Edge und erlaube die Rückkehr nach deiner Moodle-Anmeldung."}
      </p>
      {requested && launchUrl ? (
        <MoodleLaunchLink launchUrl={launchUrl} />
      ) : (
        <Button
          variant="primary"
          label="Rückkehr erlauben"
          onPress={register}
        />
      )}
      {requested && (
        <details className="text-sm leading-6 text-text-muted">
          <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus-ring">
            Moodle öffnet Study Space nicht?
          </summary>
          <p className="mt-2">
            Öffne in Chrome die Einstellungen für Protokoll-Handler. Wähle beim
            Study-Space-Eintrag über ⋮ „Als Standard festlegen“ (Set as default)
            und klicke den Link in Moodle erneut.
          </p>
        </details>
      )}
      {error && <Notice>{error}</Notice>}
    </div>
  );
}
