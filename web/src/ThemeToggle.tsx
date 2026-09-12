import { useEffect, useState } from "react";
import { Button } from "@dotnaos/ui-base";
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
  const label =
    theme === "dark" ? "Hellen Modus aktivieren" : "Dunklen Modus aktivieren";
  return (
    <Button
      variant="icon"
      size="sm"
      icon="palette"
      accessibilityLabel={label}
      title={label}
      pressed={theme === "dark"}
      onPress={() => {
        const next = theme === "dark" ? "light" : "dark";
        try {
          localStorage.setItem(themeKey, next);
        } catch {
          /* Keep in-memory choice. */
        }
        setTheme(next);
      }}
    />
  );
}
