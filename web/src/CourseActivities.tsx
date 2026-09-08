import {
  ArrowUpRight,
  FileText,
  FolderOpen,
  Link2,
  ListChecks,
  MessageSquare,
  BookOpen,
  Video,
  ClipboardList,
} from "lucide-react";
import { safeWebUrl, type CourseModule } from "./api";
import {
  cleanCourseText,
  duplicateResourceName,
  formatFileSize,
  visibleModule,
  visibleResources,
} from "./course-content";

function activityIcon(type: string) {
  switch (type) {
    case "folder":
      return FolderOpen;
    case "url":
      return Link2;
    case "quiz":
      return ListChecks;
    case "assign":
      return ClipboardList;
    case "forum":
      return MessageSquare;
    case "resource":
      return FileText;
    case "video":
    case "hvp":
      return Video;
    default:
      return BookOpen;
  }
}

export function CourseActivities({ modules }: { modules: CourseModule[] }) {
  const visible = modules.filter(visibleModule);
  if (!visible.length)
    return (
      <p className="py-3 text-sm text-text-muted">Noch keine Materialien.</p>
    );
  return (
    <ul className="divide-y divide-border/60">
      {visible.map((module) => {
        const url = safeWebUrl(module.url);
        const name = cleanCourseText(module.name);
        const description = cleanCourseText(module.description);
        const resources = visibleResources(module);
        const Icon = activityIcon(module.type);
        if (module.type === "label" && resources.length === 0)
          return (
            <li key={module.id} className="py-4">
              {name && (
                <p className="break-words text-sm font-medium">{name}</p>
              )}
              {description && (
                <p className="mt-1 whitespace-pre-line break-words text-sm leading-6 text-text-muted">
                  {description}
                </p>
              )}
            </li>
          );
        return (
          <li key={module.id} className="flex gap-3 py-4 sm:gap-4">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-bg-1 text-text-muted">
              <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex max-w-full items-start gap-2 rounded-sm text-sm font-medium leading-6 underline-offset-4 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  <span className="min-w-0 break-words">
                    {name || "Aktivität öffnen"}
                  </span>
                  <ArrowUpRight
                    size={15}
                    className="mt-1 shrink-0 text-text-muted"
                    aria-hidden="true"
                  />
                  <span className="sr-only"> – in Moodle öffnen</span>
                </a>
              ) : (
                <p className="break-words text-sm font-medium leading-6">
                  {name || "Aktivität"}
                </p>
              )}
              {description && description !== name && (
                <p className="mt-1 whitespace-pre-line break-words text-sm leading-6 text-text-muted">
                  {description}
                </p>
              )}
              {resources.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {resources.map((resource, index) => {
                    const name = cleanCourseText(resource.name);
                    const size =
                      resource.size !== null && resource.size > 0
                        ? formatFileSize(resource.size)
                        : undefined;
                    const duplicate =
                      resources.length === 1 &&
                      duplicateResourceName(module.name, name);
                    const extension = name
                      .match(/\.([a-z0-9]{1,6})$/i)?.[1]
                      .toUpperCase();
                    return (
                      <li
                        key={`${resource.name}-${index}`}
                        className="flex items-start gap-2 text-xs leading-5 text-text-muted"
                      >
                        {!duplicate && (
                          <FileText
                            size={13}
                            className="mt-1 shrink-0"
                            aria-hidden="true"
                          />
                        )}
                        <span className="min-w-0 break-words">
                          {duplicate ? extension || "Datei" : name}
                        </span>
                        {size && (
                          <span
                            className={`${duplicate ? "" : "ml-auto"} shrink-0 tabular-nums`}
                          >
                            {duplicate && "· "}
                            {size}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
