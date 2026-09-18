import "./structure-editor.css";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, ImagePlus } from "lucide-react";
import { api, message, type Course, type CourseSection } from "./api";
import { AppLink, type Navigate } from "./navigation";
import { courseSemester, courseSubtitle } from "./course-library";
import { CourseArtwork } from "./CourseArtwork";
import { Loading, linkClass } from "./shared";
import { useLearningCourse, type LearningTarget } from "./learning-api";
import { useMaterialSnapshot } from "./material-api";
import type { SourceSelection } from "./SourceViewer";
const PipelineView = lazy(() =>
  import("./PipelineView").then((module) => ({ default: module.PipelineView })),
);
const ContentGraphView = lazy(() =>
  import("./ContentGraphView").then((module) => ({
    default: module.ContentGraphView,
  })),
);
const CourseArtworkEditor = lazy(() =>
  import("./CourseArtworkEditor").then((module) => ({
    default: module.CourseArtworkEditor,
  })),
);
const LearningPanel = lazy(() =>
  import("./LearningPanel").then((module) => ({
    default: module.LearningPanel,
  })),
);
const CourseSourcesView = lazy(() =>
  import("./CourseSourcesView").then((module) => ({ default: module.CourseSourcesView })),
);
const SourceViewer = lazy(() =>
  import("./SourceViewer").then((module) => ({ default: module.SourceViewer })),
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
  const [source, setSource] = useState<SourceSelection>();
  const [learningTarget, setLearningTarget] = useState<LearningTarget>();
  const [tab, setTab] = useState<
    "materials" | "learning" | "graph" | "pipeline"
  >(() =>
    typeof window !== "undefined" && window.location.hash.startsWith("#prepare")
      ? "pipeline"
      : typeof window !== "undefined" &&
          window.location.hash.startsWith("#graph")
        ? "graph"
        : typeof window !== "undefined" &&
            window.location.hash.startsWith("#section-")
          ? "materials"
          : "pipeline",
  );
  const [tabChosen, setTabChosen] = useState(
    () =>
      typeof window !== "undefined" &&
      (window.location.hash.startsWith("#section-") ||
        window.location.hash.startsWith("#graph") ||
        window.location.hash.startsWith("#prepare")),
  );
  const learning = useLearningCourse(course.id);
  const materials = useMaterialSnapshot(course.id);
  useEffect(() => {
    if (!tabChosen && !learning.loading) setTab("pipeline");
  }, [learning.loading, tabChosen]);
  useEffect(() => {
    const followGraph = () => {
      if (window.location.hash.startsWith("#graph")) {
        setTab("graph");
        setTabChosen(true);
      }
      if (window.location.hash.startsWith("#prepare")) {
        setTab("pipeline");
        setTabChosen(true);
      }
    };
    window.addEventListener("hashchange", followGraph);
    return () => window.removeEventListener("hashchange", followGraph);
  }, []);
  function chooseTab(next: "materials" | "learning" | "graph" | "pipeline") {
    setTab(next);
    setTabChosen(true);
    setLearningTarget(undefined);
    if (
      next === "graph" ||
      next === "pipeline" ||
      window.location.hash.startsWith("#graph") ||
      window.location.hash.startsWith("#prepare")
    )
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}${next === "graph" ? "#graph" : next === "pipeline" ? "#prepare" : ""}`,
      );
  }
  const semester = courseSemester(course);
  const subtitle = courseSubtitle(course);
  const load = useCallback(
    async (preserve = false) => {
      setError("");
      if (!preserve) setSections(undefined);
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
    },
    [course.id, moodleConnected],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div
      data-learning-course
      className={
        tab === "graph" || tab === "pipeline" ? "min-w-0" : "max-w-5xl"
      }
    >
      <AppLink
        navigate={navigate}
        href="/courses"
        className={`${linkClass} mb-4`}
      >
        <ArrowLeft size={15} aria-hidden="true" /> Alle Kurse
      </AppLink>
      <header className="relative isolate min-h-36 overflow-hidden border-b border-border/60 sm:min-h-40">
        <div
          className="pointer-events-none absolute -right-8 -top-10 h-[calc(100%+4rem)] w-[72%] opacity-80 sm:-right-12 sm:w-[58%]"
          style={{
            WebkitMaskImage:
              "linear-gradient(to right, transparent 0%, rgba(0,0,0,0.18) 22%, black 58%, black 100%)",
            maskImage:
              "linear-gradient(to right, transparent 0%, rgba(0,0,0,0.18) 22%, black 58%, black 100%)",
          }}
        >
          <CourseArtwork course={course} eager className="h-full w-full" />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-bg-0 via-bg-0/25 to-transparent" />

        <div className="relative z-10 flex min-h-36 items-end py-5 pr-12 sm:min-h-40 sm:py-6">
          <div className="min-w-0 max-w-3xl">
            {semester && (
              <p className="mb-2 flex items-center gap-2 text-xs font-medium text-text-muted">
                <CalendarDays size={14} aria-hidden="true" />
                {semester.shortLabel}
              </p>
            )}
            <h1 className="break-words text-2xl font-medium leading-snug tracking-tight sm:text-3xl">
              {course.name}
            </h1>
            {subtitle && (
              <p className="mt-1.5 break-words text-sm leading-5 text-text-muted">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {moodleConnected && onCourseChanged && (
          <button
            type="button"
            onClick={() => setArtworkOpen(true)}
            aria-label="Kursbild ändern"
            title="Kursbild ändern"
            className="absolute right-0 top-1 z-20 flex size-8 items-center justify-center rounded-md bg-bg-0/45 text-text-muted backdrop-blur-md transition-colors hover:bg-bg-0/70 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <ImagePlus size={14} aria-hidden="true" />
          </button>
        )}
      </header>
      {artworkOpen && onCourseChanged && (
        <Suspense fallback={<Loading label="Bildeditor wird geöffnet …" />}>
          <CourseArtworkEditor
            course={course}
            onChanged={onCourseChanged}
            onClose={() => setArtworkOpen(false)}
          />
        </Suspense>
      )}
      <div className="mt-3">
      {!tabChosen && learning.loading ? (
        <div className="py-6">
          <Loading label="Kurs wird geöffnet …" />
        </div>
      ) : tab === "pipeline" ? (
        <Suspense fallback={<Loading label="Inhalt wird geöffnet …" />}>
          <PipelineView
            courseId={course.id}
            courseName={course.name}
            version={learning.state?.activeVersion}
            onSource={setSource}
            onOpenLearning={(target) => {
              chooseTab("learning");
              setLearningTarget(target);
            }}
          />
        </Suspense>
      ) : tab === "graph" ? (
        <Suspense
          fallback={
            <div className="py-6">
              <Loading label="Graph wird geöffnet …" />
            </div>
          }
        >
          <ContentGraphView
            learning={learning}
            materials={materials}
            sections={sections}
            onSource={setSource}
            sectionsError={error}
            sectionsLoading={moodleConnected && !sections && !error}
            moodleConnected={moodleConnected}
            onRefresh={() => void load(true)}
            onOpenLearning={(target) => {
              chooseTab("learning");
              setLearningTarget(target);
            }}
            onOpenActivity={(moduleId, resourceId) =>
              navigate(
                `/courses/${course.id}/activities/${moduleId}${resourceId ? `?resource=${encodeURIComponent(resourceId)}` : ""}`,
              )
            }
          />
        </Suspense>
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
            initialTarget={learningTarget}
            learning={learning}
            materials={materials}
            moodleConnected={moodleConnected}
            onSource={setSource}
          />
        </Suspense>
      ) : (
        <Suspense fallback={<Loading label="Quellen werden geöffnet …"/>}>
          <CourseSourcesView
            courseId={course.id}
            materials={materials}
            connected={moodleConnected}
            onSource={setSource}
            onGraph={() => chooseTab("graph")}
          />
        </Suspense>
      )}
      </div>
      {source && (
        <Suspense fallback={<Loading label="Quelle wird geöffnet …" />}>
          <SourceViewer
            key={`${source.materialId}-${source.revision}-${source.blockId}`}
            source={source}
            onClose={() => setSource(undefined)}
          />
        </Suspense>
      )}
    </div>
  );
}
