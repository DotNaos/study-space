import type { ReactNode } from "react";
import { AppLink, activityPath, type Navigate } from "./navigation";
import { Icon, type IconName } from "@dotnaos/ui-base";
import { safeWebUrl, type CourseModule, type CourseResource } from "./api";
import {
  cleanCourseText,
  duplicateResourceName,
  formatFileSize,
  visibleModule,
  visibleResources,
} from "./course-content";
import {
  maxPreviewBytes,
  resourceAction,
  type ResourceAction,
  type ResourcePreview,
} from "./resource-preview";

type ActivityAction = ResourceAction | { kind: "activity"; href: string };

function activityIcon(type: string): IconName {
  switch (type) {
    case "folder":
      return "folder-open";
    case "url":
      return "globe";
    case "quiz":
      return "list";
    case "assign":
      return "clipboard";
    case "forum":
      return "message-circle";
    case "resource":
      return "file-text";
    case "video":
    case "hvp":
      return "app-window";
    default:
      return "layers";
  }
}
const rowClass =
  "group flex min-h-11 w-full cursor-pointer items-start gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-bg-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
function RowAction({
  action,
  label,
  children,
  onPreview,
  navigate,
}: {
  action: ActivityAction;
  label: string;
  children: ReactNode;
  onPreview?: (preview: ResourcePreview) => void;
  navigate?: Navigate;
}) {
  if (action.kind === "activity" && navigate)
    return (
      <AppLink navigate={navigate} href={action.href} className={rowClass}
        aria-label={`${label} – in Study Space öffnen`}>
        {children}
      </AppLink>
    );
  if (action.kind === "preview")
    return (
      <button
        type="button"
        className={rowClass}
        aria-label={`${label} – Vorschau öffnen`}
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          onPreview?.(action.preview);
        }}
      >
        {children}
      </button>
    );
  if (action.kind === "download")
    return (
      <a
        href={action.href}
        download
        className={rowClass}
        aria-label={`${label} – herunterladen`}
      >
        {children}
      </a>
    );
  if (action.kind === "moodle")
    return (
      <a
        href={action.href}
        target="_blank"
        rel="noopener noreferrer"
        className={rowClass}
        aria-label={`${label} – in Moodle öffnen`}
      >
        {children}
      </a>
    );
  return (
    <div
      className={rowClass
        .replace("cursor-pointer", "")
        .replace("hover:bg-bg-1", "")}
    >
      {children}
    </div>
  );
}
function ActionIcon({ action }: { action: ActivityAction }) {
  const icon: IconName | undefined =
    action.kind === "activity"
      ? "chevron-right"
      : action.kind === "preview"
        ? "maximize"
      : action.kind === "download"
        ? "download"
        : action.kind === "moodle"
          ? "external-link"
          : undefined;
  return icon ? (
    <Icon
      name={icon}
      size="s"
      color="muted"
      className="mt-0.5 ml-auto shrink-0"
    />
  ) : null;
}
function ResourceMeta({
  resource,
  showName,
  action,
}: {
  resource: CourseResource;
  showName: boolean;
  action: ActivityAction;
}) {
  const extension =
    resource.name.match(/\.([a-z0-9]{1,6})$/i)?.[1].toUpperCase() || "Datei";
  const size =
    resource.size !== null && resource.size > 0
      ? formatFileSize(resource.size)
      : undefined;
  return (
    <span className="mt-0.5 block break-words text-xs leading-5 text-text-muted">
      {showName ? cleanCourseText(resource.name) : extension}
      {size && ` · ${size}`}
      {action.kind === "download" && " · Download"}
      {resource.size !== null &&
        resource.size > maxPreviewBytes &&
        " · über 32 MB, in Moodle öffnen"}
    </span>
  );
}

export function CourseActivities({
  courseId,
  modules,
  onPreview,
  navigate,
}: {
  courseId: number;
  modules: CourseModule[];
  onPreview?: (preview: ResourcePreview) => void;
  navigate?: Navigate;
}) {
  const visible = modules.filter(visibleModule);
  if (!visible.length)
    return (
      <p className="py-2 text-sm text-text-muted">Noch keine Materialien.</p>
    );
  return (
    <ul className="-mx-2 divide-y divide-border/60">
      {visible.map((module) => {
        const url = safeWebUrl(module.url);
        const name = cleanCourseText(module.name);
        const description = cleanCourseText(module.description);
        const resources = visibleResources(module);
        const moduleIcon = activityIcon(module.type);
        if (module.type === "label" && resources.length === 0)
          return (
            <li key={module.id} className="px-2 py-2.5">
              {name && (
                <p className="break-words text-sm font-medium">{name}</p>
              )}
              {description && description !== name && (
                <p className="mt-0.5 whitespace-pre-line break-words text-sm leading-5 text-text-muted">
                  {description}
                </p>
              )}
            </li>
          );
        const single =
          module.type === "resource" && resources.length === 1
            ? resources[0]
            : undefined;
        const action: ActivityAction = navigate
          ? { kind: "activity", href: activityPath(courseId, module.id) }
          : single
          ? resourceAction(courseId, module, single)
          : url
            ? { kind: "moodle", href: url }
            : { kind: "none" };
        const label = name || single?.name || "Aktivität";
        return (
          <li key={module.id}>
            <RowAction action={action} label={label} onPreview={onPreview} navigate={navigate}>
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center text-text-muted">
                {single ? <Icon.File filename={single.name} size={22} /> : <Icon name={moduleIcon} size="m" color="muted" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm font-medium leading-5 group-hover:text-accent">
                  {label}
                </span>
                {description && description !== name && (
                  <span className="mt-0.5 block whitespace-pre-line break-words text-sm leading-5 text-text-muted">
                    {description}
                  </span>
                )}
                {single && (
                  <ResourceMeta
                    resource={single}
                    showName={!duplicateResourceName(label, single.name)}
                    action={action}
                  />
                )}
              </span>
              <ActionIcon action={action} />
            </RowAction>
            {!single && resources.length > 0 && (
              <ul className="mb-1 ml-8">
                {resources.map((resource, index) => {
                  const fileAction: ActivityAction = navigate && resource.id
                    ? { kind: "activity", href: activityPath(courseId, module.id, resource.id) }
                    : resourceAction(courseId, module, resource);
                  return (
                    <li key={resource.id || `${resource.name}-${index}`}>
                      <RowAction
                        action={fileAction}
                        label={resource.name}
                        onPreview={onPreview}
                        navigate={navigate}
                      >
                        <Icon.File filename={resource.name} size={20} className="mt-0.5 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block break-words text-sm leading-5 group-hover:text-accent">
                            {cleanCourseText(resource.name)}
                          </span>
                          <ResourceMeta
                            resource={resource}
                            showName={false}
                            action={fileAction}
                          />
                        </span>
                        <ActionIcon action={fileAction} />
                      </RowAction>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
