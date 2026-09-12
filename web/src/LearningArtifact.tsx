import { useState } from "react";
import { Button } from "@dotnaos/ui-base";
import { BookOpen, ChevronDown, PencilLine } from "lucide-react";
import { api, message } from "./api";
import {
  learningPath,
  type LearningState,
  type LearningVersion,
} from "./learning-api";
import { SafeMarkdown } from "./SafeMarkdown";
import { SourceChips, type SourceSelection } from "./SourceViewer";
import { ExerciseAnswer } from "./ExerciseAnswer";
import { ChapterNavigation } from "./ChapterNavigation";
import { Notice } from "./shared";

export function LearningArtifact({
  courseId,
  version,
  drafts,
  readingSectionId,
  onDraft,
  onPosition,
  onSource,
}: {
  courseId: number;
  version: LearningVersion;
  drafts: Record<string, string>;
  readingSectionId: string | null;
  onDraft: (id: string, answer: string) => void;
  onPosition: (id: string) => void;
  onSource: (source: SourceSelection) => void;
}) {
  const [view, setView] = useState<"script" | "exercises">("script");
  const [error, setError] = useState("");
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
          <button
            type="button"
            aria-pressed={view === "script"}
            onClick={() => setView("script")}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${view === "script" ? "bg-bg-1 font-medium" : "text-text-muted hover:text-text"}`}
          >
            <BookOpen size={15} /> Lernskript
          </button>
          <button
            type="button"
            aria-pressed={view === "exercises"}
            onClick={() => setView("exercises")}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${view === "exercises" ? "bg-bg-1 font-medium" : "text-text-muted hover:text-text"}`}
          >
            <PencilLine size={15} /> Übungen{" "}
            <span className="text-xs text-text-muted">
              {version.exercises.length}
            </span>
          </button>
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
        <div className="pt-5">
          <ChapterNavigation
            sections={version.sections}
            readingSectionId={readingSectionId}
            onSelect={(id) => void goToSection(id)}
          />
          <div className="space-y-7 sm:space-y-9">
            {version.sections.map((section, index) => (
              <section
                key={section.id}
                id={`learning-section-${section.id}`}
                className="scroll-mt-6"
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
            <li key={exercise.id} className="py-6">
              <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                <h3 className="text-base font-medium">
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
