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
    <div className="min-h-screen md:grid md:grid-cols-[208px_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-bg-0 p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Zum Inhalt springen
      </a>
      <aside className="flex min-h-14 items-center gap-1 border-b border-border/60 bg-bg-0 px-3 py-1.5 md:sticky md:top-0 md:h-dvh md:flex-col md:items-stretch md:border-r md:border-b-0 md:px-4 md:py-6">
        <div className="mr-auto flex items-center gap-2 md:mr-0 md:px-2">
          <img
            src="/study-space-logo.png"
            alt=""
            width={32}
            height={32}
            decoding="async"
            className="size-8 shrink-0 object-contain"
            aria-hidden="true"
          />
          <span className="sr-only text-sm font-medium tracking-tight md:not-sr-only">
            {settings.displayName}
          </span>
        </div>
        <nav
          aria-label="Hauptnavigation"
          className="flex items-center gap-1 md:mt-8 md:flex-col md:items-stretch"
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
              aria-label={item.label}
              title={item.label}
              className={`flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md px-3 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring md:justify-start ${route.page === item.id ? "bg-bg-1 font-medium" : "text-text-muted hover:bg-bg-1 hover:text-text"}`}
            >
              <item.icon size={17} aria-hidden="true" />
              <span className={route.page === item.id ? "hidden min-[360px]:inline md:inline" : "hidden md:inline"}>{item.label}</span>
            </AppLink>
          ))}
        </nav>
        <div className="shrink-0 md:mt-3 md:self-start md:px-1"><ThemeToggle /></div>
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
        className="min-w-0 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-8 md:px-12 md:py-12 lg:px-16"
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
              moduleId={route.moduleId}
              resourceId={route.resourceId}
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
