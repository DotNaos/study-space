import { lazy, Suspense, useEffect, useState } from "react";
import { Button, Checkbox, Select } from "@dotnaos/ui-base";
import { ChevronDown } from "lucide-react";
import { api, message } from "./api";
import { readPipeline } from "./pipeline-api";
import {
  learningPath,
  runningJob,
  type LearningCourse,
  type LearningState,
  type LearningVersion,
  type LearningTarget,
} from "./learning-api";
import type { MaterialState } from "./material-api";
import { useCodexConnection } from "./codex-api";
import { CodexConnectionControl } from "./CodexConnection";
import { MaterialPreparation } from "./MaterialPreparation";
import { TaskReconciliation } from "./TaskReconciliation";
import { LearningArtifact } from "./LearningArtifact";
import type { SourceSelection } from "./SourceViewer";
import { Loading, Notice } from "./shared";

const LearningChat = lazy(() =>
  import("./LearningChat").then((module) => ({ default: module.LearningChat })),
);
export function LearningPanel({
  courseId,
  learning,
  materials,
  moodleConnected,
  onSource,
  initialTarget,
  preparationOpen = false,
}: {
  courseId: number;
  initialTarget?: LearningTarget;
  preparationOpen?: boolean;
  learning: LearningCourse;
  materials: MaterialState;
  moodleConnected: boolean;
  onSource: (source: SourceSelection) => void;
}) {
  const codex = useCodexConnection();
  const [allowPartial, setAllowPartial] = useState(false);
  const [extraExercises, setExtraExercises] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewVersion, setPreviewVersion] = useState<LearningVersion>();
  const [chatOpen, setChatOpen] = useState(false);
  const state = learning.state;
  const version = previewVersion ?? state?.activeVersion;
  const generating = runningJob(state?.job);
  const coverage = materials.snapshot?.coverage;
  useEffect(() => setAllowPartial(false), [materials.snapshot?.snapshotId]);
  const canGenerate =
    !!materials.snapshot?.snapshotId &&
    !!coverage?.ready &&
    !runningJob(materials.snapshot?.job) &&
    codex.connection?.status === "connected";
  async function generate() {
    if (!canGenerate || !materials.snapshot?.snapshotId) return;
    setBusy(true);
    setError("");
    try {
      const plan = await readPipeline(courseId);
      learning.setState(
        await api<LearningState>(`${learningPath(courseId)}/generate`, {
          method: "POST",
          body: JSON.stringify({
            snapshotId: materials.snapshot.snapshotId,
            allowPartial,
            consentToCodex: true,
            planRevision: plan.revision,
            extraExercises,
          }),
        }),
      );
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!state?.job) return;
    setBusy(true);
    setError("");
    try {
      learning.setState(
        await api<LearningState>(`${learningPath(courseId)}/cancel`, {
          method: "POST",
          body: JSON.stringify({ jobId: state.job.id }),
        }),
      );
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function selectVersion(id: string) {
    if (id === state?.activeVersionId) {
      setPreviewVersion(undefined);
      return;
    }
    setBusy(true);
    setError("");
    try {
      setPreviewVersion(
        await api<LearningVersion>(
          `${learningPath(courseId)}/versions/${encodeURIComponent(id)}`,
        ),
      );
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function activate() {
    if (!previewVersion) return;
    setBusy(true);
    setError("");
    try {
      learning.setState(
        await api<LearningState>(`${learningPath(courseId)}/activate`, {
          method: "POST",
          body: JSON.stringify({
            versionId: previewVersion.id,
            expectedActiveVersionId: state?.activeVersionId ?? null,
            checkRevision: true,
          }),
        }),
      );
      setPreviewVersion(undefined);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="min-w-0">
      {preparationOpen && <div className="prepare-section-heading"><Button variant="ghost" size="sm" icon="arrow-left" label="Quellen" onPress={()=>{window.location.hash="prepare";}}/><h2>Lerninhalte erstellen</h2></div>}
      {version && !preparationOpen && (
        <TaskReconciliation
          key={version.id}
          courseId={courseId}
          version={version}
          activeVersionId={state?.activeVersionId ?? null}
          onSource={onSource}
          onCandidate={(next) => {
            setPreviewVersion(next);
            void learning.refresh();
          }}
        />
      )}
      <details
        open={
          preparationOpen || !version || generating || !!error || !!learning.error || undefined
        }
        className="group border-b border-border"
      >
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 py-4 text-xs text-text-muted">
          <ChevronDown size={14} className="group-open:rotate-180" />
          {coverage?.total
            ? `${coverage.ready}/${coverage.total} Materialien erfasst${coverage.complete ? "" : " · Unvollständig"}`
            : "Materialien und ChatGPT vorbereiten"}
          {version && <span> · Vorbereitung und neue Version</span>}
        </summary>
        <MaterialPreparation
          materials={materials}
          connected={moodleConnected}
          onSource={onSource}
        />
        <div className="border-b border-border py-4">
          <CodexConnectionControl codex={codex} />
        </div>
        <div className="space-y-3 border-b border-border py-5">
          {generating && state?.job ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Loading label="Lernskript und Übungen werden erstellt …" />
                <Button
                  variant="ghost"
                  label="Erstellung abbrechen"
                  disabled={busy}
                  onPress={() => void cancel()}
                />
              </div>
              <p className="text-xs text-text-muted">
                {state.job.totalSteps > 0
                  ? `${state.job.completedSteps} von ${state.job.totalSteps} Schritten abgeschlossen`
                  : "Die erfassten Materialien werden vorbereitet."}{" "}
                Bereits fertige Inhalte und frühere Versionen bleiben
                gespeichert.
              </p>
              {state.job.totalSteps > 0 && (
                <progress
                  className="h-1 w-full accent-accent"
                  aria-label="Lernbereich erstellen"
                  value={state.job.completedSteps}
                  max={state.job.totalSteps}
                />
              )}
            </>
          ) : (
            <>
              {!!coverage?.ready && (
                <Checkbox
                  checked={allowPartial}
                  onCheckedChange={setAllowPartial}
                  label="Bestätigte Quellen trotz offener Einordnungen verarbeiten"
                  description="Fehlende Inhalte bleiben ausdrücklich gekennzeichnet."
                />
              )}
              <Button
                variant="ghost"
                size="sm"
                label="Quellen und Gliederung prüfen"
                onPress={() => {
                  window.location.hash = "prepare";
                }}
              />
              <Checkbox
                checked={extraExercises}
                onCheckedChange={setExtraExercises}
                label="Zusätzliche KI-Übungen erstellen"
                description="Ohne Auswahl werden nur vorhandene Aufgaben übernommen."
              />
              <p className="max-w-2xl text-xs leading-5 text-text-muted">
                Beim Erstellen werden die erfassten Texte und Quellenbilder über
                dein verbundenes Codex-Konto an OpenAI übermittelt. Daraus
                entstehen ein Lernskript und passende Übungen mit Quellen.
              </p>
              <Button
                variant={version ? "secondary" : "primary"}
                label={
                  busy
                    ? "Bitte warten …"
                    : version
                      ? "Neue Version erstellen"
                      : "Lernbereich erstellen"
                }
                disabled={busy || !canGenerate}
                onPress={() => void generate()}
              />
            </>
          )}
          {(error || learning.error) && (
            <Notice>{error || learning.error}</Notice>
          )}
          {learning.error && (
            <Button
              label="Lernbereich erneut laden"
              variant="ghost"
              onPress={() => void learning.refresh().catch(() => {})}
            />
          )}
          {state?.job?.status === "failed" && state.job.error && (
            <Notice>{state.job.error}</Notice>
          )}
          {state?.job?.status === "cancelled" && (
            <p role="status" className="text-sm text-text-muted">
              Die Erstellung wurde abgebrochen. Vorhandene Lernbereiche bleiben
              erhalten.
            </p>
          )}
        </div>
      </details>
      {state?.job?.candidateVersionId &&
        state.job.candidateVersionId !== state.activeVersionId &&
        !previewVersion && (
          <div className="flex flex-wrap items-center gap-3 border-b border-border py-3">
            <p className="text-sm">Eine neue Version ist bereit.</p>
            <Button
              variant="ghost"
              label="Neue Version prüfen"
              onPress={() => void selectVersion(state.job!.candidateVersionId!)}
            />
          </div>
        )}
      {learning.loading ? (
        <div className="py-8">
          <Loading label="Gespeicherter Lernbereich wird geladen …" />
        </div>
      ) : version ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4 pt-6">
            <div className="min-w-0">
              <h2 className="break-words text-xl font-medium tracking-tight">
                {version.title}
              </h2>
              <p className="mt-1 text-xs text-text-muted">
                {version.sections.length} Kapitel · {version.exercises.length}{" "}
                Übungen
                {version.partial && (
                  <span className="text-warning">
                    {" "}
                    · Teilweise Materialabdeckung
                  </span>
                )}
              </p>
            </div>
            {!!state?.versions.length && (
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <span>Version</span>
                <Select
                  accessibilityLabel="Version des Lernbereichs"
                  value={version.id}
                  onValueChange={(value) => void selectVersion(value)}
                  disabled={busy}
                  size="sm"
                  fullWidth={false}
                  options={state.versions.map((item, index) => ({
                    value: item.id,
                    label: `${new Date(item.createdAt).toLocaleDateString("de-CH")} · Version ${index + 1}${item.id === state.activeVersionId ? " · aktiv" : ""}`,
                  }))}
                />
              </div>
            )}
          </div>
          {previewVersion && (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-l-2 border-accent pl-4">
              <p className="text-sm text-text-muted">
                Du prüfst eine gespeicherte Version. Antworten bleiben erhalten.
              </p>
              <Button
                label="Diese Version verwenden"
                disabled={busy}
                onPress={() => void activate()}
              />
              <Button
                variant="ghost"
                label="Zur aktiven Version"
                onPress={() => setPreviewVersion(undefined)}
              />
            </div>
          )}
          {!!version.warnings.length && (
            <details className="group mt-4 text-xs text-text-muted">
              <summary className="flex cursor-pointer list-none items-center gap-2">
                <ChevronDown size={14} className="group-open:rotate-180" />
                Hinweise zur Abdeckung
              </summary>
              <ul className="mt-2 space-y-1 pl-5">
                {version.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
          <LearningArtifact
            activeVersionId={state?.activeVersionId ?? null}
            onCandidate={(next) => {
              setPreviewVersion(next);
              void learning.refresh();
            }}
            key={version.id}
            initialTarget={initialTarget}
            courseId={courseId}
            version={version}
            drafts={state?.drafts || {}}
            readingSectionId={state?.readingSectionId || null}
            onDraft={(id, answer) =>
              learning.setState(
                (state) =>
                  state && {
                    ...state,
                    drafts: { ...state.drafts, [id]: answer },
                  },
              )
            }
            onPosition={(id) =>
              learning.setState(
                (state) => state && { ...state, readingSectionId: id },
              )
            }
            onSource={onSource}
          />
          <section className="mt-10 border-t border-border pt-4">
            <Button
              size="sm"
              variant="ghost"
              icon="sparkles"
              iconAfter={chatOpen ? "chevron-up" : "chevron-down"}
              label="Fragen zu diesem Lernbereich"
              pressed={chatOpen}
              expanded={chatOpen}
              onPress={() => setChatOpen((open) => !open)}
            />
            {chatOpen && (
              <Suspense fallback={<Loading label="Fragen werden geladen …" />}>
                <LearningChat
                  key={version.id}
                  courseId={courseId}
                  versionId={version.id}
                  savedMessages={state?.messages || []}
                  connected={codex.connection?.status === "connected"}
                  onFinished={() => void learning.refresh().catch(() => {})}
                />
              </Suspense>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
