import { lazy, Suspense, useEffect, useState } from "react";
import { Button } from "@dotnaos/ui-base";
import { ArrowLeft, ArrowUpRight, Download } from "lucide-react";
import {
  api,
  message,
  safeWebUrl,
  type CourseModule,
  type CourseSection,
} from "./api";
import { AppLink, activityPath, type Navigate } from "./navigation";
import { cleanCourseText, visibleResources } from "./course-content";
import { resourceAction } from "./resource-preview";
import { CourseActivities } from "./CourseActivities";
import { Loading, Notice, linkClass } from "./shared";

const ResourceViewer = lazy(() =>
  import("./ResourceViewer").then((module) => ({
    default: module.ResourceViewer,
  })),
);

export function ActivityView({
  courseId,
  courseName,
  moduleId,
  resourceId,
  connected,
  navigate,
}: {
  courseId: number;
  courseName?: string;
  moduleId: number;
  resourceId?: string;
  connected: boolean;
  navigate: Navigate;
}) {
  const [section, setSection] = useState<CourseSection>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setSection(undefined);
    setError("");
    if (connected) {
      void api<CourseSection[]>(
        `/api/providers/moodle/courses/${courseId}/contents`,
        {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(20000),
          ]),
        },
      )
        .then((sections) => {
          if (controller.signal.aborted) return;
          const found = sections.find((item) =>
            item.modules.some((module) => module.id === moduleId),
          );
          if (!found)
            throw new Error(
              "Diese Aktivität ist nicht verfügbar oder wurde entfernt.",
            );
          setSection(found);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setError(message(error));
        });
    }
    return () => controller.abort();
  }, [courseId, moduleId, connected, attempt]);

  const module = section?.modules.find((item) => item.id === moduleId);
  const resources = module ? visibleResources(module) : [];
  const resource = resourceId
    ? resources.find((item) => item.id === resourceId)
    : resources.length === 1 && module?.type === "resource"
      ? resources[0]
      : undefined;
  const action =
    module && resource ? resourceAction(courseId, module, resource) : undefined;
  const back =
    `/courses/${courseId}` + (section ? `#section-${section.id}` : "");
  const unavailableResource = resourceId !== undefined && module && !resource;
  const upstream = module && safeWebUrl(module.url);

  return (
    <div className="max-w-5xl">
      <AppLink href={back} navigate={navigate} className={`${linkClass} mb-4`}>
        <ArrowLeft size={16} aria-hidden="true" /> Zurück zum Kurs
      </AppLink>
      <p className="mb-2 break-words text-sm text-text-muted">
        {courseName || `Kurs ${courseId}`}
      </p>
      <h1 className="mb-6 break-words text-2xl font-medium tracking-tight">
        {module ? cleanCourseText(module.name) || "Aktivität" : "Aktivität"}
      </h1>
      {!connected ? (
        <div className="space-y-4">
          <Notice>
            Die Kursverbindung ist nicht verfügbar. Verbinde deine Quelle
            erneut, um diese Aktivität zu öffnen.
          </Notice>
          <Button
            label="Verbindung prüfen"
            onPress={() => navigate("/sources")}
          />
        </div>
      ) : error ? (
        <div className="space-y-4">
          <Notice>{error}</Notice>
          <Button
            label="Erneut laden"
            onPress={() => setAttempt((value) => value + 1)}
          />
        </div>
      ) : !module || !section ? (
        <Loading label="Aktivität wird geladen …" />
      ) : unavailableResource ? (
        <Notice>Diese Datei ist in der Aktivität nicht mehr verfügbar.</Notice>
      ) : (
        <div className="space-y-6">
          {module.type === "assign" ? (
            <AssignmentDetails
              courseId={courseId}
              module={module}
              section={section}
              navigate={navigate}
            />
          ) : module.description ? (
            <p className="whitespace-pre-line break-words text-sm leading-6">
              {cleanCourseText(module.description)}
            </p>
          ) : null}
          {resource && action?.kind === "preview" ? (
            <Suspense fallback={<Loading label="Vorschau wird geöffnet …" />}>
              <ResourceViewer
                preview={action.preview}
                onClose={() =>
                  navigate(
                    resources.length > 1
                      ? activityPath(courseId, moduleId)
                      : back,
                  )
                }
              />
            </Suspense>
          ) : resource && action?.kind === "download" ? (
            <div className="space-y-3">
              <p className="text-sm text-text-muted">
                Für diese Datei ist keine integrierte Vorschau verfügbar.
              </p>
              <a href={action.href} download className={linkClass}>
                <Download size={16} aria-hidden="true" /> {resource.name}{" "}
                herunterladen
              </a>
            </div>
          ) : resources.length > 0 && !resource ? (
            <div>
              <h2 className="mb-3 text-base font-medium">Dateien</h2>
              <ul className="divide-y divide-border">
                {resources.map((file, index) => (
                  <li key={file.id || index} className="py-3">
                    {file.id ? (
                      <AppLink
                        href={activityPath(courseId, moduleId, file.id)}
                        navigate={navigate}
                        className={linkClass}
                      >
                        {file.name}
                      </AppLink>
                    ) : (
                      <span className="text-sm text-text-muted">
                        {file.name} – nicht verfügbar
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : module.type !== "assign" && !module.description ? (
            <p className="text-sm text-text-muted">
              Dieser Inhalt kann hier noch nicht angezeigt werden.
            </p>
          ) : null}
          {upstream &&
            module.type !== "assign" &&
            action?.kind !== "preview" && (
              <a
                href={upstream}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
              >
                Originalquelle öffnen{" "}
                <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            )}
        </div>
      )}
    </div>
  );
}

type StudyTask = {
  moduleId: number;
  description: string;
  status: string;
  submissionStatus: string | null;
  dueAt: number | null;
  cutoffAt: number | null;
  attachments: { name: string }[];
  warnings: string[];
};
type TaskList = { tasks: StudyTask[]; warnings: string[]; partial: boolean };
const statuses: Record<string, string> = {
  open: "Offen",
  submitted: "Abgegeben",
  overdue: "Überfällig",
  closed: "Geschlossen",
  upcoming: "Noch nicht geöffnet",
  not_open: "Noch nicht geöffnet",
  graded: "Bewertet",
  unknown: "Unbekannt",
};
function deadline(value: number | null) {
  return value
    ? new Intl.DateTimeFormat("de-CH", {
        dateStyle: "full",
        timeStyle: "short",
      }).format(new Date(value * 1000))
    : "Keine Frist hinterlegt";
}
function AssignmentDetails({
  courseId,
  module,
  section,
  navigate,
}: {
  courseId: number;
  module: CourseModule;
  section: CourseSection;
  navigate: Navigate;
}) {
  const [list, setList] = useState<TaskList>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setList(undefined);
    setError("");
    void api<TaskList>(`/api/providers/moodle/tasks?courseId=${courseId}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
    })
      .then((list) => {
        if (!controller.signal.aborted) setList(list);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setError(message(error));
      });
    return () => controller.abort();
  }, [courseId, module.id, attempt]);
  const task = list?.tasks.find((task) => task.moduleId === module.id);
  const description = task?.description || module.description;
  const related = section.modules.filter(
    (item) =>
      item.id !== module.id && ["resource", "folder"].includes(item.type),
  );
  const warnings = [
    ...new Set([...(list?.warnings || []), ...(task?.warnings || [])]),
  ];
  return (
    <>
      {error ? (
        <div className="space-y-3">
          <Notice>{error}</Notice>
          <Button
            label="Abgabedaten erneut laden"
            onPress={() => setAttempt((value) => value + 1)}
          />
        </div>
      ) : !list ? (
        <Loading label="Abgabedaten werden geladen …" />
      ) : !task ? (
        <Notice>Für diese Aufgabe sind keine Abgabedaten verfügbar.</Notice>
      ) : (
        <dl className="grid gap-x-8 gap-y-2 border-y border-border py-4 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-text-muted">Status</dt>
          <dd>{statuses[task.status] || task.status}</dd>
          <dt className="text-text-muted">Abgabe bis</dt>
          <dd>
            {task.dueAt === null && task.status === "unknown"
              ? "Nicht verfügbar"
              : deadline(task.dueAt)}
          </dd>
          {task.cutoffAt && task.cutoffAt !== task.dueAt ? (
            <>
              <dt className="text-text-muted">Annahmeschluss</dt>
              <dd>{deadline(task.cutoffAt)}</dd>
            </>
          ) : null}
          {task.submissionStatus && (
            <>
              <dt className="text-text-muted">Abgabestatus</dt>
              <dd>
                {(
                  {
                    submitted: "Abgegeben",
                    draft: "Entwurf",
                    new: "Noch keine Abgabe",
                  } as Record<string, string>
                )[task.submissionStatus] || task.submissionStatus}
              </dd>
            </>
          )}
        </dl>
      )}
      {description ? (
        <p className="whitespace-pre-line break-words text-sm leading-6">
          {cleanCourseText(description)}
        </p>
      ) : (
        <p className="text-sm text-text-muted">
          Direkt in dieser Aufgabe ist keine Beschreibung hinterlegt.
        </p>
      )}
      {task && task.attachments.length > 0 && (
        <div>
          <h2 className="mb-2 text-base font-medium">Aufgabenanhänge</h2>
          <ul className="space-y-2 text-sm">
            {task.attachments.map((file, i) => (
              <li key={i}>{file.name}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-text-muted">
            Die Quelle liefert hier nur Dateiinformationen, keinen abrufbaren
            Anhang.
          </p>
        </div>
      )}
      {related.length > 0 && (
        <div>
          <h2 className="mb-3 text-base font-medium">
            Materialien im selben Kursabschnitt
          </h2>
          <CourseActivities
            courseId={courseId}
            modules={related}
            navigate={navigate}
          />
        </div>
      )}
      {warnings.length > 0 && <Notice>{warnings.join(" ")}</Notice>}
      {list?.partial && warnings.length === 0 && (
        <Notice>Die Abgabedaten sind möglicherweise unvollständig.</Notice>
      )}
    </>
  );
}
