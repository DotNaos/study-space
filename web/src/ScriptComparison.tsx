import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Select } from "@dotnaos/ui-base";
import { api, message } from "./api";
import type { LearningVersion, SourceRef } from "./learning-api";
import {
  materialDocumentPath,
  type MaterialDocument,
  type MaterialBlock,
} from "./material-api";
import { SafeMarkdown } from "./SafeMarkdown";
import { ComparisonSource } from "./ComparisonSource";
import {
  buildScriptMapping,
  mappingLabels,
  referenceKey,
  scriptRanges,
  sectionReferences,
  sourceKey,
  type ScriptRange,
} from "./script-provenance";
import { Loading, Notice } from "./shared";
import "./script-comparison.css";

export function comparisonLocation(hash: string) {
  const match = /^#compare\/([^/]+)(?:\/(\d+))?$/.exec(hash);
  try {
    return match
      ? {
          sectionId: decodeURIComponent(match[1]),
          start: match[2] ? Number(match[2]) : undefined,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

export function ScriptComparison({
  version,
  initialSectionId,
}: {
  version: LearningVersion;
  initialSectionId?: string | null;
}) {
  const initial =
    typeof window === "undefined"
      ? undefined
      : comparisonLocation(window.location.hash);
  const [chapterId, setChapterId] = useState(
    initialSectionId || initial?.sectionId || version.sections[0]?.id,
  );
  const chapter =
    version.sections.find((section) => section.id === chapterId) ??
    version.sections[0];
  const mapping = useMemo(() => buildScriptMapping(version), [version]);
  const ranges = useMemo(
    () => (chapter ? scriptRanges(chapter) : []),
    [chapter],
  );
  const [rangeId, setRangeId] = useState<string | undefined>(
    () => ranges.find((range) => range.start === initial?.start)?.id,
  );
  const activeRange = ranges.find((range) => range.id === rangeId);
  const sources = useMemo(() => {
    const names = new Map(
      version.sources.map((source) => [sourceKey(source), source]),
    );
    for (const section of version.sections)
      for (const ref of sectionReferences(section))
        if (!names.has(sourceKey(ref)))
          names.set(sourceKey(ref), { ...ref, name: "Gespeicherte Quelle" });
    return [...names.values()];
  }, [version]);
  const initialSource =
    activeRange?.sources[0] ??
    (chapter ? sectionReferences(chapter)[0] : undefined);
  const [sourceId, setSourceId] = useState(() =>
    initialSource
      ? sourceKey(initialSource)
      : sources[0]
        ? sourceKey(sources[0])
        : "",
  );
  const chosenSource = sources.find((source) => sourceKey(source) === sourceId);
  const [page, setPage] = useState<number | null>(
    () => initialSource?.page ?? null,
  );
  const [doc, setDoc] = useState<MaterialDocument>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [sourceBlock, setSourceBlock] = useState<MaterialBlock>();
  const [openOnly, setOpenOnly] = useState(false);
  const [mobilePane, setMobilePane] = useState<"source" | "script">("script");
  const textPane = useRef<HTMLDivElement>(null);
  const sourcePane = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<string, MaterialDocument>());
  const currentDocument = doc && sourceKey(doc) === sourceId ? doc : undefined;
  useEffect(() => {
    setDoc(undefined);
    setError("");
    setSourceBlock(undefined);
    if (!chosenSource) return;
    const path = materialDocumentPath(
      chosenSource.materialId,
      chosenSource.revision,
    );
    if (!path) {
      setError("Diese Quellenrevision ist ungültig.");
      return;
    }
    const cached = cache.current.get(sourceId);
    if (cached) {
      setDoc(cached);
      return;
    }
    const controller = new AbortController();
    void api<MaterialDocument>(path, { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return;
        if (
          sourceKey(value) !== sourceId ||
          !Array.isArray(value.blocks) ||
          !Array.isArray(value.assets)
        )
          throw new Error(
            "Die geladene Quelle entspricht nicht der gespeicherten Revision.",
          );
        cache.current.set(sourceId, value);
        if (cache.current.size > 5)
          cache.current.delete(cache.current.keys().next().value!);
        setDoc(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error));
      });
    return () => controller.abort();
  }, [sourceId, chosenSource, attempt]);
  const pages = useMemo(
    () =>
      currentDocument
        ? [
            ...new Set([
              ...currentDocument.blocks.map(
                (block) => block.page ?? block.slide,
              ),
              ...currentDocument.assets
                .filter((asset) => asset.kind === "page-image")
                .map((asset) => asset.page ?? asset.slide),
            ]),
          ].sort((a, b) => (a ?? 0) - (b ?? 0))
        : [],
    [currentDocument],
  );
  const visiblePage = pages.includes(page) ? page : (pages[0] ?? null);
  const pageIndex = pages.indexOf(visiblePage);
  const selectedRefs =
    activeRange?.sources.filter((ref) => sourceKey(ref) === sourceId) ?? [];
  const selectedBlocks = new Set(
    selectedRefs
      .filter((ref) => ref.page === visiblePage)
      .map((ref) => ref.blockId),
  );
  const linkedBlocks = useMemo(
    () =>
      new Set(
        currentDocument?.blocks
          .filter((block) =>
            mapping.reverse.has(
              referenceKey({
                materialId: currentDocument.materialId,
                revision: currentDocument.revision,
                blockId: block.id,
                page: block.page ?? block.slide,
              }),
            ),
          )
          .map((block) => block.id) ?? [],
      ),
    [mapping, currentDocument],
  );
  const sourceRef =
    sourceBlock && currentDocument
      ? {
          materialId: currentDocument.materialId,
          revision: currentDocument.revision,
          blockId: sourceBlock.id,
          page: sourceBlock.page ?? sourceBlock.slide,
        }
      : undefined;
  const destinations = sourceRef
    ? (mapping.reverse.get(referenceKey(sourceRef)) ?? [])
    : [];
  const coarseDestinations = sourceRef
    ? version.sections.filter((section) =>
        section.sources.some(
          (ref) => referenceKey(ref) === referenceKey(sourceRef),
        ),
      )
    : [];
  const missingRefs = currentDocument
    ? selectedRefs.filter(
        (ref) =>
          !currentDocument.blocks.some(
            (block) =>
              block.id === ref.blockId &&
              (block.page ?? block.slide) === ref.page,
          ),
      )
    : [];
  const openRanges = mapping.ranges.filter((range) => range.state !== "source");

  function location(sectionId: string, start?: number) {
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#compare/${encodeURIComponent(sectionId)}${start === undefined ? "" : `/${start}`}`,
    );
  }
  function goToSource(ref: SourceRef) {
    setSourceId(sourceKey(ref));
    setPage(ref.page);
  }
  function chooseChapter(id: string) {
    setChapterId(id);
    setRangeId(undefined);
    setSourceBlock(undefined);
    location(id);
    const section = version.sections.find((item) => item.id === id);
    const first = section && sectionReferences(section)[0];
    if (first) goToSource(first);
    textPane.current?.scrollTo({ top: 0 });
  }
  function chooseRange(range: ScriptRange, followSource = true) {
    setChapterId(range.sectionId);
    setRangeId(range.id);
    location(range.sectionId, range.start);
    if (followSource) {
      setSourceBlock(undefined);
      if (range.sources[0]) goToSource(range.sources[0]);
    }
  }
  function chooseBlock(block: MaterialBlock) {
    setSourceBlock(block);
    if (!currentDocument) return;
    const first = mapping.reverse.get(
      referenceKey({
        materialId: currentDocument.materialId,
        revision: currentDocument.revision,
        blockId: block.id,
        page: block.page ?? block.slide,
      }),
    )?.[0];
    if (first) chooseRange(first, false);
    else setRangeId(undefined);
  }
  useEffect(() => {
    if (!rangeId) return;
    const frame = requestAnimationFrame(() => {
      const mark = [
        ...(textPane.current?.querySelectorAll<HTMLElement>("[data-map-id]") ??
          []),
      ].find((node) => node.dataset.mapId === rangeId);
      if (mark && textPane.current)
        textPane.current.scrollTop +=
          mark.getBoundingClientRect().top -
          textPane.current.getBoundingClientRect().top -
          24;
    });
    return () => cancelAnimationFrame(frame);
  }, [rangeId, chapter?.id]);
  useEffect(() => {
    sourcePane.current?.scrollTo({ top: 0 });
  }, [sourceId, visiblePage]);
  function selectMark(target: EventTarget | null) {
    const mark =
      target instanceof Element
        ? target.closest<HTMLElement>("[data-map-id]")
        : null;
    const range = ranges.find((item) => item.id === mark?.dataset.mapId);
    if (range) chooseRange(range);
  }
  function nextOpen() {
    if (!openRanges.length) return;
    const index = openRanges.findIndex((range) => range.id === rangeId);
    chooseRange(openRanges[(index + 1) % openRanges.length]);
    setMobilePane("script");
  }
  if (!chapter) return <p>Kein Skript vorhanden.</p>;
  return (
    <section
      className={`script-comparison${openOnly ? " show-open" : ""}`}
      aria-label="Quellenvergleich"
    >
      <div className="comparison-toolbar">
        <p>Original und Skript · gespeicherte Quellenfassung</p>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            label="Nur offene Zuordnungen"
            pressed={openOnly}
            onPress={() => setOpenOnly((value) => !value)}
          />
          {openOnly && (
            <Button
              size="sm"
              variant="ghost"
              label="Nächste offene Stelle"
              disabled={!openRanges.length}
              onPress={nextOpen}
            />
          )}
        </div>
      </div>
      <div
        className="comparison-mobile-tabs"
        role="group"
        aria-label="Vergleichsspalte"
      >
        <Button
          size="sm"
          variant="ghost"
          label="Quelle"
          pressed={mobilePane === "source"}
          onPress={() => setMobilePane("source")}
        />
        <Button
          size="sm"
          variant="ghost"
          label="Skript"
          pressed={mobilePane === "script"}
          onPress={() => setMobilePane("script")}
        />
      </div>
      <div className="comparison-columns" data-mobile-pane={mobilePane}>
        <section
          className="comparison-column comparison-source"
          aria-label="Originalquelle"
        >
          <header>
            <Select
              accessibilityLabel="Quelldokument"
              value={sourceId}
              options={sources.map((source) => ({
                value: sourceKey(source),
                label: source.name,
              }))}
              size="sm"
              onValueChange={(id) => {
                setSourceId(id);
                setPage(null);
                setSourceBlock(undefined);
              }}
            />
            <div className="comparison-page-controls">
              <Button
                size="sm"
                variant="icon"
                icon="chevron-left"
                accessibilityLabel="Vorherige Quellenseite"
                disabled={pageIndex <= 0}
                onPress={() => {
                  setPage(pages[pageIndex - 1]);
                  setSourceBlock(undefined);
                }}
              />
              {pages.length > 0 && (
                <Select
                  size="sm"
                  accessibilityLabel="Quellenseite"
                  value={String(visiblePage ?? "none")}
                  options={pages.map((p) => ({
                    value: String(p ?? "none"),
                    label: p === null ? "Dokument" : `Seite / Folie ${p}`,
                  }))}
                  onValueChange={(p) => {
                    setPage(p === "none" ? null : Number(p));
                    setSourceBlock(undefined);
                  }}
                />
              )}
              <Button
                size="sm"
                variant="icon"
                icon="chevron-right"
                accessibilityLabel="Nächste Quellenseite"
                disabled={pageIndex < 0 || pageIndex >= pages.length - 1}
                onPress={() => {
                  setPage(pages[pageIndex + 1]);
                  setSourceBlock(undefined);
                }}
              />
            </div>
          </header>
          <div className="comparison-scroll" ref={sourcePane}>
            {error ? (
              <>
                <Notice>{error}</Notice>
                <Button
                  label="Quelle erneut laden"
                  onPress={() => setAttempt((value) => value + 1)}
                />
              </>
            ) : !chosenSource ? (
              <p>Keine Quelle für diesen Kurs hinterlegt.</p>
            ) : !currentDocument ? (
              <Loading label="Quelle wird geladen …" />
            ) : (
              <ComparisonSource
                key={sourceId}
                document={currentDocument}
                page={visiblePage}
                selectedBlocks={selectedBlocks}
                linkedBlocks={linkedBlocks}
                activeBlock={sourceBlock?.id}
                onSelect={chooseBlock}
                openOnly={openOnly}
              />
            )}
            {!!missingRefs.length && (
              <Notice>
                Die gespeicherte Textzuordnung verweist auf nicht verfügbare
                Ausschnitte. Zuordnung erneut prüfen.
              </Notice>
            )}
          </div>
        </section>
        <section
          className="comparison-column comparison-script"
          aria-label="Skript mit Quellenzuordnungen"
        >
          <header>
            <Select
              accessibilityLabel="Skriptkapitel im Vergleich"
              value={chapter.id}
              options={version.sections.map((section, index) => ({
                value: section.id,
                label: `${index + 1}. ${section.title}`,
              }))}
              size="sm"
              onValueChange={chooseChapter}
            />
          </header>
          <div
            className="comparison-scroll"
            ref={textPane}
            onClick={(event) => selectMark(event.target)}
            onKeyDown={(event) => {
              if (
                (event.key === "Enter" || event.key === " ") &&
                (event.target as Element).closest("[data-map-id]")
              ) {
                event.preventDefault();
                selectMark(event.target);
              }
            }}
          >
            <h3>{chapter.title}</h3>
            {!chapter.provenance && (
              <p className="comparison-notice">
                Für diesen Abschnitt sind keine genauen Textzuordnungen
                gespeichert; vorhandene Quellenverweise gelten nur auf
                Abschnittsebene. Genaue Textzuordnungen sind ungeklärt – die
                Markierungen bedeuten nicht, dass der Text erfunden ist.
              </p>
            )}
            {chapter.provenance?.status === "stale" && (
              <p className="comparison-notice">
                Der Text wurde seit dieser Zuordnung geändert. Die bisherigen
                Verweise müssen erneut geprüft werden.
              </p>
            )}
            <SafeMarkdown
              provenance={{
                markdown: chapter.markdown,
                ranges,
                selectedId: rangeId,
              }}
            >
              {chapter.markdown}
            </SafeMarkdown>
          </div>
        </section>
      </div>
      <div className="comparison-selection" aria-live="polite">
        {sourceBlock ? (
          <>
            <strong>
              {destinations.length
                ? `${destinations.length} genaue Textzuordnung(en)`
                : "Keine genaue Textzuordnung für diesen Quellausschnitt"}
            </strong>
            {!destinations.length && (
              <p>
                {coarseDestinations.length
                  ? "Nur Abschnittsbezüge vorhanden. Ob der Inhalt übernommen wurde, ist nicht textgenau dokumentiert."
                  : "Kein Ziel gespeichert. Ob bewusst ausgelassen oder verloren gegangen, ist ungeklärt."}
              </p>
            )}
            <div className="comparison-destinations">
              {destinations.map((range) => (
                <Button
                  key={range.id}
                  size="sm"
                  variant="ghost"
                  label={
                    version.sections.find(
                      (section) => section.id === range.sectionId,
                    )?.title || "Skriptstelle"
                  }
                  onPress={() => {
                    chooseRange(range, false);
                    setMobilePane("script");
                  }}
                />
              ))}
              {!destinations.length &&
                coarseDestinations.map((section) => (
                  <Button
                    key={section.id}
                    size="sm"
                    variant="ghost"
                    label={`Abschnittsbezug: ${section.title}`}
                    onPress={() => {
                      setChapterId(section.id);
                      setRangeId(undefined);
                      setMobilePane("script");
                    }}
                  />
                ))}
            </div>
          </>
        ) : activeRange ? (
          <>
            <strong>{mappingLabels[activeRange.state]}</strong>
            <p>
              {activeRange.state === "source"
                ? activeRange.reviewed
                  ? "Als geprüft gespeichert. Quellenstellen sind links markiert."
                  : "Textstelle zugeordnet, inhaltliche Übereinstimmung und Vollständigkeit noch nicht geprüft."
                : activeRange.state === "unknown"
                  ? "Für diese Textstelle ist keine genaue Herkunft gespeichert. Links bleibt der Quellenkontext des Abschnitts sichtbar, kein Beleg für diesen Text."
                  : activeRange.state === "stale"
                    ? "Der frühere Verweis gilt nicht automatisch für die geänderte Textstelle."
                    : "Diese Ergänzung hat bewusst keinen Folienbezug."}
            </p>
            <div className="comparison-destinations">
              {[
                ...new Map(
                  activeRange.sources.map((ref) => [
                    `${sourceKey(ref)}:${ref.page}`,
                    ref,
                  ]),
                ).values(),
              ].map((ref) => (
                <Button
                  key={referenceKey(ref)}
                  variant="ghost"
                  size="sm"
                  label={`${sources.find((source) => sourceKey(source) === sourceKey(ref))?.name || "Quelle"}${ref.page === null ? "" : ` · S. ${ref.page}`}`}
                  onPress={() => {
                    goToSource(ref);
                    setMobilePane("source");
                  }}
                />
              ))}
            </div>
          </>
        ) : (
          <p>
            Text rechts oder Ausschnitt links auswählen. Eine Zuordnung ist kein
            Nachweis vollständiger Übernahme.
          </p>
        )}
      </div>
    </section>
  );
}
