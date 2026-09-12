import { useCallback, useEffect, useState } from "react";
import { Button, Input } from "@dotnaos/ui-base";
import { Search } from "lucide-react";
import { api, message, type Connection, type Course } from "./api";
import { CourseDetail } from "./CourseDetail";
import { ActivityView } from "./ActivityView";
import { type Navigate } from "./navigation";
import { Loading, Notice } from "./shared";
import { CourseLibrary } from "./CourseLibrary";
import { groupCourses } from "./course-library";

export function CoursesView({
  connection,
  courseId,
  moduleId,
  resourceId,
  navigate,
}: {
  connection: Connection;
  courseId?: number;
  moduleId?: number;
  resourceId?: string;
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
  if (courseId && moduleId)
    return (
      <ActivityView
        key={`${courseId}:${moduleId}`}
        courseId={courseId}
        courseName={courses?.find((course) => course.id === courseId)?.name}
        moduleId={moduleId}
        resourceId={resourceId}
        connected={connection.status === "connected"}
        navigate={navigate}
      />
    );
  if (courseId && (connection.status !== "connected" || error))
    return (
      <CourseDetail
        key={courseId}
        course={{
          id: courseId,
          name: `Kurs ${courseId}`,
          shortName: "",
          summary: "",
        }}
        moodleConnected={connection.status === "connected"}
        navigate={navigate}
      />
    );
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
      <CourseDetail key={course.id} course={course} navigate={navigate} onCourseChanged={(updated) => setCourses((items) => items?.map((item) => item.id === updated.id ? updated : item))} />
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
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-2xl font-medium tracking-tight sm:text-3xl">
            Kurse
          </h1>
          {courses && courses.length > 0 && (
            <span className="text-xs tabular-nums text-text-muted" aria-label={`${courses.length} Kurse`}>{courses.length}</span>
          )}
        </div>
        {!!courses?.length && !error && (
          <div className="relative w-full [&_input]:min-h-11 [&_input]:pl-10 [&_input]:text-base sm:w-72 sm:[&_input]:text-sm">
            <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-text-muted" />
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
