import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const themeKey = "study-space:theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState(
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    function systemChanged() {
      try {
        if (localStorage.getItem(themeKey)) return;
      } catch {
        /* Use system appearance. */
      }
      setTheme(media.matches ? "dark" : "light");
    }
    media.addEventListener("change", systemChanged);
    return () => media.removeEventListener("change", systemChanged);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#111111" : "#ffffff");
  }, [theme]);

  const label = theme === "dark" ? "Hellen Modus aktivieren" : "Dunklen Modus aktivieren";
  return (
    <button
      type="button"
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-control-hover hover:text-text focus-visible:outline-2 focus-visible:outline-focus-ring"
      aria-label={label}
      title={label}
      onClick={() => {
        const next = theme === "dark" ? "light" : "dark";
        try {
          localStorage.setItem(themeKey, next);
        } catch {
          /* Keep in-memory choice. */
        }
        setTheme(next);
      }}
    >
      {theme === "dark" ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
    </button>
  );
}
