import { api, type Login } from "./api";

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
export function registerMoodleReturn(login: Pick<Login, "id">): void {
  if (!supportsBrowserLogin())
    throw new Error(
      "Bitte die Browser-Anmeldung in Chrome oder Edge öffnen, oder den Moodle-QR-Code verwenden.",
    );
  navigator.registerProtocolHandler(
    moodleProtocol,
    `${window.location.origin}${moodleReturnPath}#id=${encodeURIComponent(login.id)}&callback=%s`,
  );
}

type BrowserReturn = { id: string; callbackUrl: string };
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
    if (
      !callback ||
      !/^[a-f0-9]{64}$/.test(callback.id) ||
      !callback.callbackUrl.startsWith(`${moodleProtocol}://`)
    ) {
      throw new Error(
        "Diese Rückkehr gehört zu keiner gültigen Anmeldung. Bitte starte die Verbindung erneut.",
      );
    }
    await api(`/api/providers/moodle/login/${callback.id}/complete`, {
      method: "POST",
      body: JSON.stringify({ callbackUrl: callback.callbackUrl }),
    });
  })();
  return completion;
}
