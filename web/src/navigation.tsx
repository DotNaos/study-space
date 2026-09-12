import {
  useCallback,
  useEffect,
  useState,
  type AnchorHTMLAttributes,
} from "react";

export type Route = {
  page:
    | "home"
    | "courses"
    | "sources"
    | "settings"
    | "moodle-return"
    | "not-found";
  courseId?: number;
  moduleId?: number;
  resourceId?: string;
};
const resourceIdPattern = /^[a-f0-9]{64}$/;
export function activityPath(courseId: number, moduleId: number, resourceId?: string): string {
  if (![courseId, moduleId].every((id) => Number.isSafeInteger(id) && id > 0) ||
      (resourceId !== undefined && !resourceIdPattern.test(resourceId)))
    throw new Error("Ungültiger Aktivitätslink.");
  return `/courses/${courseId}/activities/${moduleId}` +
    (resourceId === undefined ? "" : `?resource=${resourceId}`);
}
export function parseRoute(path: string, search = ""): Route {
  if (path === "/") return { page: "home" };
  if (["/courses", "/sources", "/settings", "/moodle-return"].includes(path))
    return { page: path.slice(1) as Route["page"] };
  const match = /^\/courses\/([1-9][0-9]*)\/?$/.exec(path);
  if (match && Number.isSafeInteger(Number(match[1])))
    return { page: "courses", courseId: Number(match[1]) };
  const activity = /^\/courses\/([1-9][0-9]*)\/activities\/([1-9][0-9]*)\/?$/.exec(path);
  if (activity && Number.isSafeInteger(Number(activity[1])) && Number.isSafeInteger(Number(activity[2]))) {
    const resources = new URLSearchParams(search).getAll("resource");
    if (resources.length > 1 || (resources.length === 1 && !resourceIdPattern.test(resources[0])))
      return { page: "not-found" };
    return {
      page: "courses", courseId: Number(activity[1]), moduleId: Number(activity[2]),
      ...(resources.length ? { resourceId: resources[0] } : {}),
    };
  }
  return { page: "not-found" };
}
export type Navigate = (path: string, replace?: boolean) => void;
export function useRoute() {
  const [route, setRoute] = useState(() =>
    parseRoute(window.location.pathname, window.location.search),
  );
  const navigate = useCallback<Navigate>((path, replace = false) => {
    window.history[replace ? "replaceState" : "pushState"](null, "", path);
    setRoute(parseRoute(window.location.pathname, window.location.search));
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    const changed = () => setRoute(parseRoute(window.location.pathname, window.location.search));
    window.addEventListener("popstate", changed);
    return () => window.removeEventListener("popstate", changed);
  }, []);
  return { route, navigate };
}
export function AppLink({
  navigate,
  href,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  navigate: Navigate;
  href: string;
}) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        if (
          !event.defaultPrevented &&
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          event.preventDefault();
          navigate(href);
        }
      }}
    />
  );
}
