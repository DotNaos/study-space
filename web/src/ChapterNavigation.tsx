import { useEffect, useId, useRef, useState } from "react";
import { Button, Input } from "@dotnaos/ui-base";
import { SidebarItem } from "@dotnaos/ui/layout";
import type { LearningVersion } from "./learning-api";

type Chapter = LearningVersion["sections"][number];

export function matchingChapters(sections: Chapter[], query: string) {
  const terms = query.trim().toLocaleLowerCase("de").split(/\s+/).filter(Boolean);
  return sections
    .map((section, index) => ({ section, number: index + 1 }))
    .filter(({ section, number }) => {
      const text = `${number} ${section.title}`.toLocaleLowerCase("de");
      return terms.every((term) => text.includes(term));
    });
}

export function ChapterNavigation({
  sections,
  currentSectionId,
  onSelect,
}: {
  sections: Chapter[];
  currentSectionId: string | null;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const panelId = useId();
  const currentIndex = Math.max(0, sections.findIndex((section) => section.id === currentSectionId));
  const chapters = matchingChapters(sections, query);

  useEffect(() => {
    const container = list.current;
    if (!container || query.trim() || container.contains(document.activeElement)) return;
    const item = Array.from(container.children).find(
      (child) => child.getAttribute("data-chapter-id") === currentSectionId,
    );
    if (!(item instanceof HTMLElement) || !container.clientHeight) return;
    const bounds = container.getBoundingClientRect();
    const target = item.getBoundingClientRect();
    // Scroll only the chapter list, never the document being read.
    if (target.top < bounds.top || target.bottom > bounds.bottom)
      container.scrollTop += target.top - bounds.top - (container.clientHeight - target.height) / 2;
  }, [currentSectionId, query, expanded]);

  if (sections.length < 2) return null;
  function select(id: string) {
    setExpanded(false);
    setQuery("");
    onSelect(id);
  }
  const position = `${currentIndex + 1} / ${sections.length}`;
  return (
    <nav
      aria-label="Kapitel im Lernskript"
      className="sticky top-3 z-20 min-w-0 self-start rounded-lg border border-border bg-bg-0 p-2 lg:col-start-2 lg:row-start-1 lg:top-6 lg:z-auto lg:rounded-none lg:border-0 lg:p-0"
    >
      <div className="flex min-w-0 items-center gap-2 lg:hidden">
        <Button
          size="sm"
          variant="ghost"
          icon="list"
          iconAfter={expanded ? "chevron-up" : "chevron-down"}
          label={`Kapitel ${position}`}
          accessibilityLabel="Kapitelübersicht"
          controls={panelId}
          expanded={expanded}
          onPress={() => setExpanded((value) => !value)}
        />
        <span className="min-w-0 flex-1 truncate text-xs text-text-muted" title={sections[currentIndex]?.title}>
          {sections[currentIndex]?.title}
        </span>
      </div>
      <div className="mb-3 hidden items-baseline justify-between gap-2 lg:flex">
        <h3 className="text-sm font-medium">Kapitel</h3>
        <span className="text-xs tabular-nums text-text-muted" aria-label={`Aktuelles Kapitel ${currentIndex + 1} von ${sections.length}`}>
          {position}
        </span>
      </div>
      <div
        id={panelId}
        className={`${expanded ? "flex" : "hidden"} absolute inset-x-0 top-full mt-2 flex-col gap-3 rounded-lg border border-border bg-bg-0 p-3 shadow-lg lg:static lg:mt-0 lg:flex lg:rounded-none lg:border-0 lg:p-0 lg:shadow-none`}
      >
        {sections.length > 6 && (
          <Input
            type="search"
            size="sm"
            fullWidth
            accessibilityLabel="Kapitel suchen"
            placeholder="Kapitel oder Nummer …"
            value={query}
            onValueChange={setQuery}
          />
        )}
        {query.trim() && (
          <p role="status" className="text-xs text-text-muted">
            {chapters.length ? `${chapters.length} von ${sections.length} Kapiteln` : "Keine passenden Kapitel."}
          </p>
        )}
        <ol
          ref={list}
          className="max-h-[min(60dvh,28rem)] space-y-1 overflow-y-auto overscroll-contain border-l border-border pl-2 pr-1 lg:max-h-[calc(100dvh-10rem)]"
        >
          {chapters.map(({ section, number }) => (
            <li key={section.id} data-chapter-id={section.id} title={`${number}. ${section.title}`} className="relative">
              {section.id === currentSectionId && (
                <span aria-hidden="true" className="absolute -left-2.5 top-2.5 h-4 w-1 rounded-full bg-accent" />
              )}
              <SidebarItem
                customize={{
                  reason: "Compact, multiline chapter labels in a narrow reading rail.",
                  className: "[&>span]:whitespace-normal [&>span]:overflow-visible [&>span]:text-clip",
                  style: {
                    padding: "0.5rem",
                    minHeight: "2.25rem",
                    borderRadius: "0.375rem",
                    justifyContent: "flex-start",
                    textAlign: "left",
                  },
                }}
                action={`chapter-${section.id}`}
                label={`${number}. ${section.title}`}
                active={section.id === currentSectionId}
                onSelect={() => select(section.id)}
              />
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}
