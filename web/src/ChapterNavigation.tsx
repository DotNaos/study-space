import { useId, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import type { LearningVersion } from "./learning-api";

type Chapter = LearningVersion["sections"][number];

export function matchingChapters(sections: Chapter[], query: string) {
  const terms = query
    .trim()
    .toLocaleLowerCase("de")
    .split(/\s+/)
    .filter(Boolean);
  return sections
    .map((section, index) => ({ section, number: index + 1 }))
    .filter(({ section, number }) => {
      const text = `${number} ${section.title}`.toLocaleLowerCase("de");
      return terms.every((term) => text.includes(term));
    });
}

export function ChapterNavigation({
  sections,
  readingSectionId,
  onSelect,
}: {
  sections: Chapter[];
  readingSectionId: string | null;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const details = useRef<HTMLDetailsElement>(null);
  const searchId = useId();
  if (sections.length < 2) return null;
  const compact = sections.length > 6;
  const chapters = matchingChapters(sections, compact ? query : "");
  function select(id: string) {
    if (details.current) details.current.open = false;
    setQuery("");
    onSelect(id);
  }
  const links = chapters.map(({ section, number }) => (
    <button
      key={section.id}
      type="button"
      onClick={() => select(section.id)}
      aria-current={section.id === readingSectionId ? "location" : undefined}
      className={
        compact
          ? "flex w-full items-baseline gap-3 rounded-md px-2 py-2.5 text-left text-sm leading-5 text-text-muted hover:bg-bg-1 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring aria-[current=location]:text-text"
          : "max-w-full text-left text-xs leading-5 text-text-muted hover:text-text"
      }
    >
      <span
        className={
          compact
            ? "w-7 shrink-0 text-right text-xs text-text-muted/60"
            : "mr-1.5 text-text-muted/60"
        }
      >
        {number}
      </span>
      <span className="min-w-0 break-words">{section.title}</span>
    </button>
  ));
  return (
    <nav
      aria-label="Kapitel im Lernskript"
      className="mb-6 border-b border-border pb-5"
    >
      {compact ? (
        <details ref={details} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm text-text-muted">
            <span>
              Kapitelübersicht{" "}
              <span className="ml-2 text-xs">{sections.length} Kapitel</span>
            </span>
            <ChevronDown size={15} className="shrink-0 group-open:rotate-180" />
          </summary>
          <div className="mt-4">
            <label htmlFor={searchId} className="sr-only">
              Kapitel suchen
            </label>
            <div className="flex items-center gap-2 rounded-md border border-border px-3 focus-within:border-focus-ring focus-within:ring-1 focus-within:ring-focus-ring">
              <Search size={15} className="shrink-0 text-text-muted" />
              <input
                id={searchId}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Kapitel oder Nummer suchen …"
                className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none"
              />
            </div>
            <p role="status" className="my-2 text-xs text-text-muted">
              {chapters.length} von {sections.length} Kapiteln
            </p>
            <div className="max-h-64 overflow-y-auto overscroll-contain">
              {links.length ? (
                links
              ) : (
                <p className="py-3 text-sm text-text-muted">
                  Kein Kapitel gefunden. Probiere einen anderen Begriff.
                </p>
              )}
            </div>
          </div>
        </details>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-2">{links}</div>
      )}
    </nav>
  );
}
