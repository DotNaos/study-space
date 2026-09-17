import "./structure-editor.css";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Button } from "@dotnaos/ui-base";
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
        <button
          type="button"
          onClick={() => setArtworkOpen(true)}
          disabled={!moodleConnected || !onCourseChanged}
          aria-label="Kursbild ändern"
          title="Kursbild ändern"
          className="group relative mt-1 shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-default sm:mt-0"
        >
          <CourseArtwork
            course={course}
            eager
            className="size-14 sm:h-20 sm:w-28"
          />
          {moodleConnected && onCourseChanged && (
            <span className="absolute bottom-0 right-0 rounded-tl-md rounded-br-lg bg-bg-0/90 p-1.5 text-text-muted">
              <ImagePlus size={14} aria-hidden="true" />
            </span>
          )}
        </button>
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
      <div
        role="group"
        aria-label="Kursansicht"
        className="course-view-tabs mt-4 flex flex-nowrap items-center gap-1 overflow-x-auto border-b border-border pb-3"
      >
        <Button
          size="sm"
          variant="ghost"
          icon="list"
          label="Inhalt"
          pressed={tab === "pipeline"}
          onPress={() => chooseTab("pipeline")}
        />
        <Button
          size="sm"
          variant="ghost"
          icon="folder-open"
          label="Quellen"
          pressed={tab === "materials"}
          onPress={() => chooseTab("materials")}
        />
      </div>
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
