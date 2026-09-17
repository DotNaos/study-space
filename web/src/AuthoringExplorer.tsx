import "./authoring-explorer.css";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@dotnaos/ui-base";
import {
  AlertCircle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Circle,
  LoaderCircle,
  MoreHorizontal,
  PanelLeftClose,
  RefreshCw,
} from "lucide-react";
import { api } from "./api";
import {
  readContentBlock,
  readContentRevision,
  readContentWorkspace,
  type ContentBlockSummary,
  type ContentRevision,
} from "./content-api";
import { unitHidden, unitKind, unitLabel } from "./learning-structure";
import {
  materialDocumentPath,
  type MaterialDocument,
} from "./material-api";
import type {
  PipelineSourceView,
  PipelineState,
  PipelineUnit,
} from "./pipeline-api";
import { sourcePlacement } from "./source-placement";
import type { ContentSelection } from "./ContentAuthoringView";

type HeadingNode = {
  id: string;
  label: string;
  level: number;
  children: HeadingNode[];
};

type SourcePreview = {
  block?: ContentBlockSummary;
  headings: HeadingNode[];
  extraction?: { engine: string; version: string };
};

function cleanHeading(value: string) {
  return value
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\\([#$%&_{}])/g, "$1")
    .trim();
}

function markdownOutline(markdown: string): HeadingNode[] {
  const headings = markdown
    .split(/\r?\n/)
    .flatMap((line, index) => {
      const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line.trim());
      if (!match) return [];
      const label = cleanHeading(match[2]);
      return label
        ? [{ id: `heading-${index}-${label.slice(0, 24)}`, label, level: match[1].length }]
        : [];
    });
  if (!headings.length) return [];

  const base = Math.min(...headings.map((item) => item.level));
  const roots: HeadingNode[] = [];
  const stack: HeadingNode[] = [];
  for (const item of headings) {
    const node: HeadingNode = {
      id: item.id,
      label: item.label,
      level: Math.max(1, item.level - base + 1),
      children: [],
    };
    while (stack.length >= node.level) stack.pop();
    const parent = stack.at(-1);
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

async function rawRevision(courseId: number, block: ContentBlockSummary) {
  if (!block.currentRevisionId) return undefined;
  const view = await readContentBlock(courseId, block.id);
  let revision = view.revision ?? undefined;
  const seen = new Set<string>();
  while (
    revision?.parentRevisionId &&
    !["materialized", "reset"].includes(revision.kind) &&
    !seen.has(revision.id)
  ) {
    seen.add(revision.id);
    revision = await readContentRevision(
      courseId,
      block.id,
      revision.parentRevisionId,
    );
  }
  return revision;
}

function taskOwner(units: PipelineUnit[], task: PipelineUnit) {
  const scripts = units
    .filter((unit) => unitKind(unit) === "script" && !unitHidden(unit, units))
    .sort((a, b) => a.order - b.order);
  return scripts.find((script) => (task.scriptUnitIds ?? []).includes(script.id));
}

function HeadingTree({
  nodes,
  depth = 0,
  onSelect,
}: {
  nodes: HeadingNode[];
  depth?: number;
  onSelect: () => void;
}) {
  if (!nodes.length) return null;
  return (
    <ul className="authoring-explorer-headings" data-depth={depth}>
      {nodes.map((node) => (
        <li key={node.id}>
          <button type="button" onClick={onSelect} title={node.label}>
            {node.children.length ? (
              <ChevronDown size={12} aria-hidden="true" />
            ) : (
              <span className="authoring-explorer-heading-spacer" />
            )}
            <span>{node.label}</span>
          </button>
          <HeadingTree nodes={node.children} depth={depth + 1} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}

function ExtractionMark({
  item,
  preview,
}: {
  item: PipelineSourceView;
  preview?: SourcePreview;
}) {
  const hasExtraction = !!item.source.materialRevision;
  const problem = !!item.source.problem || item.source.warnings.length > 0;
  const metadata = preview?.extraction;
  const title = problem
    ? ["Extraction issue", item.source.problem, ...item.source.warnings]
        .filter(Boolean)
        .join(" · ")
    : hasExtraction
      ? ["Extracted", metadata?.engine, metadata?.version]
          .filter(Boolean)
          .join(" · ")
      : "No extraction";

  if (problem)
    return (
      <span className="authoring-extraction-mark" data-state="issue" title={title}>
        <AlertCircle size={13} />
      </span>
    );
  if (hasExtraction)
    return (
      <span className="authoring-extraction-mark" data-state="ready" title={title}>
        <span className="authoring-extraction-dot" />
      </span>
    );
  return (
    <span className="authoring-extraction-mark" data-state="empty" title={title}>
      <Circle size={11} />
    </span>
  );
}

function SourceCard({
  item,
  preview,
  selected,
  compact = false,
  onSelect,
}: {
  item: PipelineSourceView;
  preview?: SourcePreview;
  selected: boolean;
  compact?: boolean;
  onSelect: () => void;
}) {
  const [open, setOpen] = useState(true);
  const metadata = preview?.extraction;
  return (
    <article
      className="authoring-source-card"
      data-selected={selected || undefined}
      data-compact={compact || undefined}
      draggable
    >
      <div className="authoring-source-card-head">
        {!compact ? (
          <button
            type="button"
            className="authoring-source-disclosure"
            aria-label={open ? "Datei einklappen" : "Datei aufklappen"}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="authoring-source-disclosure-spacer" />
        )}
        <button type="button" className="authoring-source-open" onClick={onSelect} title={item.source.name}>
          <Icon.File filename={item.source.name} size={15} />
          <span>{item.source.name}</span>
        </button>
        <ExtractionMark item={item} preview={preview} />
        <details className="authoring-source-menu">
          <summary aria-label={`Aktionen für ${item.source.name}`} title="Aktionen">
            <MoreHorizontal size={14} />
          </summary>
          <div>
            <button type="button" onClick={onSelect}>Open</button>
          </div>
        </details>
      </div>
      {!compact && open && (
        <div className="authoring-source-card-body">
          {item.source.materialRevision && metadata && (
            <div className="authoring-source-extraction-meta">
              <span>{metadata.version || metadata.engine}</span>
            </div>
          )}
          {preview?.headings.length ? (
            <HeadingTree nodes={preview.headings} onSelect={onSelect} />
          ) : (
            <button type="button" className="authoring-source-empty-outline" onClick={onSelect}>
              {item.source.materialRevision ? "No headings found" : "Not extracted"}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export function AuthoringExplorer({
  courseId,
  state,
  selection,
  refreshing,
  onRefresh,
  onSelectScript,
  onSelectUnit,
  onSelectSource,
  onCollapse,
}: {
  courseId: number;
  state: PipelineState;
  selection: ContentSelection;
  refreshing: boolean;
  onRefresh: () => void;
  onSelectScript: () => void;
  onSelectUnit: (unit: PipelineUnit) => void;
  onSelectSource: (item: PipelineSourceView, unitId?: string) => void;
  onCollapse: () => void;
}) {
  const [previews, setPreviews] = useState<Record<string, SourcePreview>>({});

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const workspace = await readContentWorkspace(courseId, controller.signal);
        const blocksBySource = new Map<string, ContentBlockSummary>();
        for (const block of workspace.blocks) {
          if (block.included && !blocksBySource.has(block.sourceId)) blocksBySource.set(block.sourceId, block);
        }

        const next = await Promise.all(
          state.sources
            .filter((item) => item.source.present)
            .map(async (item) => {
              const block = blocksBySource.get(item.source.id);
              let revision: ContentRevision | undefined;
              let document: MaterialDocument | undefined;
              try {
                if (block?.currentRevisionId) revision = await rawRevision(courseId, block);
              } catch {
                // Explorer previews are best effort; the selected View owns error reporting.
              }
              try {
                const path = item.source.materialRevision
                  ? materialDocumentPath(item.source.id, item.source.materialRevision)
                  : undefined;
                if (path) document = await api<MaterialDocument>(path, { signal: controller.signal });
              } catch {
                // Material metadata is optional in the compact Explorer.
              }
              const provenance = document?.provenance.find((entry) => entry.version) ?? document?.provenance[0];
              return [
                item.source.id,
                {
                  block,
                  headings: markdownOutline(revision?.content ?? ""),
                  extraction: provenance
                    ? { engine: provenance.engine, version: provenance.version }
                    : undefined,
                } satisfies SourcePreview,
              ] as const;
            }),
        );
        if (!controller.signal.aborted) setPreviews(Object.fromEntries(next));
      } catch {
        if (!controller.signal.aborted) setPreviews({});
      }
    })();
    return () => controller.abort();
  }, [courseId, state.revision, state.sources]);

  const visibleUnits = useMemo(
    () => state.units.filter((unit) => !unitHidden(unit, state.units)),
    [state.units],
  );
  const scriptRoots = useMemo(
    () => visibleUnits
      .filter((unit) => unitKind(unit) === "script" && unit.parentId === null)
      .sort((a, b) => a.order - b.order),
    [visibleUnits],
  );
  const activeSources = useMemo(
    () => state.sources.filter((item) => {
      if (!item.source.present) return false;
      const placement = sourcePlacement(state, item);
      return !placement.hidden && !!placement.currentUnitId;
    }),
    [state],
  );
  const ignored = useMemo(
    () => state.sources.filter((item) =>
      item.source.present && sourcePlacement(state, item).hidden,
    ),
    [state],
  );

  function sourcesFor(unitId: string) {
    return activeSources
      .filter((item) => sourcePlacement(state, item).currentUnitId === unitId)
      .sort((left, right) => {
        const leftOrder = left.decision?.uses.find((use) => use.unitId === unitId)?.order ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = right.decision?.uses.find((use) => use.unitId === unitId)?.order ?? Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder || left.source.name.localeCompare(right.source.name);
      });
  }

  function renderTask(task: PipelineUnit) {
    const sources = sourcesFor(task.id);
    return (
      <li className="authoring-task-item" key={task.id} draggable>
        <button
          type="button"
          data-selected={selection.kind === "unit" && selection.id === task.id || undefined}
          onClick={() => onSelectUnit(task)}
        >
          <span className="authoring-task-mark" />
          <span>{unitLabel(task)}</span>
        </button>
        {sources.length > 0 && (
          <div className="authoring-task-sources">
            {sources.map((item) => (
              <SourceCard
                key={item.source.id}
                item={item}
                preview={previews[item.source.id]}
                selected={selection.kind === "source" && selection.id === item.source.id}
                compact
                onSelect={() => onSelectSource(item, task.id)}
              />
            ))}
          </div>
        )}
      </li>
    );
  }

  function renderUnit(unit: PipelineUnit, depth = 0) {
    const sources = sourcesFor(unit.id);
    const children = visibleUnits
      .filter((candidate) => candidate.parentId === unit.id && unitKind(candidate) === "script")
      .sort((a, b) => a.order - b.order);
    const tasks = visibleUnits
      .filter((candidate) => unitKind(candidate) === "tasks" && taskOwner(visibleUnits, candidate)?.id === unit.id)
      .sort((a, b) => a.order - b.order);
    return (
      <section className="authoring-unit" data-depth={depth} key={unit.id} draggable>
        <button
          type="button"
          className="authoring-unit-title"
          data-selected={selection.kind === "unit" && selection.id === unit.id || undefined}
          onClick={() => onSelectUnit(unit)}
        >
          <ChevronDown size={14} aria-hidden="true" />
          <span>{unitLabel(unit)}</span>
        </button>
        <div className="authoring-unit-content">
          {sources.map((item) => (
            <SourceCard
              key={item.source.id}
              item={item}
              preview={previews[item.source.id]}
              selected={selection.kind === "source" && selection.id === item.source.id}
              onSelect={() => onSelectSource(item, unit.id)}
            />
          ))}
          {children.map((child) => renderUnit(child, depth + 1))}
          <div className="authoring-task-section" data-empty={!tasks.length || undefined}>
            <div className="authoring-task-section-title">Tasks</div>
            {tasks.length ? (
              <ul>{tasks.map(renderTask)}</ul>
            ) : (
              <div className="authoring-task-drop">Drop here</div>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="authoring-explorer">
      <header className="authoring-explorer-header">
        <strong>Explorer</strong>
        <div>
          <button
            type="button"
            aria-label="Quellenbestand aktualisieren"
            title="Refresh sources"
            disabled={refreshing}
            onClick={onRefresh}
          >
            {refreshing ? <LoaderCircle className="authoring-spin" size={14} /> : <RefreshCw size={14} />}
          </button>
          <button type="button" aria-label="Explorer einklappen" title="Collapse Explorer" onClick={onCollapse}>
            <PanelLeftClose size={14} />
          </button>
        </div>
      </header>

      <div className="authoring-explorer-scroll">
        <button
          type="button"
          className="authoring-script-row"
          data-selected={selection.kind === "script" || undefined}
          onClick={onSelectScript}
        >
          <BookOpen size={15} />
          <span>Gesamtes Skript</span>
        </button>

        <div className="authoring-explorer-tree">
          {scriptRoots.map((unit) => renderUnit(unit))}
        </div>

        <section className="authoring-ignored" aria-label="Ignored">
          <div className="authoring-ignored-title">
            <span>Ignored</span>
            {ignored.length > 0 && <small>{ignored.length}</small>}
          </div>
          {ignored.length ? (
            <div className="authoring-ignored-list">
              {ignored.map((item) => (
                <SourceCard
                  key={item.source.id}
                  item={item}
                  preview={previews[item.source.id]}
                  selected={selection.kind === "source" && selection.id === item.source.id}
                  compact
                  onSelect={() => onSelectSource(item)}
                />
              ))}
            </div>
          ) : (
            <div className="authoring-ignored-empty">Drop files here to ignore them</div>
          )}
        </section>
      </div>
    </div>
  );
}
