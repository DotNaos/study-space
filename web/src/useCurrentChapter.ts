import { useEffect, useRef, useState } from "react";
import type { LearningVersion } from "./learning-api";

// Matches the script section's scroll-mt-24, including the compact mobile control.
export const chapterReadingOffset = 96;

export function currentChapterIndex(tops: readonly number[], cursor: number): number {
  if (!tops.length) return -1;
  let low = 0;
  let high = tops.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (tops[middle] <= cursor) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function useCurrentChapter(
  sections: LearningVersion["sections"],
  enabled: boolean,
) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [currentSectionId, setCurrentSectionId] = useState<string | null>(sections[0]?.id ?? null);

  useEffect(() => {
    const content = contentRef.current;
    if (!enabled || !content || !sections.length) return;
    const elements = sections.map((section) => document.getElementById(`learning-section-${section.id}`));
    let tops: number[] = [];
    let readingOffset = chapterReadingOffset;
    let frame = 0;
    let dirty = true;
    let disposed = false;
    const update = () => {
      frame = 0;
      if (dirty) {
        tops = elements.map((element) => (element?.getBoundingClientRect().top ?? 0) + window.scrollY);
        const first = elements[0];
        readingOffset = first ? parseFloat(getComputedStyle(first).scrollMarginTop) || chapterReadingOffset : chapterReadingOffset;
        dirty = false;
      }
      // scrollIntoView can round the target by a fractional CSS pixel.
      const index = currentChapterIndex(tops, window.scrollY + readingOffset + 2);
      setCurrentSectionId(sections[index]?.id ?? null);
    };
    const schedule = () => {
      if (!frame && !disposed) frame = requestAnimationFrame(update);
    };
    const measure = () => {
      dirty = true;
      schedule();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    // The outer script header can change height independently (coverage notices,
    // preparation details); observing its course container refreshes offsets too.
    const course = content.closest("[data-learning-course]");
    if (course) observer.observe(course);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", measure);
    void document.fonts?.ready.then(() => { if (!disposed) measure(); });
    schedule();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", measure);
    };
  }, [sections, enabled]);

  return { contentRef, currentSectionId };
}
