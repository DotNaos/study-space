import { useEffect, useState } from "react";
import { Button } from "@dotnaos/ui-base";
import { ChevronDown } from "lucide-react";
import { api, message } from "./api";
import {
  learningPath,
  type LearningState,
  type LearningVersion,
  type LearningTarget,
} from "./learning-api";
import { SafeMarkdown } from "./SafeMarkdown";
import { SourceChips, type SourceSelection } from "./SourceViewer";
import { ExerciseAnswer } from "./ExerciseAnswer";
import { ChapterNavigation } from "./ChapterNavigation";
import { useCurrentChapter } from "./useCurrentChapter";
import { Notice } from "./shared";

export function LearningArtifact({
  courseId,
  version,
  drafts,
  readingSectionId,
  onDraft,
  onPosition,
  onSource,
  initialTarget,
}: {
  courseId: number;
  initialTarget?: LearningTarget;
  version: LearningVersion;
  drafts: Record<string, string>;
  readingSectionId: string | null;
  onDraft: (id: string, answer: string) => void;
  onPosition: (id: string) => void;
  onSource: (source: SourceSelection) => void;
}) {
  const [view, setView] = useState<"script" | "exercises">(initialTarget?.kind === "exercise" ? "exercises" : "script");
  const [error, setError] = useState("");
  const { contentRef, currentSectionId } = useCurrentChapter(version.sections, view === "script");
  useEffect(() => {
    if (initialTarget) setView(initialTarget.kind === "chapter" ? "script" : "exercises");
  }, [initialTarget]);
  useEffect(() => {
    if (!initialTarget) return;
    const wanted = initialTarget.kind === "chapter" ? "script" : "exercises";
    if (view !== wanted) return;
    const frame = requestAnimationFrame(() => {
      const id = initialTarget.kind === "chapter" ? `learning-heading-${initialTarget.id}` : `exercise-heading-${initialTarget.id}`;
      const target = document.getElementById(id);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "start", behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [initialTarget, version.id, view]);
  async function goToSection(id: string) {
    document
      .getElementById(`learning-heading-${id}`)
      ?.focus({ preventScroll: true });
    document.getElementById(`learning-section-${id}`)?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "start",
    });
    onPosition(id);
    try {
      await api<LearningState>(`${learningPath(courseId)}/position`, {
        method: "PUT",
        body: JSON.stringify({ sectionId: id }),
      });
      setError("");
    } catch (error) {
      setError(message(error));
    }
  }
  const selectedSection = version.sections.find(
    (section) => section.id === readingSectionId,
  );
  return (
    <section className="pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div
          role="group"
          aria-label="Lerninhalt"
          className="flex items-center gap-1"
        >
          <Button
            size="sm"
            variant="ghost"
            icon="file-text"
            label="Lernskript"
            pressed={view === "script"}
            onPress={() => setView("script")}
          />
          <Button
            size="sm"
            variant="ghost"
            icon="pencil-line"
            label={`Übungen ${version.exercises.length}`}
            pressed={view === "exercises"}
            onPress={() => setView("exercises")}
          />
        </div>
        {view === "script" && selectedSection && (
          <Button
            variant="ghost"
            label="An Leseposition weiterlesen"
            onPress={() => void goToSection(selectedSection.id)}
          />
        )}
      </div>
      {error && (
        <div className="mt-4">
          <Notice>{error}</Notice>
        </div>
      )}
      {view === "script" ? (
        <div className={`grid min-w-0 items-start gap-6 pt-5 ${version.sections.length > 1 ? "lg:grid-cols-[minmax(0,1fr)_14rem] lg:gap-8" : ""}`}>
          <ChapterNavigation
            sections={version.sections}
            currentSectionId={currentSectionId}
            onSelect={(id) => void goToSection(id)}
          />
          <div ref={contentRef} className="min-w-0 space-y-7 sm:space-y-9 lg:col-start-1 lg:row-start-1">
            {version.sections.map((section, index) => (
              <section
                key={section.id}
                id={`learning-section-${section.id}`}
                className="scroll-mt-24 last:min-h-[calc(100dvh-8rem)]"
                aria-labelledby={`learning-heading-${section.id}`}
              >
                <h3
                  tabIndex={-1}
                  id={`learning-heading-${section.id}`}
                  className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-x-1.5 text-base font-medium tracking-tight sm:text-lg"
                >
                  <span className="pt-0.5 text-sm text-text-muted/60">
                    {index + 1}
                  </span>
                  <span className="min-w-0 break-words">{section.title}</span>
                </h3>
                <SafeMarkdown>{section.markdown}</SafeMarkdown>
                <SourceChips
                  references={section.sources}
                  sources={version.sources}
                  onOpen={onSource}
                />
              </section>
            ))}
          </div>
        </div>
      ) : (
        <ol className="divide-y divide-border">
          {version.exercises.map((exercise, index) => (
            <li key={exercise.id} id={`learning-exercise-${exercise.id}`} className="py-6">
              <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                <h3 tabIndex={-1} id={`exercise-heading-${exercise.id}`} className="scroll-mt-24 text-base font-medium">
                  <span className="mr-2 text-sm text-text-muted/60">
                    {index + 1}
                  </span>
                  {exercise.title}
                </h3>
                <span className="shrink-0 text-xs text-text-muted">
                  {exercise.origin === "source"
                    ? "Aus dem Kursmaterial"
                    : "Erstellte Übung"}
                </span>
              </div>
              <SafeMarkdown>{exercise.prompt}</SafeMarkdown>
              <SourceChips
                references={exercise.sources}
                sources={version.sources}
                onOpen={onSource}
              />
              <ExerciseAnswer
                courseId={courseId}
                exerciseId={exercise.id}
                answer={drafts[exercise.id] || ""}
                onSaved={(answer) => onDraft(exercise.id, answer)}
              />
              {!!exercise.hint && (
                <details className="group mt-4">
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-text-muted">
                    <ChevronDown size={14} className="group-open:rotate-180" />
                    Hinweis anzeigen
                  </summary>
                  <SafeMarkdown>{exercise.hint}</SafeMarkdown>
                </details>
              )}
              <details className="group mt-4">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-text-muted">
                  <ChevronDown size={14} className="group-open:rotate-180" />
                  Lösung anzeigen
                </summary>
                <div className="mt-2 border-l-2 border-border pl-4">
                  <SafeMarkdown>{exercise.solution}</SafeMarkdown>
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
