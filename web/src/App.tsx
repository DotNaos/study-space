import { useCallback, useEffect, useState } from "react";
import { Button, Container, Icon, type IconName } from "@dotnaos/ui-base";
import { Sidenav } from "@dotnaos/ui/layout";
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

const navigationItems: {
  id: "courses" | "sources" | "settings";
  label: string;
  icon: IconName;
}[] = [
  { id: "courses", label: "Kurse", icon: "list" },
  { id: "sources", label: "Quellen", icon: "paperclip" },
  { id: "settings", label: "Einstellungen", icon: "settings" },
];

const SIDEBAR_COLLAPSED_KEY = "study-space:sidenav-collapsed";

export function App() {
  const { route, navigate } = useRoute();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  });
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
    mcpContentWritesEnabled: true,
  });
  const [status, setStatus] = useState<SystemStatus>();
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
        .catch(() => setStatus(undefined));
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
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
    } catch {
      /* Sidebar preference is best effort. */
    }
  }, [sidebarCollapsed]);
  return (
    <div className={`min-h-screen md:grid ${sidebarCollapsed ? "md:grid-cols-[64px_minmax(0,1fr)]" : "md:grid-cols-[288px_minmax(0,1fr)]"}`}>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-bg-0 p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Zum Inhalt springen
      </a>

      <aside className="flex min-h-14 items-center gap-1 border-b border-border/60 bg-bg-0 px-3 py-1.5 md:hidden">
        <div className="mr-auto flex items-center gap-2">
          <img
            src="/study-space-logo.png"
            alt=""
            width={28}
            height={28}
            decoding="async"
            className="size-7 shrink-0 object-contain"
            aria-hidden="true"
          />
          <span className="text-sm font-medium tracking-tight">{settings.displayName}</span>
        </div>
        <nav aria-label="Hauptnavigation" className="flex items-center gap-1">
          {navigationItems.map((item) => (
            <AppLink
              key={item.id}
              navigate={navigate}
              href={`/${item.id}`}
              aria-current={route.page === item.id ? "page" : undefined}
              aria-label={item.label}
              title={item.label}
              className={`flex min-h-10 min-w-10 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring ${route.page === item.id ? "bg-bg-1" : "text-text-muted hover:bg-bg-1 hover:text-text"}`}
            >
              <Icon name={item.icon} size="s" color={route.page === item.id ? "text" : "muted"} />
            </AppLink>
          ))}
        </nav>
        <ThemeToggle />
      </aside>

      <aside className="sticky top-0 hidden h-dvh min-h-0 border-r border-border/60 bg-bg-0 md:block">
        <Sidenav collapsed={sidebarCollapsed} label="Hauptnavigation">
          <Sidenav.Header>
            <Container
              className="flex min-w-0 flex-1 items-center gap-2 group-data-[collapsed=true]/sidenav:justify-center"
              part="unstyled"
            >
              <img
                src="/study-space-logo.png"
                alt=""
                width={28}
                height={28}
                decoding="async"
                className="size-7 shrink-0 object-contain"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium tracking-tight group-data-[collapsed=true]/sidenav:hidden">
                {settings.displayName}
              </span>
            </Container>
            <Sidenav.Toggle
              collapsed={sidebarCollapsed}
              onPress={() => setSidebarCollapsed((value) => !value)}
            />
          </Sidenav.Header>

          <Sidenav.Item
            action="navigate-courses"
            icon="list"
            label="Kurse"
            active={route.page === "courses"}
            tooltip="Kurse"
            onPress={() => navigate("/courses")}
          />
          <Sidenav.Item
            action="navigate-sources"
            icon="paperclip"
            label="Quellen"
            active={route.page === "sources"}
            tooltip="Quellen"
            onPress={() => navigate("/sources")}
          />
          <Sidenav.Item
            action="navigate-settings"
            icon="settings"
            label="Einstellungen"
            active={route.page === "settings"}
            tooltip="Einstellungen"
            onPress={() => navigate("/settings")}
          />

          <Sidenav.Footer>
            <Container
              className="flex min-w-0 items-center gap-2 group-data-[collapsed=true]/sidenav:flex-col"
              part="unstyled"
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-1 py-1 text-left transition-colors hover:bg-control-hover focus-visible:outline-2 focus-visible:outline-focus-ring group-data-[collapsed=true]/sidenav:flex-none group-data-[collapsed=true]/sidenav:p-0"
                onClick={() => navigate("/settings")}
                title={connection?.displayName || "Benutzer"}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-bg-2 text-xs font-semibold text-text">
                  {(connection?.displayName || "U").trim().slice(0, 1).toLocaleUpperCase()}
                </span>
                <span className="min-w-0 flex-1 group-data-[collapsed=true]/sidenav:hidden">
                  <span className="block truncate text-sm font-medium text-text">
                    {connection?.displayName || "Benutzer"}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-text-muted">
                    {connection?.siteName || "Moodle"}
                  </span>
                </span>
              </button>
              <ThemeToggle />
            </Container>
          </Sidenav.Footer>
        </Sidenav>
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
