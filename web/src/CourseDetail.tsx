import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Button } from "@dotnaos/ui-base";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { api, message, type Course, type CourseSection } from "./api";
import { AppLink, type Navigate } from "./navigation";
import { cleanCourseText } from "./course-content";
import { courseSemester, courseSubtitle } from "./course-library";
import { CourseArtwork } from "./CourseArtwork";
import { CourseActivities } from "./CourseActivities";
import { Loading, Notice, linkClass } from "./shared";
import type { ResourcePreview } from "./resource-preview";

const ResourceViewer = lazy(() =>
  import("./ResourceViewer").then((module) => ({
    default: module.ResourceViewer,
  })),
);

export function CourseDetail({
  course,
  navigate,
}: {
  course: Course;
  navigate: Navigate;
}) {
  const [sections, setSections] = useState<CourseSection[]>();
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ResourcePreview>();
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
        className={`${linkClass} mb-4`}
      >
        <ArrowLeft size={15} aria-hidden="true" /> Alle Kurse
      </AppLink>
      <header className="flex items-start justify-between gap-4 border-b border-border pb-5 sm:items-center sm:gap-6">
        <div className="min-w-0 flex-1">
          {semester && (
            <p className="mb-1.5 flex items-center gap-2 text-xs font-medium text-text-muted">
              <CalendarDays size={14} aria-hidden="true" />
              {semester.label}
            </p>
          )}
          <h1 className="break-words text-xl font-medium leading-snug tracking-tight sm:text-2xl">
            {course.name}
          </h1>
          {subtitle && (
            <p className="mt-1 break-words text-xs leading-5 text-text-muted">
              {subtitle}
            </p>
          )}
        </div>
        <CourseArtwork
          course={course}
          eager
          className="mt-1 h-12 w-16 sm:mt-0 sm:h-20 sm:w-28"
        />
      </header>
      <div className="mt-5">
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
          <div className="flex flex-col gap-5 xl:flex-row xl:gap-8">
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
                        <span
                          title={sectionName(section, index)}
                          className="max-w-52 truncate xl:line-clamp-2 xl:max-w-none xl:whitespace-normal xl:break-words"
                        >
                          {sectionName(section, index)}
                        </span>
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            )}
            <div className="min-w-0 flex-1 space-y-6">
              {sections.map((section, index) => {
                const summary = cleanCourseText(section.summary);
                return (
                  <section
                    key={section.id}
                    aria-labelledby={`section-${section.id}`}
                  >
                    <div className="mb-1 flex items-baseline gap-2 border-b border-border pb-2">
                      <span
                        className="text-xs tabular-nums text-text-muted/60"
                        aria-hidden="true"
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <h2
                        id={`section-${section.id}`}
                        className="scroll-mt-8 break-words text-base font-medium tracking-tight sm:text-lg"
                      >
                        {sectionName(section, index)}
                      </h2>
                    </div>
                    {summary && (
                      <p className="my-2 whitespace-pre-line break-words text-sm leading-5 text-text-muted">
                        {summary}
                      </p>
                    )}
                    <CourseActivities
                      courseId={course.id}
                      modules={section.modules}
                      onPreview={setPreview}
                    />
                  </section>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {preview && (
        <Suspense fallback={<Loading label="Vorschau wird geöffnet …" />}>
          <ResourceViewer
            key={preview.path}
            preview={preview}
            onClose={() => setPreview(undefined)}
          />
        </Suspense>
      )}
    </div>
  );
}
