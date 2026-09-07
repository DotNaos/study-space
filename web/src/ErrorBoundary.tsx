import { Component, type ReactNode } from "react";
import { Button } from "@dotnaos/ui-base";

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="mx-auto max-w-xl space-y-5 px-6 py-20">
          <h1 className="text-3xl font-medium tracking-tight">
            Study Space konnte die Ansicht nicht laden.
          </h1>
          <p role="alert" className="text-sm leading-6 text-text-muted">
            Bitte lade die Seite erneut. Falls du gerade Moodle verbunden hast,
            prüfe danach den Verbindungsstatus unter Quellen.
          </p>
          <Button
            label="Seite neu laden"
            onPress={() => window.location.reload()}
          />
        </main>
      );
    return this.props.children;
  }
}
