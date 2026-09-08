import { useCallback, useEffect, useState } from "react";
import { Button } from "@dotnaos/ui-base";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { api, message, type Course, type CourseSection } from "./api";
import { AppLink, type Navigate } from "./navigation";
import { cleanCourseText } from "./course-content";
import { courseSemester, courseSubtitle } from "./course-library";
import { CourseArtwork } from "./CourseArtwork";
import { CourseActivities } from "./CourseActivities";
import { Loading, Notice, linkClass } from "./shared";

export function CourseDetail({
  course,
  navigate,
}: {
  course: Course;
  navigate: Navigate;
}) {
  const [sections, setSections] = useState<CourseSection[]>();
  const [error, setError] = useState("");
  const semester = courseSemester(course);
  const subtitle = courseSubtitle(course);
  const load = useCallback(async () => {
    setError("");
    setSections(undefined);
    try {
      setSections(
        await api<CourseSection[]>(
          `/api/providers/moodle/courses/${course.id}/contents`,
        ),
      );
    } catch (error) {
      setError(message(error));
    }
  }, [course.id]);
  useEffect(() => {
    void load();
  }, [load]);
  const sectionName = (section: CourseSection, index: number) =>
    cleanCourseText(section.name) || `Abschnitt ${index + 1}`;
  return (
    <div className="max-w-5xl">
      <AppLink
        navigate={navigate}
        href="/courses"
        className={`${linkClass} mb-7`}
      >
        <ArrowLeft size={15} aria-hidden="true" /> Alle Kurse
      </AppLink>
      <header className="flex flex-col-reverse gap-4 border-b border-border pb-8 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
        <div className="min-w-0 flex-1">
          {semester && (
            <p className="mb-3 flex items-center gap-2 text-xs font-medium text-text-muted">
              <CalendarDays size={14} aria-hidden="true" />
              {semester.label}
            </p>
          )}
          <h1 className="break-words text-2xl font-medium leading-tight tracking-tight sm:text-4xl">
            {course.name}
          </h1>
          {subtitle && (
            <p className="mt-3 break-words text-sm leading-6 text-text-muted">
              {subtitle}
            </p>
          )}
        </div>
        <CourseArtwork
          course={course}
          eager
          className="h-20 w-28 sm:h-36 sm:w-48"
        />
      </header>
      <div className="mt-7">
        {error ? (
          <div className="space-y-4">
            <Notice>{error}</Notice>
            <Button label="Erneut laden" onPress={() => void load()} />
          </div>
        ) : !sections ? (
          <Loading label="Kursinhalte werden geladen …" />
        ) : sections.length === 0 ? (
          <p className="text-sm text-text-muted">
            In diesem Kurs sind noch keine Inhalte verfügbar.
          </p>
        ) : (
          <div className="flex flex-col gap-8 xl:flex-row xl:gap-10">
            {sections.length > 1 && (
              <nav
                aria-label="Kursabschnitte"
                className="min-w-0 border-b border-border pb-3 xl:sticky xl:top-8 xl:max-h-[calc(100vh-4rem)] xl:w-44 xl:shrink-0 xl:self-start xl:overflow-y-auto xl:border-0 xl:pb-0"
              >
                <p className="mb-3 hidden text-xs font-medium uppercase tracking-wider text-text-muted xl:block">
                  In diesem Kurs
                </p>
                <ol className="flex gap-5 overflow-x-auto pb-1 xl:block xl:space-y-1 xl:overflow-visible">
                  {sections.map((section, index) => (
                    <li key={section.id} className="shrink-0 xl:shrink">
                      <a
                        href={`#section-${section.id}`}
                        className="flex items-baseline gap-2 rounded-sm py-1.5 text-xs leading-5 text-text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                      >
                        <span className="shrink-0 tabular-nums text-text-muted/60">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="xl:break-words">
                          {sectionName(section, index)}
                        </span>
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            )}
            <div className="min-w-0 flex-1 space-y-9">
              {sections.map((section, index) => {
                const summary = cleanCourseText(section.summary);
                return (
                  <section
                    key={section.id}
                    aria-labelledby={`section-${section.id}`}
                  >
                    <div className="mb-2 flex items-baseline gap-3 border-b border-border pb-3">
                      <span
                        className="text-xs tabular-nums text-text-muted/60"
                        aria-hidden="true"
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <h2
                        id={`section-${section.id}`}
                        className="scroll-mt-8 break-words text-xl font-medium tracking-tight"
                      >
                        {sectionName(section, index)}
                      </h2>
                    </div>
                    {summary && (
                      <p className="my-4 whitespace-pre-line break-words text-sm leading-6 text-text-muted">
                        {summary}
                      </p>
                    )}
                    <CourseActivities modules={section.modules} />
                  </section>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
