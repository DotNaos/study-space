import { useCallback, useEffect, useState } from "react";
import { Button, Input } from "@dotnaos/ui-base";
import { ArrowRight } from "lucide-react";
import { api, message, type Connection, type Course } from "./api";
import { CourseDetail } from "./CourseDetail";
import { AppLink, type Navigate } from "./navigation";
import { Loading, Notice } from "./shared";

export function CoursesView({
  connection,
  courseId,
  navigate,
}: {
  connection: Connection;
  courseId?: number;
  navigate: Navigate;
}) {
  const [courses, setCourses] = useState<Course[]>();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    if (connection.status !== "connected") return;
    try {
      setCourses(await api<Course[]>("/api/providers/moodle/courses"));
    } catch (error) {
      setError(message(error));
    }
  }, [connection.status]);
  useEffect(() => {
    void load();
  }, [load]);
  if (connection.status !== "connected")
    return (
      <div className="max-w-md space-y-5">
        <h1 className="text-2xl font-medium tracking-tight">Kurse</h1>
        <p className="text-sm leading-6 text-text-muted">
          {connection.status === "expired"
            ? "Deine Moodle-Anmeldung ist abgelaufen."
            : "Verbinde Moodle, um deine Kurse zu sehen."}
        </p>
        <Button
          variant="primary"
          label="Moodle verbinden"
          onPress={() => navigate("/sources")}
        />
      </div>
    );
  if (courseId && courses && !error) {
    const course = courses.find((item) => item.id === courseId);
    return course ? (
      <CourseDetail key={course.id} course={course} navigate={navigate} />
    ) : (
      <div className="max-w-md space-y-4">
        <Notice>Dieser Kurs ist nicht mehr verfügbar.</Notice>
        <Button label="Alle Kurse" onPress={() => navigate("/courses")} />
      </div>
    );
  }
  const normalized = query.trim().toLocaleLowerCase("de");
  const visible = courses?.filter((course) =>
    `${course.name} ${course.shortName}`
      .toLocaleLowerCase("de")
      .includes(normalized),
  );
  return (
    <div className="max-w-3xl">
      <h1 className="mb-8 text-2xl font-medium tracking-tight">Kurse</h1>
      {error ? (
        <div className="space-y-4">
          <Notice>{error}</Notice>
          <div className="flex flex-wrap gap-2">
            <Button label="Erneut laden" onPress={() => void load()} />
            <Button
              variant="ghost"
              label="Verbindung prüfen"
              onPress={() => navigate("/sources")}
            />
          </div>
        </div>
      ) : !courses ? (
        <Loading label="Kurse werden geladen …" />
      ) : courses.length === 0 ? (
        <p className="text-sm leading-6 text-text-muted">
          Die Verbindung steht. Für dieses Moodle-Konto wurden noch keine
          eingeschriebenen Kurse gefunden.
        </p>
      ) : (
        <>
          <div className="mb-6 max-w-md">
            <Input
              accessibilityLabel="Kurse durchsuchen"
              type="search"
              placeholder="Kurse durchsuchen"
              value={query}
              onValueChange={setQuery}
              fullWidth
            />
          </div>
          {visible?.length ? (
            <ul className="divide-y divide-border border-y border-border">
              {visible.map((course) => (
                <li key={course.id}>
                  <AppLink
                    href={`/courses/${course.id}`}
                    navigate={navigate}
                    className="group flex items-center gap-4 rounded-sm py-5 outline-offset-4 focus-visible:outline-2 focus-visible:outline-focus-ring"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-medium group-hover:text-accent">
                        {course.name}
                      </p>
                      {course.shortName && course.shortName !== course.name && (
                        <p className="mt-1 break-words text-xs text-text-muted">
                          {course.shortName}
                        </p>
                      )}
                    </div>
                    <ArrowRight
                      size={17}
                      className="shrink-0 text-text-muted"
                      aria-hidden="true"
                    />
                  </AppLink>
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-3">
              <p role="status" className="text-sm text-text-muted">
                Keine Kurse für „{query}“ gefunden.
              </p>
              <Button
                variant="ghost"
                label="Suche zurücksetzen"
                onPress={() => setQuery("")}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
