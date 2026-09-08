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
  const hostname = window.location.hostname;
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
        Öffne Study Space in Chrome oder Edge. Die ersten beiden Schritte sind
        normalerweise nur einmal pro Browser nötig. Ist Study Space schon als
        Standard markiert, gehe direkt zu Schritt 3.
      </p>
      <ol className="list-decimal space-y-5 pl-5 text-sm leading-6 marker:text-text-muted">
        <li className="space-y-2 pl-1">
          <p>
            Rückkehr anfragen und die Browser-Anfrage mit „Zulassen“ bestätigen.
          </p>
          <Button
            variant={requested ? "secondary" : "primary"}
            label={requested ? "Erneut anfragen" : "Rückkehr anfragen"}
            onPress={register}
          />
          {requested && (
            <p role="status" className="text-text-muted">
              Anfrage gesendet. Ob du sie erlaubt und als Standard ausgewählt
              hast, kann Study Space nicht prüfen.
            </p>
          )}
        </li>
        <li className="space-y-2 pl-1">
          <p>Study Space in Chrome als Standard festlegen.</p>
          <p className="text-text-muted">
            Kopiere diese Adresse in einen neuen Chrome-Tab:
          </p>
          <code className="block select-all break-all text-text">
            chrome://settings/handlers
          </code>
          <p className="text-text-muted">
            Wähle unter <span className="text-text">web+studyspace</span> den
            Eintrag für <span className="break-all text-text">{hostname}</span>,
            dann ⋮ → „Als Standard festlegen“ (Set as default).
          </p>
          <p className="text-text-muted">
            Der Eintrag sollte jetzt „Standard“ (Default) anzeigen.
          </p>
          <p className="text-xs leading-5 text-text-muted">
            Alternativ: Einstellungen → Datenschutz und Sicherheit →
            Website-Einstellungen → Zusätzliche Berechtigungen →
            Protokoll-Handler.
          </p>
        </li>
        <li className="space-y-2 pl-1">
          <p>Bei Moodle anmelden.</p>
          <p className="text-text-muted">
            Moodle öffnet sich in einem neuen Tab. Lass Study Space hier offen.
            Nutze nach der Anmeldung in Moodle den Link zum Öffnen der App;
            deine Kurse erscheinen anschließend hier.
          </p>
          {launchUrl && <MoodleLaunchLink launchUrl={launchUrl} />}
        </li>
      </ol>
      {error && <Notice>{error}</Notice>}
    </div>
  );
}
