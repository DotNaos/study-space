import "./authoring-explorer.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@dotnaos/ui-base";
import {
  AlertCircle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Circle,
  ExternalLink,
  EyeOff,
  FolderInput,
  ListTodo,
  LoaderCircle,
  MoreHorizontal,
  PanelLeftClose,
  RefreshCw,
} from "lucide-react";
import { api, message } from "./api";
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
import { pipelinePath, type MappingItem, type PipelineSourceView, type PipelineState, type PipelineUnit } from "./pipeline-api";
import { placementRole, sourcePlacement } from "./source-placement";
import type { StructureSave } from "./structure-autosave";
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

function MoveSubmenu({ children }: { children: (target: "content" | "tasks") => ReactNode }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<"content" | "tasks">("content");
  const [position, setPosition] = useState<{ top: number; left: number; width: number }>();

  const cancelClose = () => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
  };

  const openMenu = () => {
    cancelClose();
    setOpen(true);
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      setPosition(undefined);
      closeTimerRef.current = undefined;
    }, 120);
  };

  useEffect(() => () => cancelClose(), []);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gutter = 8;
      const gap = 4;
      const width = Math.min(256, window.innerWidth - gutter * 2);
      const rightFits = rect.right + gap + width <= window.innerWidth - gutter;
      const left = rightFits
        ? rect.right + gap
        : Math.max(gutter, rect.left - width - gap);
      setPosition({ top: Math.max(gutter, rect.top - 4), left, width });
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || flyoutRef.current?.contains(target)) return;
      setOpen(false);
      setPosition(undefined);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !position || !flyoutRef.current) return;
    const gutter = 8;
    const rect = flyoutRef.current.getBoundingClientRect();
    const viewportBottom = window.innerHeight - gutter;
    let top = position.top;
    if (rect.bottom > viewportBottom) {
      top = Math.max(gutter, top - (rect.bottom - viewportBottom));
    }
    if (rect.top < gutter) top += gutter - rect.top;
    if (Math.abs(top - position.top) > 0.5) {
      setPosition({ ...position, top });
    }
  }, [open, position]);

  return (
    <div
      className="authoring-source-submenu"
      onMouseEnter={openMenu}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={triggerRef}
        type="button"
        className="authoring-source-submenu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onFocus={openMenu}
        onBlur={scheduleClose}
        onClick={openMenu}
      >
        <span className="authoring-source-submenu-label">
          <FolderInput size={13} aria-hidden="true" />
          <span>Move to</span>
        </span>
        <ChevronRight className="authoring-source-submenu-chevron" size={13} aria-hidden="true" />
      </button>
      {open && position && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={flyoutRef}
            className="authoring-source-submenu-flyout"
            role="menu"
            style={{ top: position.top, left: position.left, width: position.width }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            onFocus={cancelClose}
            onBlur={scheduleClose}
            onClick={(event) => {
              if ((event.target as Element).closest?.("[data-submenu-destination]")) {
                cancelClose();
                setOpen(false);
                setPosition(undefined);
              }
            }}
          >
            <button
              type="button"
              className="authoring-source-submenu-mode"
              role="switch"
              aria-checked={target === "tasks"}
              onClick={() => setTarget((current) => current === "tasks" ? "content" : "tasks")}
            >
              <span className="authoring-source-submenu-mode-label">Tasks</span>
              <span className="authoring-source-submenu-switch" aria-hidden="true">
                <span />
              </span>
            </button>
            <div className="authoring-source-submenu-destinations">
              {children(target)}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function SourceCard({
  item,
  preview,
  selected,
  compact = false,
  onSelect,
  onDragStart,
  onDragEnd,
  menu,
  moving = false,
}: {
  item: PipelineSourceView;
  preview?: SourcePreview;
  selected: boolean;
  compact?: boolean;
  onSelect: () => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  menu?: ReactNode;
  moving?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const metadata = preview?.extraction;
  return (
    <article
      className="authoring-source-card"
      data-selected={selected || undefined}
      data-compact={compact || undefined}
      data-moving={moving || undefined}
      draggable={!moving}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
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
            <button type="button" onClick={onSelect}><ExternalLink size={13} aria-hidden="true" /><span>Open</span></button>
            {menu}
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
  onSave,
  onState,
  disabled = false,
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
  onSave: StructureSave;
  onState: (state: PipelineState) => void;
  disabled?: boolean;
  onCollapse: () => void;
}) {
  const [previews, setPreviews] = useState<Record<string, SourcePreview>>({});
  const [dragSourceId, setDragSourceId] = useState<string>();
  const [dropTarget, setDropTarget] = useState<string>();
  const [movingSourceId, setMovingSourceId] = useState<string>();
  const [moveError, setMoveError] = useState("");

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

  const scriptUnits = useMemo(() => visibleUnits
    .filter((unit) => unitKind(unit) === "script")
    .sort((a, b) => a.order - b.order), [visibleUnits]);

  function dragStart(item: PipelineSourceView, event: DragEvent<HTMLElement>) {
    if (disabled || movingSourceId) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-study-source", item.source.id);
    event.dataTransfer.setData("text/plain", item.source.id);
    setDragSourceId(item.source.id);
    setMoveError("");
  }

  function dragEnd() {
    setDragSourceId(undefined);
    setDropTarget(undefined);
  }

  function sourceFromDrag(event: DragEvent<HTMLElement>) {
    const id = event.dataTransfer.getData("application/x-study-source") || dragSourceId;
    return id ? state.sources.find((item) => item.source.id === id) : undefined;
  }

  function allowDrop(event: DragEvent<HTMLElement>, target: string) {
    const carriesSource = !!dragSourceId || Array.from(event.dataTransfer.types).includes("application/x-study-source");
    if (!carriesSource || disabled || movingSourceId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dropTarget !== target) setDropTarget(target);
  }

  async function saveMapping(item: PipelineSourceView, target: PipelineUnit | undefined, baseState = state) {
    const mapping: MappingItem = target ? {
      sourceId: item.source.id,
      sourceVersion: item.source.sourceVersion,
      disposition: "use",
      uses: [{
        unitId: target.id,
        role: placementRole(item, target),
        order: baseState.sources.filter((candidate) => sourcePlacement(baseState, candidate).currentUnitId === target.id).length,
      }],
    } : {
      sourceId: item.source.id,
      sourceVersion: item.source.sourceVersion,
      disposition: "exclude",
      uses: [],
    };
    return api<PipelineState>(`${pipelinePath(courseId)}/mapping`, {
      method: "POST",
      body: JSON.stringify({
        expectedRevision: baseState.revision,
        items: [mapping],
        actor: "user",
        reason: target ? "Quelle im Explorer verschoben." : "Quelle im Explorer nach Ignored verschoben.",
      }),
    });
  }

  async function moveToUnit(item: PipelineSourceView, target: PipelineUnit) {
    if (disabled || movingSourceId) return;
    setMovingSourceId(item.source.id); setMoveError("");
    try {
      const next = await saveMapping(item, target);
      onState(next);
      onSelectSource(next.sources.find((candidate) => candidate.source.id === item.source.id) ?? item, target.id);
    } catch (error) { setMoveError(message(error)); }
    finally { setMovingSourceId(undefined); dragEnd(); }
  }

  async function moveToIgnored(item: PipelineSourceView) {
    if (disabled || movingSourceId) return;
    setMovingSourceId(item.source.id); setMoveError("");
    try {
      const next = await saveMapping(item, undefined);
      onState(next);
      onSelectSource(next.sources.find((candidate) => candidate.source.id === item.source.id) ?? item);
    } catch (error) { setMoveError(message(error)); }
    finally { setMovingSourceId(undefined); dragEnd(); }
  }

  async function moveToTasks(item: PipelineSourceView, script: PipelineUnit) {
    if (disabled || movingSourceId) return;
    setMovingSourceId(item.source.id); setMoveError("");
    try {
      const taskId = crypto.randomUUID().replaceAll("-", "");
      const siblings = state.units.filter((unit) => unitKind(unit) === "tasks");
      const title = item.source.name.replace(/\.[^.]+$/, "") || "Task";
      const task: PipelineUnit = {
        id: taskId,
        title,
        customTitle: title,
        parentId: null,
        order: Math.max(-1, ...siblings.map((unit) => unit.order)) + 1,
        kind: "tasks",
        hidden: false,
        sourceGroupId: null,
        scriptUnitIds: [script.id],
      };
      const structured = await onSave([...state.units, task], state.revision);
      onState(structured);
      const savedTask = structured.units.find((unit) => unit.id === taskId) ?? task;
      const next = await saveMapping(item, savedTask, structured);
      onState(next);
      onSelectSource(next.sources.find((candidate) => candidate.source.id === item.source.id) ?? item, savedTask.id);
    } catch (error) { setMoveError(message(error)); }
    finally { setMovingSourceId(undefined); dragEnd(); }
  }

  function dropOnUnit(event: DragEvent<HTMLElement>, unit: PipelineUnit) {
    event.preventDefault(); event.stopPropagation();
    const item = sourceFromDrag(event);
    if (item) void moveToUnit(item, unit);
  }

  function dropOnTasks(event: DragEvent<HTMLElement>, script: PipelineUnit) {
    event.preventDefault(); event.stopPropagation();
    const item = sourceFromDrag(event);
    if (item) void moveToTasks(item, script);
  }

  function dropOnIgnored(event: DragEvent<HTMLElement>) {
    event.preventDefault(); event.stopPropagation();
    const item = sourceFromDrag(event);
    if (item) void moveToIgnored(item);
  }

  function sourceMenu(item: PipelineSourceView) {
    const placement = sourcePlacement(state, item);
    const current = placement.currentUnitId ? state.units.find((unit) => unit.id === placement.currentUnitId) : undefined;
    const currentScript = current && unitKind(current) === "script" ? current : current ? taskOwner(visibleUnits, current) : undefined;
    return <>
      {currentScript && unitKind(current!) === "script" && <button type="button" onClick={() => void moveToTasks(item, currentScript)}><ListTodo size={13} aria-hidden="true" /><span>Move to Tasks</span></button>}
      {currentScript && current && unitKind(current) === "tasks" && <button type="button" onClick={() => void moveToUnit(item, currentScript)}><BookOpen size={13} aria-hidden="true" /><span>Move to Content</span></button>}
      {!placement.hidden && <button type="button" onClick={() => void moveToIgnored(item)}><EyeOff size={13} aria-hidden="true" /><span>Move to Ignored</span></button>}
      <MoveSubmenu>
        {(target) => scriptUnits.map((unit) => (
          <button
            type="button"
            role="menuitem"
            data-submenu-destination
            className="authoring-source-menu-destination"
            key={unit.id}
            onClick={() => void (target === "tasks" ? moveToTasks(item, unit) : moveToUnit(item, unit))}
          >
            <span>{unitLabel(unit)}</span>
          </button>
        ))}
      </MoveSubmenu>
    </>;
  }

  function renderTask(task: PipelineUnit) {
    const sources = sourcesFor(task.id);
    return (
      <li
        className="authoring-task-item"
        key={task.id}
        data-drop-active={dropTarget === `task:${task.id}` || undefined}
        onDragOver={(event) => allowDrop(event, `task:${task.id}`)}
        onDragLeave={() => dropTarget === `task:${task.id}` && setDropTarget(undefined)}
        onDrop={(event) => dropOnUnit(event, task)}
      >
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
                onDragStart={(event) => dragStart(item, event)}
                onDragEnd={dragEnd}
                menu={sourceMenu(item)}
                moving={movingSourceId === item.source.id}
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
      <section
        className="authoring-unit"
        data-depth={depth}
        key={unit.id}
        data-drop-active={dropTarget === `content:${unit.id}` || undefined}
        onDragOver={(event) => { event.stopPropagation(); allowDrop(event, `content:${unit.id}`); }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && dropTarget === `content:${unit.id}`) setDropTarget(undefined); }}
        onDrop={(event) => dropOnUnit(event, unit)}
      >
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
              onDragStart={(event) => dragStart(item, event)}
              onDragEnd={dragEnd}
              menu={sourceMenu(item)}
              moving={movingSourceId === item.source.id}
            />
          ))}
          {children.map((child) => renderUnit(child, depth + 1))}
          <div
            className="authoring-task-section"
            data-empty={!tasks.length || undefined}
            data-drop-active={dropTarget === `tasks:${unit.id}` || undefined}
            onDragOver={(event) => { event.stopPropagation(); allowDrop(event, `tasks:${unit.id}`); }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && dropTarget === `tasks:${unit.id}`) setDropTarget(undefined); }}
            onDrop={(event) => dropOnTasks(event, unit)}
          >
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
        <div className="authoring-explorer-heading">
          <strong>Explorer</strong>
          {state.pending > 0 && <small>{state.pending} offen</small>}
        </div>
        <div className="authoring-explorer-actions">
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

      {moveError && <div className="authoring-explorer-error" role="alert">{moveError}</div>}
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

        <section
          className="authoring-ignored"
          aria-label="Ignored"
          data-drop-active={dropTarget === "ignored" || undefined}
          onDragOver={(event) => allowDrop(event, "ignored")}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && dropTarget === "ignored") setDropTarget(undefined); }}
          onDrop={dropOnIgnored}
        >
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
                  onDragStart={(event) => dragStart(item, event)}
                  onDragEnd={dragEnd}
                  menu={sourceMenu(item)}
                  moving={movingSourceId === item.source.id}
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
