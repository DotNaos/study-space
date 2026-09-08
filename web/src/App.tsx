import { useCallback, useEffect, useState } from "react";
import { Button } from "@dotnaos/ui-base";
import { BookOpen, Link2, Settings2, Circle } from "lucide-react";
import {
  api,
  message,
  type Connection,
  type Settings,
  type SystemStatus,
} from "./api";
import { Sources } from "./Sources";
import { MoodleReturn } from "./MoodleReturn";
import { CoursesView } from "./CoursesView";
import { AppLink, useRoute } from "./navigation";
import { ThemeToggle } from "./ThemeToggle";
import { SettingsView } from "./SettingsView";
import { Loading, Notice } from "./shared";

export function App() {
  const { route, navigate } = useRoute();
  const [connection, setConnection] = useState<Connection>();
  const [connectionError, setConnectionError] = useState("");
  const refreshConnection = useCallback(async () => {
    setConnectionError("");
    try {
      setConnection(await api<Connection>("/api/providers/moodle"));
    } catch (error) {
      setConnectionError(message(error));
      throw error;
    }
  }, []);
  const connected = useCallback(async () => {
    await refreshConnection();
    navigate("/courses", true);
  }, [refreshConnection, navigate]);
  const [settings, setSettings] = useState<Settings>({
    displayName: "Study Space",
    locale: "de",
  });
  const [status, setStatus] = useState<SystemStatus>();
  const [statusChecked, setStatusChecked] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsError, setSettingsError] = useState(false);
  const loadSettings = useCallback(() => {
    setSettingsError(false);
    void api<Settings>("/api/settings")
      .then((value) => {
        setSettings(value);
        setSettingsReady(true);
      })
      .catch(() => setSettingsError(true));
  }, []);
  useEffect(() => {
    void refreshConnection().catch(() => {});
    try {
      localStorage.removeItem("study-space:moodle-site");
    } catch {
      /* Retire the old browser-only setting. */
    }
  }, [refreshConnection]);
  useEffect(() => {
    if (route.page === "sources") void refreshConnection().catch(() => {});
  }, [route.page, refreshConnection]);
  useEffect(() => {
    if (route.page === "home" && connection)
      navigate(
        connection.status === "connected" ? "/courses" : "/sources",
        true,
      );
  }, [route.page, connection, navigate]);
  useEffect(() => {
    loadSettings();
    const refreshStatus = () => {
      void api<SystemStatus>("/api/status")
        .then(setStatus)
        .catch(() => setStatus(undefined))
        .finally(() => setStatusChecked(true));
    };
    refreshStatus();
    const timer = setInterval(refreshStatus, 30000);
    return () => clearInterval(timer);
  }, [loadSettings]);
  useEffect(() => {
    const title =
      route.page === "courses"
        ? "Kurse"
        : route.page === "settings"
          ? "Einstellungen"
          : "Quellen";
    document.title = `${title} · ${settings.displayName}`;
  }, [route.page, settings.displayName]);
  return (
    <div className="min-h-screen md:grid md:grid-cols-[236px_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-bg-0 p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Zum Inhalt springen
      </a>
      <aside className="flex flex-col border-b border-border bg-bg-1 px-5 py-5 md:sticky md:top-0 md:h-screen md:border-r md:border-b-0 md:px-6 md:py-8">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-text text-bg-0">
            <BookOpen size={21} strokeWidth={1.6} aria-hidden="true" />
          </span>
          <span className="min-w-0 break-words text-sm font-semibold tracking-tight">
            {settings.displayName}
          </span>
          <ThemeToggle />
        </div>
        <nav
          aria-label="Hauptnavigation"
          className="mt-5 flex flex-wrap gap-1 md:mt-12 md:flex-col md:flex-nowrap"
        >
          {(
            [
              { id: "courses", label: "Kurse", icon: BookOpen },
              { id: "sources", label: "Quellen", icon: Link2 },
              { id: "settings", label: "Einstellungen", icon: Settings2 },
            ] as const
          ).map((item) => (
            <AppLink
              key={item.id}
              navigate={navigate}
              href={`/${item.id}`}
              aria-current={route.page === item.id ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${route.page === item.id ? "bg-bg-0 font-medium shadow-sm" : "text-text-muted hover:bg-bg-2 hover:text-text"}`}
            >
              <item.icon size={17} aria-hidden="true" />
              {item.label}
            </AppLink>
          ))}
        </nav>
        <div className="mt-auto hidden pt-8 md:block">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Circle
              size={7}
              className={
                status?.database === "ready"
                  ? "fill-success text-success"
                  : "fill-warning text-warning"
              }
              aria-hidden="true"
            />
            <span>
              {status?.database === "ready"
                ? "Auf deinem Rechner"
                : statusChecked
                  ? "Installation nicht bereit"
                  : "Verbindung wird geprüft"}
            </span>
          </div>
          {status?.hostname && (
            <p className="mt-1.5 truncate pl-4 text-xs text-text-muted">
              {status.hostname}
            </p>
          )}
        </div>
      </aside>
      <main
        id="main"
        tabIndex={-1}
        className="min-w-0 px-6 py-10 sm:px-10 md:px-14 md:py-16 lg:px-20 lg:py-20"
      >
        {route.page === "moodle-return" ? (
          <MoodleReturn
            onContinue={(success) => {
              if (success)
                void connected().catch(() => navigate("/sources", true));
              else navigate("/sources", true);
            }}
          />
        ) : route.page === "not-found" ? (
          <div className="space-y-4">
            <h1 className="text-2xl font-medium">Diese Seite gibt es nicht.</h1>
            <Button
              label="Zu Study Space"
              onPress={() => navigate("/", true)}
            />
          </div>
        ) : route.page !== "settings" ? (
          connectionError ? (
            <div className="max-w-xl space-y-4">
              <Notice>{connectionError}</Notice>
              <Button
                label="Erneut laden"
                onPress={() => void refreshConnection().catch(() => {})}
              />
            </div>
          ) : !connection || route.page === "home" ? (
            <Loading />
          ) : route.page === "courses" ? (
            <CoursesView
              connection={connection}
              courseId={route.courseId}
              navigate={navigate}
            />
          ) : (
            <Sources
              connection={connection}
              onConnected={connected}
              onDisconnected={refreshConnection}
            />
          )
        ) : settingsReady ? (
          <SettingsView
            settings={settings}
            status={status}
            onSaved={setSettings}
          />
        ) : settingsError ? (
          <div className="max-w-xl space-y-4">
            <Notice>Die Einstellungen konnten nicht geladen werden.</Notice>
            <Button label="Erneut laden" onPress={loadSettings} />
          </div>
        ) : (
          <Loading label="Die Einstellungen werden geladen …" />
        )}
      </main>
    </div>
  );
}
