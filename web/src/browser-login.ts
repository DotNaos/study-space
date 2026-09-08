import { api } from "./api";

export const moodleReturnPath = "/moodle-return";
export const moodleProtocol = "web+studyspace";

export function supportsBrowserLogin(): boolean {
  return (
    window.isSecureContext &&
    typeof navigator.registerProtocolHandler === "function"
  );
}

// Must be called directly from a user gesture. Registration can prompt for browser
// permission; a successful call does not mean that the user granted permission.
// Keep this URL identical across login attempts: the server correlates the return
// with its active pending login using Moodle's passport digest.
export function registerMoodleReturn(): void {
  if (!supportsBrowserLogin())
    throw new Error(
      "Bitte die Browser-Anmeldung in Chrome oder Edge öffnen, oder den Moodle-QR-Code verwenden.",
    );
  navigator.registerProtocolHandler(
    moodleProtocol,
    `${window.location.origin}${moodleReturnPath}#callback=%s`,
  );
}

type BrowserReturn = { callbackUrl: string };
declare global {
  interface Window {
    __studyMoodleReturn?: BrowserReturn;
  }
}

// The initial inline HTML script removes credentials from the address before
// the app loads. Keep the single-use callback only in this module's memory.
let returned = window.__studyMoodleReturn;
delete window.__studyMoodleReturn;
let completion: Promise<void> | undefined;

export function completeBrowserReturn(): Promise<void> {
  if (completion) return completion;
  const callback = returned;
  returned = undefined;
  completion = (async () => {
    if (!callback || !callback.callbackUrl.startsWith(`${moodleProtocol}://`)) {
      throw new Error(
        "Diese Rückkehr gehört zu keiner gültigen Anmeldung. Bitte starte die Verbindung erneut.",
      );
    }
    await api("/api/providers/moodle/browser-return", {
      method: "POST",
      body: JSON.stringify({ callbackUrl: callback.callbackUrl }),
    });
  })();
  return completion;
}
