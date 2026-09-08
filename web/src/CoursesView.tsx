import { useCallback, useEffect, useState } from "react";
import { Button, Input } from "@dotnaos/ui-base";
import { Search } from "lucide-react";
import { api, message, type Connection, type Course } from "./api";
import { CourseDetail } from "./CourseDetail";
import { type Navigate } from "./navigation";
import { Loading, Notice } from "./shared";
import { CourseLibrary } from "./CourseLibrary";
import { groupCourses } from "./course-library";

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
  const groups = groupCourses(courses || [], query);
  return (
    <div className="max-w-4xl">
      <div className="mb-9 flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">
            Kurse
          </h1>
          {courses && courses.length > 0 && (
            <p className="mt-2 text-sm text-text-muted">
              {courses.length}{" "}
              {courses.length === 1
                ? "Kurs in deiner Bibliothek"
                : "Kurse in deiner Bibliothek"}
            </p>
          )}
        </div>
        {!!courses?.length && !error && (
          <div className="relative w-full sm:w-72">
            <Input
              accessibilityLabel="Kurse durchsuchen"
              type="search"
              placeholder="Kurs oder Semester suchen"
              value={query}
              onValueChange={setQuery}
              fullWidth
            />
          </div>
        )}
      </div>
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
          {groups.length ? (
            <CourseLibrary groups={groups} navigate={navigate} />
          ) : (
            <div className="space-y-3">
              <p role="status" className="text-sm text-text-muted">
                <Search size={18} className="mb-3" aria-hidden="true" />
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
