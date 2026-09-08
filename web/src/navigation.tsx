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
};
export function parseRoute(path: string): Route {
  if (path === "/") return { page: "home" };
  if (["/courses", "/sources", "/settings", "/moodle-return"].includes(path))
    return { page: path.slice(1) as Route["page"] };
  const match = /^\/courses\/([1-9][0-9]*)\/?$/.exec(path);
  if (match && Number.isSafeInteger(Number(match[1])))
    return { page: "courses", courseId: Number(match[1]) };
  return { page: "not-found" };
}
export type Navigate = (path: string, replace?: boolean) => void;
export function useRoute() {
  const [route, setRoute] = useState(() =>
    parseRoute(window.location.pathname),
  );
  const navigate = useCallback<Navigate>((path, replace = false) => {
    window.history[replace ? "replaceState" : "pushState"](null, "", path);
    setRoute(parseRoute(window.location.pathname));
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    const changed = () => setRoute(parseRoute(window.location.pathname));
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
