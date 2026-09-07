import { useCallback, useEffect, useState } from "react";
import { Button } from "@dotnaos/ui-base";
import { BookOpen } from "lucide-react";
import { api, message, type Connection, type Course } from "./api";
import { Loading, Notice } from "./shared";
import { MoodleLogin } from "./MoodleLogin";

export function Sources() {
  const [connection, setConnection] = useState<Connection>();
  const [courses, setCourses] = useState<Course[]>([]);
  const [error, setError] = useState("");
  const [courseError, setCourseError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const refresh = useCallback(async () => {
    setError("");
    setCourseError("");
    try {
      const result = await api<Connection>("/api/providers/moodle");
      setConnection(result);
      if (result.status === "connected") {
        try {
          setCourses(await api<Course[]>("/api/providers/moodle/courses"));
        } catch (error) {
          setCourseError(message(error));
          const updated = await api<Connection>("/api/providers/moodle").catch(
            () => result,
          );
          setConnection(updated);
        }
      } else setCourses([]);
    } catch (error) {
      setError(message(error));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      await api("/api/providers/moodle", { method: "DELETE" });
      setConfirmDisconnect(false);
      await refresh();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="mb-8 text-2xl font-medium tracking-tight">
        {connection?.status === "connected"
          ? "Deine Kurse"
          : "Moodle verbinden"}
      </h1>
      {loading ? (
        <Loading />
      ) : (
        <div className="max-w-3xl">
          {error && (
            <div className="mb-6 space-y-3">
              <Notice>{error}</Notice>
              <Button label="Erneut laden" onPress={() => void refresh()} />
            </div>
          )}
          {connection && (
            <section aria-label="Moodle-Verbindung">
              {connection.status !== "connected" ? (
                <div className="space-y-5">
                  {connection.status === "expired" && (
                    <Notice>
                      Dein Moodle-Zugang ist abgelaufen. Verbinde dich erneut,
                      um deine Kurse wieder abzurufen.
                    </Notice>
                  )}
                  <MoodleLogin
                    initialUrl={connection.siteUrl}
                    onConnected={refresh}
                  />
                </div>
              ) : (
                <div className="space-y-8">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="font-medium">
                        {connection.siteName || "Moodle"}
                      </p>
                      <p className="mt-1 break-all text-sm text-text-muted">
                        {connection.displayName
                          ? `${connection.displayName} · `
                          : ""}
                        {connection.siteUrl}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      label="Verbindung trennen"
                      disabled={busy}
                      onPress={() => setConfirmDisconnect(true)}
                    />
                  </div>
                  {confirmDisconnect && (
                    <div className="space-y-3 border-l-2 border-warning pl-4">
                      <p className="text-sm leading-6">
                        Moodle wirklich trennen? Der gespeicherte Zugang wird
                        entfernt. Bereits importierte Inhalte bleiben erhalten.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          label={
                            busy ? "Wird getrennt …" : "Ja, Verbindung trennen"
                          }
                          onPress={() => void disconnect()}
                          disabled={busy}
                        />
                        <Button
                          variant="ghost"
                          label="Behalten"
                          onPress={() => setConfirmDisconnect(false)}
                          disabled={busy}
                        />
                      </div>
                    </div>
                  )}
                  <div>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-sm text-text-muted">
                        {courses.length} Kurse
                      </p>
                      <Button
                        variant="ghost"
                        label="Aktualisieren"
                        disabled={busy}
                        onPress={() => {
                          setBusy(true);
                          void refresh().finally(() => setBusy(false));
                        }}
                      />
                    </div>
                    {courseError ? (
                      <Notice>{courseError}</Notice>
                    ) : courses.length ? (
                      <ul className="divide-y divide-border border-y border-border">
                        {courses.map((course) => (
                          <li
                            key={course.id}
                            className="flex items-center gap-3 py-4"
                          >
                            <BookOpen
                              size={18}
                              className="shrink-0 text-text-muted"
                              aria-hidden="true"
                            />
                            <div className="min-w-0">
                              <p className="break-words text-sm font-medium">
                                {course.name}
                              </p>
                              {course.shortName !== course.name && (
                                <p className="mt-0.5 text-xs text-text-muted">
                                  {course.shortName}
                                </p>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="border-y border-border py-7 text-sm leading-6 text-text-muted">
                        Die Verbindung steht. Für dieses Moodle-Konto wurden
                        noch keine eingeschriebenen Kurse gefunden.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </>
  );
}
