import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Button } from "@dotnaos/ui-base";
import { ArrowLeft, CalendarDays, BookOpen, Files, ImagePlus } from "lucide-react";
import { api, message, type Course, type CourseSection } from "./api";
import { AppLink, type Navigate } from "./navigation";
import { cleanCourseText } from "./course-content";
import { courseSemester, courseSubtitle } from "./course-library";
import { CourseArtwork } from "./CourseArtwork";
import { CourseActivities } from "./CourseActivities";
import { Loading, Notice, linkClass } from "./shared";
import type { ResourcePreview } from "./resource-preview";
import { useLearningCourse } from "./learning-api";
import { useMaterialSnapshot } from "./material-api";
import { MaterialPreparation } from "./MaterialPreparation";
import type { SourceSelection } from "./SourceViewer";
const CourseArtworkEditor = lazy(() => import("./CourseArtworkEditor").then((module) => ({ default: module.CourseArtworkEditor })));
const LearningPanel = lazy(() =>
  import("./LearningPanel").then((module) => ({
    default: module.LearningPanel,
  })),
);
const SourceViewer = lazy(() =>
  import("./SourceViewer").then((module) => ({ default: module.SourceViewer })),
);

const ResourceViewer = lazy(() =>
  import("./ResourceViewer").then((module) => ({
    default: module.ResourceViewer,
  })),
);

export function CourseDetail({
  course,
  navigate,
  moodleConnected = true,
  onCourseChanged,
}: {
  course: Course;
  navigate: Navigate;
  moodleConnected?: boolean;
  onCourseChanged?: (course: Course) => void;
}) {
  const [artworkOpen, setArtworkOpen] = useState(false);
  const [sections, setSections] = useState<CourseSection[]>();
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ResourcePreview>();
  const [source, setSource] = useState<SourceSelection>();
  const [tab, setTab] = useState<"materials" | "learning">("materials");
  const [tabChosen, setTabChosen] = useState(
    () =>
      typeof window !== "undefined" &&
      window.location.hash.startsWith("#section-"),
  );
  const learning = useLearningCourse(course.id);
  const materials = useMaterialSnapshot(course.id);
  useEffect(() => {
    if (!tabChosen && !learning.loading)
      setTab(learning.state?.activeVersion || learning.state?.job ? "learning" : "materials");
  }, [learning.loading, learning.state?.activeVersionId, learning.state?.job?.id, tabChosen]);
  const semester = courseSemester(course);
  const subtitle = courseSubtitle(course);
  const load = useCallback(async () => {
    setError("");
    setSections(undefined);
    if (!moodleConnected) return;
    try {
      setSections(
        await api<CourseSection[]>(
          `/api/providers/moodle/courses/${course.id}/contents`,
        ),
      );
    } catch (error) {
      setError(message(error));
    }
  }, [course.id, moodleConnected]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!sections || tab !== "materials") return;
    const scrollToSection = () => {
      const id = window.location.hash.slice(1);
      if (/^section-[1-9][0-9]*$/.test(id))
        document.getElementById(id)?.scrollIntoView({ block: "start" });
    };
    const frame = requestAnimationFrame(scrollToSection);
    window.addEventListener("hashchange", scrollToSection);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", scrollToSection);
    };
  }, [sections, tab]);
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
              {semester.shortLabel}
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
        <button type="button" onClick={() => setArtworkOpen(true)} disabled={!moodleConnected || !onCourseChanged}
          aria-label="Kursbild ändern" title="Kursbild ändern"
          className="group relative mt-1 shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-default sm:mt-0">
          <CourseArtwork course={course} eager className="size-14 sm:h-20 sm:w-28" />
          {moodleConnected && onCourseChanged && <span className="absolute bottom-0 right-0 rounded-tl-md rounded-br-lg bg-bg-0/90 p-1.5 text-text-muted"><ImagePlus size={14} aria-hidden="true" /></span>}
        </button>
      </header>
      {artworkOpen && onCourseChanged && <Suspense fallback={<Loading label="Bildeditor wird geöffnet …" />}>
        <CourseArtworkEditor course={course} onChanged={onCourseChanged} onClose={() => setArtworkOpen(false)} />
      </Suspense>}
      <div
        role="group"
        aria-label="Kursansicht"
        className="mt-4 flex items-center gap-1 border-b border-border pb-3"
      >
        <button
          type="button"
          aria-pressed={tab === "learning"}
          onClick={() => {
            setTab("learning");
            setTabChosen(true);
          }}
          className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${tab === "learning" ? "bg-bg-1 font-medium" : "text-text-muted hover:text-text"}`}
        >
          <BookOpen size={16} /> Lernen
        </button>
        <button
          type="button"
          aria-pressed={tab === "materials"}
          onClick={() => {
            setTab("materials");
            setTabChosen(true);
          }}
          className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${tab === "materials" ? "bg-bg-1 font-medium" : "text-text-muted hover:text-text"}`}
        >
          <Files size={16} /> Materialien
        </button>
      </div>
      {!tabChosen && learning.loading ? (
        <div className="py-6">
          <Loading label="Kurs wird geöffnet …" />
        </div>
      ) : tab === "learning" ? (
        <Suspense
          fallback={
            <div className="py-6">
              <Loading label="Lernbereich wird geöffnet …" />
            </div>
          }
        >
          <LearningPanel
            courseId={course.id}
            learning={learning}
            materials={materials}
            moodleConnected={moodleConnected}
            onSource={setSource}
          />
        </Suspense>
      ) : (
        <div className="mt-5">
          {!moodleConnected ? (
            <MaterialPreparation
              materials={materials}
              connected={false}
              onSource={setSource}
              expanded
            />
          ) : error ? (
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
                        navigate={navigate}
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
      )}
      {source && (
        <Suspense fallback={<Loading label="Quelle wird geöffnet …" />}>
          <SourceViewer
            key={`${source.materialId}-${source.revision}-${source.blockId}`}
            source={source}
            onClose={() => setSource(undefined)}
          />
        </Suspense>
      )}
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
