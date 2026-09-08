import { useCallback, useEffect, useState } from "react";
import { Button } from "@dotnaos/ui-base";
import { ArrowLeft, ArrowUpRight, FileText } from "lucide-react";
import {
  api,
  message,
  safeWebUrl,
  type Course,
  type CourseSection,
} from "./api";
import { AppLink, type Navigate } from "./navigation";
import { formatFileSize } from "./course-content";
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
  return (
    <div className="max-w-3xl">
      <AppLink
        navigate={navigate}
        href="/courses"
        className={`${linkClass} mb-6`}
      >
        <ArrowLeft size={15} aria-hidden="true" />
        Alle Kurse
      </AppLink>
      <h1 className="break-words text-2xl font-medium tracking-tight">
        {course.name}
      </h1>
      {course.shortName && course.shortName !== course.name && (
        <p className="mt-2 text-sm text-text-muted">{course.shortName}</p>
      )}
      <div className="mt-8">
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
          sections.map((section, index) => (
            <section
              key={section.id}
              aria-labelledby={`section-${section.id}`}
              className="border-t border-border py-6"
            >
              <h2
                id={`section-${section.id}`}
                className="text-base font-medium"
              >
                {section.name || `Abschnitt ${index + 1}`}
              </h2>
              {section.summary && (
                <p className="mt-2 whitespace-pre-line text-sm leading-6 text-text-muted">
                  {section.summary}
                </p>
              )}
              {section.modules.length === 0 ? (
                <p className="mt-3 text-sm text-text-muted">
                  Noch keine Materialien.
                </p>
              ) : (
                <ul className="mt-4 space-y-6">
                  {section.modules.map((module) => {
                    const url = safeWebUrl(module.url);
                    const description = module.description;
                    return (
                      <li key={module.id}>
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="group inline-flex max-w-full items-start gap-2 rounded-sm text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus-ring"
                          >
                            <span className="min-w-0 break-words">
                              {module.name}
                            </span>
                            <ArrowUpRight
                              size={16}
                              className="mt-0.5 shrink-0 text-text-muted"
                              aria-hidden="true"
                            />
                            <span className="sr-only"> – in Moodle öffnen</span>
                          </a>
                        ) : (
                          <p className="break-words text-sm font-medium">
                            {module.name}
                          </p>
                        )}
                        {description && (
                          <p className="mt-2 whitespace-pre-line text-sm leading-6 text-text-muted">
                            {description}
                          </p>
                        )}
                        {module.resources.length > 0 && (
                          <ul className="mt-3 space-y-2">
                            {module.resources.map((resource, resourceIndex) => (
                              <li
                                key={`${resource.name}-${resourceIndex}`}
                                className="flex items-start gap-2 text-xs leading-5 text-text-muted"
                              >
                                <FileText
                                  size={14}
                                  className="mt-0.5 shrink-0"
                                  aria-hidden="true"
                                />
                                <span className="min-w-0 break-words">
                                  {resource.name}
                                </span>
                                {formatFileSize(resource.size) && (
                                  <span className="ml-auto shrink-0">
                                    {formatFileSize(resource.size)}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
