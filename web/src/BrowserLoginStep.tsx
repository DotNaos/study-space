import { useState } from "react";
import { Button } from "@dotnaos/ui-base";
import { registerMoodleReturn } from "./browser-login";
import { safeWebUrl, type Login } from "./api";
import { Notice } from "./shared";

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
          ? "Bestätige die Anfrage in Chrome oder Edge mit „Zulassen“. Falls du nach der Anmeldung nicht zurückkehrst, nutze in Moodle den Link zum Öffnen der App."
          : "Öffne Study Space in Chrome oder Edge und erlaube die Rückkehr nach deiner Moodle-Anmeldung."}
      </p>
      {requested && launchUrl ? (
        <Button
          variant="primary"
          label="Bei Moodle anmelden"
          onPress={() => window.location.assign(launchUrl)}
        />
      ) : (
        <Button
          variant="primary"
          label="Rückkehr erlauben"
          onPress={register}
        />
      )}
      {error && <Notice>{error}</Notice>}
    </div>
  );
}
