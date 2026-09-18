import "./authoring-explorer.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { LayoutGroup, Reorder } from "motion/react";
import { Icon } from "@dotnaos/ui-base";
import {
  AlertCircle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Circle,
  ArrowUpRight,
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

function hasFileExtension(value: string) {
  const name = value.split(/[\\/]/).at(-1)?.trim() ?? "";
  return /\.[a-z0-9][a-z0-9_-]{0,11}$/i.test(name);
}

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

function MoveSubmenu({ children }: { children: ReactNode }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
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
            <div className="authoring-source-submenu-destinations">
              {children}
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
  menu,
  moving = false,
}: {
  item: PipelineSourceView;
  preview?: SourcePreview;
  selected: boolean;
  compact?: boolean;
  onSelect: () => void;
  menu?: ReactNode;
  moving?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const metadata = preview?.extraction;

  useEffect(() => {
    const dismissMenu = (event: PointerEvent) => {
      const target = event.target as Element;
      if (menuRef.current?.contains(target)) return;
      if (target.closest?.(".authoring-source-submenu-flyout")) return;
      if (menuRef.current) menuRef.current.open = false;
    };
    document.addEventListener("pointerdown", dismissMenu);
    return () => document.removeEventListener("pointerdown", dismissMenu);
  }, []);

  return (
    <article
      className="authoring-source-card"
      data-selected={selected || undefined}
      data-compact={compact || undefined}
      data-moving={moving || undefined}
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
          {hasFileExtension(item.source.name)
            ? <Icon.File filename={item.source.name} size={15} />
            : <ExternalLink className="authoring-source-external-icon" size={15} aria-hidden="true" />}
          <span>{item.source.name}</span>
        </button>
        <ExtractionMark item={item} preview={preview} />
        <details ref={menuRef} className="authoring-source-menu">
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

function ReorderSourceList({
  items,
  targetKey,
  renderItem,
  onDragStart,
  onDragMove,
  onDragEnd,
  disabled = false,
}: {
  items: PipelineSourceView[];
  targetKey: string;
  renderItem: (item: PipelineSourceView) => ReactNode;
  onDragStart: (item: PipelineSourceView, targetKey: string) => void;
  onDragMove: (point: { x: number; y: number }) => void;
  onDragEnd: (item: PipelineSourceView, targetKey: string, order: string[]) => void;
  disabled?: boolean;
}) {
  const sourceIds = items.map((item) => item.source.id);
  const sourceKey = sourceIds.join("\u0000");
  const [order, setOrder] = useState(sourceIds);
  const orderRef = useRef(sourceIds);

  useEffect(() => {
    orderRef.current = sourceIds;
    setOrder(sourceIds);
  }, [sourceKey]);

  const updateOrder = (next: string[]) => {
    orderRef.current = next;
    setOrder(next);
  };

  const byId = new Map(items.map((item) => [item.source.id, item]));

  return (
    <Reorder.Group
      as="div"
      axis="y"
      values={order}
      onReorder={updateOrder}
      className="authoring-reorder-list"
    >
      {order.map((id) => {
        const item = byId.get(id);
        if (!item) return null;
        return (
          <Reorder.Item
            as="div"
            key={id}
            value={id}
            className="authoring-reorder-item"
            dragListener={!disabled}
            dragMomentum={false}
            dragElastic={0.025}
            layout="position"
            layoutId={`authoring-source-${id}`}
            transition={{ layout: { type: "spring", stiffness: 360, damping: 32, mass: 0.72 } }}
            whileDrag={{ scale: 1.006 }}
            onDragStart={() => onDragStart(item, targetKey)}
            onDrag={(event) => {
              if ("clientX" in event) onDragMove({ x: event.clientX, y: event.clientY });
            }}
            onDragEnd={() => onDragEnd(item, targetKey, orderRef.current)}
          >
            {renderItem(item)}
          </Reorder.Item>
        );
      })}
    </Reorder.Group>
  );
}

type OptimisticSourcePlacement = {
  targetUnitId?: string;
  hidden: boolean;
  order?: number;
};

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
  const [dropTarget, setDropTarget] = useState<string>();
  const dropTargetRef = useRef<string | undefined>(undefined);
  const [optimisticPlacements, setOptimisticPlacements] = useState<Record<string, OptimisticSourcePlacement>>({});
  const [optimisticUnits, setOptimisticUnits] = useState<PipelineUnit[]>([]);
  const [movingSourceId, setMovingSourceId] = useState<string>();
  const [movingTaskId, setMovingTaskId] = useState<string>();
  const [collapsedUnits, setCollapsedUnits] = useState<Set<string>>(() => new Set());
  const [collapsedTasks, setCollapsedTasks] = useState<Set<string>>(() => new Set());
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

  useEffect(() => {
    setOptimisticUnits((current) => {
      const persisted = new Set(state.units.map((unit) => unit.id));
      const next = current.filter((unit) => !persisted.has(unit.id));
      return next.length === current.length ? current : next;
    });
    setOptimisticPlacements((current) => {
      let changed = false;
      const next = { ...current };
      for (const [sourceId, optimistic] of Object.entries(current)) {
        const item = state.sources.find((candidate) => candidate.source.id === sourceId);
        if (!item) continue;
        const actual = sourcePlacement(state, item);
        const confirmed = optimistic.hidden
          ? actual.hidden
          : !actual.hidden && actual.currentUnitId === optimistic.targetUnitId;
        if (confirmed) {
          delete next[sourceId];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [state.revision, state.sources, state.units]);

  const effectiveUnits = useMemo(() => {
    const persisted = new Set(state.units.map((unit) => unit.id));
    return [...state.units, ...optimisticUnits.filter((unit) => !persisted.has(unit.id))];
  }, [state.units, optimisticUnits]);

  function effectivePlacement(item: PipelineSourceView) {
    const optimistic = optimisticPlacements[item.source.id];
    if (!optimistic) return sourcePlacement(state, item);
    return {
      ...sourcePlacement(state, item),
      currentUnitId: optimistic.hidden ? undefined : optimistic.targetUnitId,
      hidden: optimistic.hidden,
      overridden: true,
    };
  }

  const visibleUnits = useMemo(
    () => effectiveUnits.filter((unit) => !unitHidden(unit, effectiveUnits)),
    [effectiveUnits],
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
      const placement = optimisticPlacements[item.source.id];
      if (placement) return !placement.hidden && !!placement.targetUnitId;
      const actual = sourcePlacement(state, item);
      return !actual.hidden && !!actual.currentUnitId;
    }),
    [state, optimisticPlacements],
  );
  const ignored = useMemo(
    () => state.sources.filter((item) => {
      if (!item.source.present) return false;
      const placement = optimisticPlacements[item.source.id];
      return placement ? placement.hidden : sourcePlacement(state, item).hidden;
    }),
    [state, optimisticPlacements],
  );

  function sourcesFor(unitId: string) {
    return activeSources
      .filter((item) => effectivePlacement(item).currentUnitId === unitId)
      .sort((left, right) => {
        const leftOptimistic = optimisticPlacements[left.source.id];
        const rightOptimistic = optimisticPlacements[right.source.id];
        const leftOrder = leftOptimistic?.targetUnitId === unitId && leftOptimistic.order != null
          ? leftOptimistic.order
          : left.decision?.uses.find((use) => use.unitId === unitId)?.order ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = rightOptimistic?.targetUnitId === unitId && rightOptimistic.order != null
          ? rightOptimistic.order
          : right.decision?.uses.find((use) => use.unitId === unitId)?.order ?? Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder || left.source.name.localeCompare(right.source.name);
      });
  }

  const scriptUnits = useMemo(() => visibleUnits
    .filter((unit) => unitKind(unit) === "script")
    .sort((a, b) => a.order - b.order), [visibleUnits]);

  function setActiveDropTarget(target?: string) {
    dropTargetRef.current = target;
    setDropTarget(target);
  }

  function clearSourceDrag() {
    setActiveDropTarget(undefined);
  }

  function dropTargetAt(point: { x: number; y: number }) {
    for (const element of document.elementsFromPoint(point.x, point.y)) {
      if (element.closest(".authoring-reorder-item")) continue;
      const targetElement = element.closest<HTMLElement>("[data-source-drop-target]");
      const target = targetElement?.dataset.sourceDropTarget;
      if (target) return target;
    }
    return undefined;
  }

  function updateSourceDrag(point: { x: number; y: number }) {
    const target = dropTargetAt(point);
    if (target?.startsWith("content:")) {
      const id = target.slice("content:".length);
      setCollapsedUnits((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    } else if (target?.startsWith("tasks:")) {
      const id = target.slice("tasks:".length);
      setCollapsedTasks((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
    if (dropTargetRef.current !== target) setActiveDropTarget(target);
  }

  function startSourceDrag(_item: PipelineSourceView, origin: string) {
    if (disabled || movingSourceId) return;
    setActiveDropTarget(origin);
    setMoveError("");
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

  function applyOptimisticPlacement(
    item: PipelineSourceView,
    placement: OptimisticSourcePlacement,
  ) {
    setOptimisticPlacements((current) => ({
      ...current,
      [item.source.id]: placement,
    }));
  }

  function rollbackOptimisticPlacement(sourceId: string) {
    setOptimisticPlacements((current) => {
      if (!(sourceId in current)) return current;
      const next = { ...current };
      delete next[sourceId];
      return next;
    });
  }

  function createTaskUnit(item: PipelineSourceView, script: PipelineUnit) {
    const taskId = crypto.randomUUID().replaceAll("-", "");
    const siblings = effectiveUnits.filter((unit) => unitKind(unit) === "tasks");
    const title = item.source.name.replace(/\.[^.]+$/, "") || "Task";
    return {
      id: taskId,
      title,
      customTitle: title,
      parentId: null,
      order: Math.max(-1, ...siblings.map((unit) => unit.order)) + 1,
      kind: "tasks" as const,
      hidden: false,
      sourceGroupId: null,
      scriptUnitIds: [script.id],
    } satisfies PipelineUnit;
  }

  function addOptimisticUnit(unit: PipelineUnit) {
    setOptimisticUnits((current) => current.some((candidate) => candidate.id === unit.id)
      ? current
      : [...current, unit]);
  }

  function rollbackOptimisticUnit(unitId: string) {
    setOptimisticUnits((current) => current.filter((unit) => unit.id !== unitId));
  }

  async function removeEmptyTask(taskId: string, baseState: PipelineState) {
    const task = baseState.units.find((unit) => unit.id === taskId);
    if (!task || unitKind(task) !== "tasks" || task.sourceGroupId != null) return baseState;
    const stillUsed = baseState.sources.some(
      (candidate) => sourcePlacement(baseState, candidate).currentUnitId === taskId,
    );
    if (stillUsed) return baseState;
    const units = baseState.units
      .filter((unit) => unit.id !== taskId)
      .map((unit) => ({
        ...unit,
        scriptUnitIds: (unit.scriptUnitIds ?? []).filter((id) => id !== taskId),
      }));
    return onSave(units, baseState.revision, [taskId]);
  }

  async function moveToUnit(item: PipelineSourceView, target: PipelineUnit) {
    if (disabled || movingSourceId) return;
    const previousUnitId = sourcePlacement(state, item).currentUnitId;
    const previousTask = previousUnitId
      ? state.units.find((unit) => unit.id === previousUnitId && unitKind(unit) === "tasks")
      : undefined;
    const optimisticOrder = sourcesFor(target.id).filter((candidate) => candidate.source.id !== item.source.id).length;
    applyOptimisticPlacement(item, { targetUnitId: target.id, hidden: false, order: optimisticOrder });
    setMovingSourceId(item.source.id); setMoveError("");
    try {
      let next = await saveMapping(item, target);
      if (previousTask && previousTask.id !== target.id) next = await removeEmptyTask(previousTask.id, next);
      onState(next);
      onSelectSource(next.sources.find((candidate) => candidate.source.id === item.source.id) ?? item, target.id);
    } catch (error) {
      rollbackOptimisticPlacement(item.source.id);
      setMoveError(message(error));
    } finally {
      setMovingSourceId(undefined);
      clearSourceDrag();
    }
  }

  async function moveToIgnored(item: PipelineSourceView) {
    if (disabled || movingSourceId) return;
    const previousUnitId = sourcePlacement(state, item).currentUnitId;
    const previousTask = previousUnitId
      ? state.units.find((unit) => unit.id === previousUnitId && unitKind(unit) === "tasks")
      : undefined;
    applyOptimisticPlacement(item, { hidden: true });
    setMovingSourceId(item.source.id); setMoveError("");
    try {
      let next = await saveMapping(item, undefined);
      if (previousTask) next = await removeEmptyTask(previousTask.id, next);
      onState(next);
      onSelectSource(next.sources.find((candidate) => candidate.source.id === item.source.id) ?? item);
    } catch (error) {
      rollbackOptimisticPlacement(item.source.id);
      setMoveError(message(error));
    } finally {
      setMovingSourceId(undefined);
      clearSourceDrag();
    }
  }

  async function moveToTasks(item: PipelineSourceView, script: PipelineUnit) {
    if (disabled || movingSourceId) return;
    const previousUnitId = sourcePlacement(state, item).currentUnitId;
    const previousTask = previousUnitId
      ? state.units.find((unit) => unit.id === previousUnitId && unitKind(unit) === "tasks")
      : undefined;
    const task = createTaskUnit(item, script);
    addOptimisticUnit(task);
    applyOptimisticPlacement(item, { targetUnitId: task.id, hidden: false, order: 0 });
    setMovingSourceId(item.source.id); setMoveError("");
    try {
      const structured = await onSave([...state.units, task], state.revision);
      onState(structured);
      const savedTask = structured.units.find((unit) => unit.id === task.id) ?? task;
      let next = await saveMapping(item, savedTask, structured);
      if (previousTask && previousTask.id !== savedTask.id) next = await removeEmptyTask(previousTask.id, next);
      onState(next);
      onSelectSource(next.sources.find((candidate) => candidate.source.id === item.source.id) ?? item, savedTask.id);
    } catch (error) {
      rollbackOptimisticPlacement(item.source.id);
      rollbackOptimisticUnit(task.id);
      setMoveError(message(error));
    } finally {
      setMovingSourceId(undefined);
      clearSourceDrag();
    }
  }

  async function moveTaskToContent(task: PipelineUnit) {
    if (disabled || movingSourceId || movingTaskId) return;
    const owner = taskOwner(visibleUnits, task);
    if (!owner) return;
    setMovingTaskId(task.id); setMoveError("");
    try {
      let nextState = state;
      for (const item of sourcesFor(task.id)) {
        nextState = await saveMapping(item, owner, nextState);
      }
      const nextUnits = nextState.units
        .filter((unit) => unit.id !== task.id)
        .map((unit) => ({
          ...unit,
          scriptUnitIds: (unit.scriptUnitIds ?? []).filter((id) => id !== task.id),
        }));
      const saved = await onSave(nextUnits, nextState.revision, [task.id]);
      onState(saved);
      onSelectUnit(saved.units.find((unit) => unit.id === owner.id) ?? owner);
    } catch (error) { setMoveError(message(error)); }
    finally { setMovingTaskId(undefined); }
  }


  function unitForTargetKey(targetKey: string) {
    const match = /^(?:content|task):(.+)$/.exec(targetKey);
    return match ? state.units.find((unit) => unit.id === match[1]) : undefined;
  }

  async function saveSourceOrder(targetKey: string, order: string[]) {
    const target = unitForTargetKey(targetKey);
    if (!target) return;
    const current = sourcesFor(target.id).map((item) => item.source.id);
    if (current.length === order.length && current.every((id, index) => id === order[index])) return;

    const byId = new Map(state.sources.map((item) => [item.source.id, item]));
    const items: MappingItem[] = order.flatMap((id, index) => {
      const item = byId.get(id);
      if (!item) return [];
      return [{
        sourceId: item.source.id,
        sourceVersion: item.source.sourceVersion,
        disposition: "use" as const,
        uses: [{
          unitId: target.id,
          role: placementRole(item, target),
          order: index,
        }],
      }];
    });
    if (!items.length) return;

    setMovingSourceId(order[0]);
    try {
      const next = await api<PipelineState>(`${pipelinePath(courseId)}/mapping`, {
        method: "POST",
        body: JSON.stringify({
          expectedRevision: state.revision,
          items,
          actor: "user",
          reason: "Quellen im Explorer neu sortiert.",
        }),
      });
      onState(next);
    } catch (error) {
      setMoveError(message(error));
    } finally {
      setMovingSourceId(undefined);
    }
  }

  async function moveSourceToTarget(item: PipelineSourceView, targetKey: string) {
    if (targetKey === "ignored") {
      await moveToIgnored(item);
      return;
    }
    if (targetKey.startsWith("tasks:")) {
      const script = state.units.find((unit) => unit.id === targetKey.slice("tasks:".length));
      if (script) await moveToTasks(item, script);
      return;
    }
    const target = unitForTargetKey(targetKey);
    if (target) await moveToUnit(item, target);
  }

  function finishSourceDrag(item: PipelineSourceView, origin: string, order: string[]) {
    const target = dropTargetRef.current ?? origin;
    clearSourceDrag();
    if (target === origin) {
      if (target !== "ignored") void saveSourceOrder(target, order);
      return;
    }
    void moveSourceToTarget(item, target);
  }

  function sourceMenu(item: PipelineSourceView) {
    const placement = effectivePlacement(item);
    const current = placement.currentUnitId ? effectiveUnits.find((unit) => unit.id === placement.currentUnitId) : undefined;
    const currentScript = current && unitKind(current) === "script" ? current : current ? taskOwner(visibleUnits, current) : undefined;
    return <>
      {currentScript && unitKind(current!) === "script" && <button type="button" onClick={() => void moveToTasks(item, currentScript)}><ListTodo size={13} aria-hidden="true" /><span>Move to Tasks</span></button>}
      {currentScript && current && unitKind(current) === "tasks" && <button type="button" onClick={() => void moveToUnit(item, currentScript)}><BookOpen size={13} aria-hidden="true" /><span>Move to Content</span></button>}
      {!placement.hidden && <button type="button" onClick={() => void moveToIgnored(item)}><EyeOff size={13} aria-hidden="true" /><span>Move to Ignored</span></button>}
      <MoveSubmenu>
        {scriptUnits.map((unit) => (
          <div className="authoring-source-menu-destination" key={unit.id}>
            <button
              type="button"
              role="menuitem"
              data-submenu-destination
              className="authoring-source-menu-destination-main"
              onClick={() => void moveToUnit(item, unit)}
            >
              <span>{unitLabel(unit)}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              data-submenu-destination
              className="authoring-source-menu-task-chip"
              aria-label={`${unitLabel(unit)} Tasks`}
              onClick={() => void moveToTasks(item, unit)}
            >
              Tasks
            </button>
          </div>
        ))}
      </MoveSubmenu>
    </>;
  }

  function renderSourceCard(item: PipelineSourceView, unitId?: string, compact = false) {
    return (
      <SourceCard
        item={item}
        preview={previews[item.source.id]}
        selected={selection.kind === "source" && selection.id === item.source.id}
        compact={compact}
        onSelect={() => onSelectSource(item, unitId)}
        menu={sourceMenu(item)}
        moving={movingSourceId === item.source.id}
      />
    );
  }

  function renderTask(task: PipelineUnit) {
    const sources = sourcesFor(task.id);

    if (sources.length > 0) {
      return (
        <li
          className="authoring-task-item authoring-task-item-sources"
          key={task.id}
          data-source-drop-target={`task:${task.id}`}
          data-drop-active={dropTarget === `task:${task.id}` || undefined}
        >
          <ReorderSourceList
            items={sources}
            targetKey={`task:${task.id}`}
            renderItem={(item) => renderSourceCard(item, task.id)}
            onDragStart={startSourceDrag}
            onDragMove={updateSourceDrag}
            onDragEnd={finishSourceDrag}
            disabled={disabled || !!movingSourceId}
          />
        </li>
      );
    }

    const owner = taskOwner(visibleUnits, task);
    return (
      <li
        className="authoring-task-item"
        key={task.id}
        data-moving={movingTaskId === task.id || undefined}
        data-source-drop-target={`task:${task.id}`}
        data-drop-active={dropTarget === `task:${task.id}` || undefined}
      >
        <div className="authoring-task-row">
          <button
            type="button"
            className="authoring-task-open"
            data-selected={selection.kind === "unit" && selection.id === task.id || undefined}
            onClick={() => onSelectUnit(task)}
          >
            <ListTodo size={13} aria-hidden="true" />
            <span>{unitLabel(task)}</span>
          </button>
          {owner && (
            <details className="authoring-task-menu">
              <summary aria-label={`Aktionen für ${unitLabel(task)}`} title="Aktionen">
                <MoreHorizontal size={14} />
              </summary>
              <div>
                <button type="button" disabled={movingTaskId === task.id} onClick={() => void moveTaskToContent(task)}>
                  <BookOpen size={13} aria-hidden="true" />
                  <span>Move to Content</span>
                </button>
              </div>
            </details>
          )}
        </div>
      </li>
    );
  }

  function toggleUnitCollapsed(id: string) {
    setCollapsedUnits((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTasksCollapsed(id: string) {
    setCollapsedTasks((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderUnit(unit: PipelineUnit, depth = 0) {
    const sources = sourcesFor(unit.id);
    const children = visibleUnits
      .filter((candidate) => candidate.parentId === unit.id && unitKind(candidate) === "script")
      .sort((a, b) => a.order - b.order);
    const tasks = visibleUnits
      .filter((candidate) => unitKind(candidate) === "tasks" && taskOwner(visibleUnits, candidate)?.id === unit.id)
      .sort((a, b) => a.order - b.order);
    const collapsed = collapsedUnits.has(unit.id);
    const tasksCollapsed = collapsedTasks.has(unit.id);
    const selected = selection.kind === "unit" && selection.id === unit.id;
    return (
      <section
        className="authoring-unit"
        data-depth={depth}
        key={unit.id}
        data-drop-active={dropTarget === `content:${unit.id}` || undefined}
      >
        <div
          className="authoring-unit-heading"
          data-selected={selected || undefined}
          data-source-drop-target={`content:${unit.id}`}
        >
          <button
            type="button"
            className="authoring-unit-toggle"
            aria-expanded={!collapsed}
            onClick={() => toggleUnitCollapsed(unit.id)}
          >
            {collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            <span>{unitLabel(unit)}</span>
          </button>
          <button
            type="button"
            className="authoring-unit-view"
            aria-label={unitLabel(unit) + " öffnen"}
            title="Öffnen"
            onClick={() => onSelectUnit(unit)}
          >
            <ArrowUpRight size={14} aria-hidden="true" />
          </button>
        </div>
        {!collapsed && <div className="authoring-unit-content" data-source-drop-target={`content:${unit.id}`}>
          <ReorderSourceList
            items={sources}
            targetKey={`content:${unit.id}`}
            renderItem={(item) => renderSourceCard(item, unit.id)}
            onDragStart={startSourceDrag}
            onDragMove={updateSourceDrag}
            onDragEnd={finishSourceDrag}
            disabled={disabled || !!movingSourceId}
          />
          {children.map((child) => renderUnit(child, depth + 1))}
          <div
            className="authoring-task-section"
            data-empty={!tasks.length || undefined}
            data-source-drop-target={`tasks:${unit.id}`}
            data-drop-active={dropTarget === `tasks:${unit.id}` || undefined}
          >
            <button
              type="button"
              className="authoring-task-section-title"
              data-source-drop-target={`tasks:${unit.id}`}
              aria-expanded={!tasksCollapsed}
              onClick={() => toggleTasksCollapsed(unit.id)}
            >
              {tasksCollapsed ? <ChevronRight size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
              <ListTodo size={13} aria-hidden="true" />
              <span>Tasks</span>
            </button>
            {!tasksCollapsed && (
              <>
                {tasks.length ? (
                  <ul>{tasks.map(renderTask)}</ul>
                ) : (
                  <div className="authoring-task-drop">Drop here</div>
                )}
              </>
            )}
          </div>
        </div>}
      </section>
    );
  }

  return (
    <LayoutGroup id={`authoring-explorer-${courseId}`}>
      <div className="authoring-explorer">
      <header className="authoring-explorer-header">
        <div className="authoring-explorer-heading">
          <strong>Explorer</strong>
          {state.pending > 0 && <small>{state.pending} offen</small>}
        </div>
        <div className="authoring-explorer-actions">
          <button
            type="button"
            data-selected={selection.kind === "script" || undefined}
            aria-label="Gesamtes Skript ansehen"
            title="Gesamtes Skript"
            onClick={onSelectScript}
          >
            <BookOpen size={14} />
          </button>
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
        <div className="authoring-explorer-tree">
          {scriptRoots.map((unit) => renderUnit(unit))}
        </div>

        <section
          className="authoring-ignored"
          aria-label="Ignored"
          data-source-drop-target="ignored"
          data-drop-active={dropTarget === "ignored" || undefined}
        >
          <div className="authoring-ignored-title">
            <span>Ignored</span>
            {ignored.length > 0 && <small>{ignored.length}</small>}
          </div>
          {ignored.length ? (
            <div className="authoring-ignored-list">
              <ReorderSourceList
                items={ignored}
                targetKey="ignored"
                renderItem={(item) => renderSourceCard(item, undefined, true)}
                onDragStart={startSourceDrag}
                onDragMove={updateSourceDrag}
                onDragEnd={finishSourceDrag}
                disabled={disabled || !!movingSourceId}
              />
            </div>
          ) : (
            <div className="authoring-ignored-empty">Drop files here to ignore them</div>
          )}
        </section>
      </div>

      </div>
    </LayoutGroup>
  );
}
