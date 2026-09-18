import "./authoring-explorer.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { LayoutGroup, Reorder, useDragControls } from "motion/react";
import { Icon } from "@dotnaos/ui-base";
import {
  AlertCircle,
  BookOpen,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Circle,
  ArrowUpRight,
  ExternalLink,
  Eye,
  EyeOff,
  FolderInput,
  GripVertical,
  ListTodo,
  LoaderCircle,
  MoreHorizontal,
  PanelLeftClose,
  PencilLine,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { api, message } from "./api";
import {
  readContentBlock,
  readContentWorkspace,
  type ContentBlockSummary,
} from "./content-api";
import { unitHidden, unitKind, unitLabel } from "./learning-structure";
import {
  materialDocumentPath,
  type MaterialDocument,
} from "./material-api";
import { pipelinePath, type MappingItem, type PipelineSourceView, type PipelineState, type PipelineUnit, type SourceUse } from "./pipeline-api";
import { currentUse, placementRole, sourcePlacement } from "./source-placement";
import type { StructureSave } from "./structure-autosave";
import { matchingSolutionSource, matchingTaskSource, solutionLike, taskLike } from "./task-pairing";
import type { ContentSelection } from "./ContentAuthoringView";

function sameUnitDraft(left: PipelineUnit, right: PipelineUnit) {
  return left.id === right.id
    && left.title === right.title
    && (left.customTitle ?? null) === (right.customTitle ?? null)
    && left.parentId === right.parentId
    && left.order === right.order
    && unitKind(left) === unitKind(right)
    && (left.hidden ?? false) === (right.hidden ?? false)
    && (left.sourceGroupId ?? null) === (right.sourceGroupId ?? null)
    && JSON.stringify(left.scriptUnitIds ?? []) === JSON.stringify(right.scriptUnitIds ?? []);
}

type SourcePreview = {
  extraction?: { engine: string; version: string };
  contentState: "none" | "raw" | "edited";
};

function hasFileExtension(value: string) {
  const name = value.split(/[\\/]/).at(-1)?.trim() ?? "";
  return /\.[a-z0-9][a-z0-9_-]{0,11}$/i.test(name);
}

function taskOwner(units: PipelineUnit[], task: PipelineUnit) {
  const scripts = units
    .filter((unit) => unitKind(unit) === "script" && !unitHidden(unit, units))
    .sort((a, b) => a.order - b.order);
  return scripts.find((script) => (task.scriptUnitIds ?? []).includes(script.id));
}

function ExtractionMark({
  item,
  preview,
}: {
  item: PipelineSourceView;
  preview?: SourcePreview;
}) {
  const hasExtraction = !!item.source.materialRevision;
  const unsupported = item.source.acquisition === "unsupported";
  const problem = !unsupported && (!!item.source.problem || item.source.warnings.length > 0);
  const metadata = preview?.extraction;
  const title = problem
    ? ["Extraction issue", item.source.problem, ...item.source.warnings]
        .filter(Boolean)
        .join(" · ")
    : unsupported
      ? item.source.problem ?? "No extractable Moodle content"
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
    <span className="authoring-extraction-mark" data-state={unsupported ? "unsupported" : "empty"} title={title}>
      <Circle size={11} />
    </span>
  );
}

function ContentStateMark({ preview }: { preview?: SourcePreview }) {
  const state = preview?.contentState ?? "none";
  if (state === "none") return null;
  const label = state === "edited" ? "Edited" : "Raw";
  const title = state === "edited"
    ? "Bearbeitete Fassung vorhanden"
    : "Nur Raw-Fassung vorhanden";
  return <span className="authoring-source-version" data-state={state} title={title}>{label}</span>;
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
  onSelect,
  menu,
  moving = false,
}: {
  item: PipelineSourceView;
  preview?: SourcePreview;
  selected: boolean;
  onSelect: () => void;
  menu?: ReactNode;
  moving?: boolean;
}) {
  const menuRef = useRef<HTMLDetailsElement>(null);

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
      data-moving={moving || undefined}
    >
      <div className="authoring-source-card-head">
        <button type="button" className="authoring-source-open" onClick={onSelect} title={item.source.name}>
          {hasFileExtension(item.source.name)
            ? <Icon.File filename={item.source.name} size={15} />
            : <ExternalLink className="authoring-source-external-icon" size={15} aria-hidden="true" />}
          <span>{item.source.name}</span>
        </button>
        <div className="authoring-source-status">
          <ContentStateMark preview={preview} />
          <ExtractionMark item={item} preview={preview} />
        </div>
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

function SolutionPicker({
  task,
  candidates,
  disabled,
  onPick,
}: {
  task: PipelineSourceView;
  candidates: PipelineSourceView[];
  disabled: boolean;
  onPick: (source: PipelineSourceView) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; width: number }>();

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gutter = 8;
      const width = Math.min(320, window.innerWidth - gutter * 2);
      const left = Math.min(
        Math.max(gutter, rect.left),
        Math.max(gutter, window.innerWidth - width - gutter),
      );
      const preferredTop = rect.bottom + 4;
      setPosition({
        top: Math.min(preferredTop, Math.max(gutter, window.innerHeight - 280 - gutter)),
        left,
        width,
      });
    };
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || flyoutRef.current?.contains(target)) return;
      setOpen(false);
      setPosition(undefined);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    document.addEventListener("pointerdown", dismiss);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("pointerdown", dismiss);
    };
  }, [open]);

  const choose = (source: PipelineSourceView) => {
    setOpen(false);
    setPosition(undefined);
    onPick(source);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="authoring-solution-picker-trigger"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Lösung zuordnen
      </button>
      {open && position && typeof document !== "undefined" && createPortal(
        <div
          ref={flyoutRef}
          className="authoring-solution-picker-flyout"
          role="menu"
          aria-label={"Lösung für " + task.source.name + " zuordnen"}
          style={position}
        >
          <div className="authoring-solution-picker-heading">
            <strong>Lösung zuordnen</strong>
            <small>{task.source.name}</small>
          </div>
          <div className="authoring-solution-picker-list">
            {candidates.length ? candidates.map((source) => (
              <button
                type="button"
                role="menuitem"
                key={source.source.id}
                onClick={() => choose(source)}
              >
                {hasFileExtension(source.source.name)
                  ? <Icon.File filename={source.source.name} size={14} />
                  : <ExternalLink size={14} aria-hidden="true" />}
                <span>{source.source.name}</span>
                {solutionLike(source) && <small>Solution</small>}
              </button>
            )) : (
              <div className="authoring-solution-picker-empty">Keine passende vorhandene Quelle.</div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function SectionActions({
  unit,
  hidden,
  resettable,
  disabled,
  visibilityDisabled,
  onRename,
  onVisibility,
  onReset,
}: {
  unit: PipelineUnit;
  hidden: boolean;
  resettable: boolean;
  disabled: boolean;
  visibilityDisabled: boolean;
  onRename: () => void;
  onVisibility: () => void;
  onReset: () => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      if (ref.current) ref.current.open = false;
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);

  const run = (action: () => void) => {
    if (ref.current) ref.current.open = false;
    action();
  };

  return (
    <details ref={ref} className="authoring-unit-menu">
      <summary aria-label={`Aktionen für ${unitLabel(unit)}`} title="Aktionen">
        <MoreHorizontal size={14} />
      </summary>
      <div>
        <button type="button" disabled={disabled} onClick={() => run(onRename)}><PencilLine size={13} aria-hidden="true" /><span>Rename</span></button>
        <button type="button" disabled={disabled || visibilityDisabled} onClick={() => run(onVisibility)} title={visibilityDisabled ? "Hidden by parent" : undefined}>
          {hidden ? <Eye size={13} aria-hidden="true" /> : <EyeOff size={13} aria-hidden="true" />}
          <span>{hidden ? "Show" : "Hide"}</span>
        </button>
        {resettable && <button type="button" disabled={disabled} onClick={() => run(onReset)}><RotateCcw size={13} aria-hidden="true" /><span>Reset</span></button>}
      </div>
    </details>
  );
}

function SectionReorderItem({
  unit,
  disabled,
  onDragEnd,
  children,
}: {
  unit: PipelineUnit;
  disabled: boolean;
  onDragEnd: () => void;
  children: (handle: ReactNode) => ReactNode;
}) {
  const controls = useDragControls();
  const handle = (
    <button
      type="button"
      className="authoring-unit-drag-handle authoring-unit-control"
      aria-label={`${unitLabel(unit)} verschieben`}
      title="Verschieben"
      disabled={disabled}
      onPointerDown={(event) => {
        event.preventDefault();
        if (!disabled) controls.start(event);
      }}
    >
      <GripVertical size={14} aria-hidden="true" />
    </button>
  );

  return (
    <Reorder.Item
      as="div"
      value={unit.id}
      dragListener={false}
      dragControls={controls}
      dragMomentum={false}
      dragElastic={0.02}
      layout="position"
      layoutId={`authoring-unit-${unit.id}`}
      transition={{ layout: { type: "spring", stiffness: 360, damping: 32, mass: 0.72 } }}
      className="authoring-unit-reorder-item"
      onDragEnd={onDragEnd}
    >
      {children(handle)}
    </Reorder.Item>
  );
}

function ReorderSectionList({
  items,
  disabled,
  renderItem,
  onOrder,
}: {
  items: PipelineUnit[];
  disabled: boolean;
  renderItem: (unit: PipelineUnit, dragHandle: ReactNode) => ReactNode;
  onOrder: (order: string[]) => void;
}) {
  const ids = items.map((unit) => unit.id);
  const key = ids.join("\u0000");
  const [order, setOrder] = useState(ids);
  const orderRef = useRef(ids);

  useEffect(() => {
    orderRef.current = ids;
    setOrder(ids);
  }, [key]);

  const byId = new Map(items.map((unit) => [unit.id, unit]));
  const update = (next: string[]) => {
    orderRef.current = next;
    setOrder(next);
  };

  return (
    <Reorder.Group as="div" axis="y" values={order} onReorder={update} className="authoring-unit-reorder-list">
      {order.map((id) => {
        const unit = byId.get(id);
        if (!unit) return null;
        return (
          <SectionReorderItem key={id} unit={unit} disabled={disabled} onDragEnd={() => onOrder(orderRef.current)}>
            {(handle) => renderItem(unit, handle)}
          </SectionReorderItem>
        );
      })}
    </Reorder.Group>
  );
}

type OptimisticSourcePlacement = {
  targetUnitId?: string;
  hidden: boolean;
  order?: number;
  role?: string;
  relatedSourceId?: string | null;
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
  const [structureSaving, setStructureSaving] = useState(false);
  const [renamingUnitId, setRenamingUnitId] = useState<string>();
  const [renameValue, setRenameValue] = useState("");
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
              let document: MaterialDocument | undefined;
              let contentState: SourcePreview["contentState"] = "none";
              try {
                if (block?.currentRevisionId) {
                  const view = await readContentBlock(courseId, block.id, controller.signal);
                  if (view.revision) {
                    contentState = ["materialized", "reset"].includes(view.revision.kind) ? "raw" : "edited";
                  }
                }
              } catch {
                // Compact Explorer status is best effort; the selected View owns error reporting.
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
                  contentState,
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
      const next = current.filter((optimistic) => {
        const persisted = state.units.find((unit) => unit.id === optimistic.id);
        return !persisted || !sameUnitDraft(persisted, optimistic);
      });
      return next.length === current.length ? current : next;
    });
    setOptimisticPlacements((current) => {
      let changed = false;
      const next = { ...current };
      for (const [sourceId, optimistic] of Object.entries(current)) {
        const item = state.sources.find((candidate) => candidate.source.id === sourceId);
        if (!item) continue;
        const actual = sourcePlacement(state, item);
        const actualUse = currentUse(item);
        const placementConfirmed = optimistic.hidden
          ? actual.hidden
          : !actual.hidden && actual.currentUnitId === optimistic.targetUnitId;
        const mappingConfirmed = !optimistic.role || (
          actualUse?.role === optimistic.role
          && (actualUse.relatedSourceId ?? null) === (optimistic.relatedSourceId ?? null)
        );
        const confirmed = placementConfirmed && mappingConfirmed;
        if (confirmed) {
          delete next[sourceId];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [state.revision, state.sources, state.units]);

  const effectiveUnits = useMemo(() => {
    const overrides = new Map(optimisticUnits.map((unit) => [unit.id, unit]));
    const persisted = new Set(state.units.map((unit) => unit.id));
    return [
      ...state.units.map((unit) => overrides.get(unit.id) ?? unit),
      ...optimisticUnits.filter((unit) => !persisted.has(unit.id)),
    ];
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

  function effectiveUse(item: PipelineSourceView): SourceUse | undefined {
    const optimistic = optimisticPlacements[item.source.id];
    if (optimistic?.role && optimistic.targetUnitId) {
      return {
        unitId: optimistic.targetUnitId,
        role: optimistic.role,
        relatedSourceId: optimistic.relatedSourceId ?? null,
        order: optimistic.order ?? null,
      };
    }
    return currentUse(item);
  }

  const explorerUnits = useMemo(() => effectiveUnits, [effectiveUnits]);
  const scriptRoots = useMemo(
    () => explorerUnits
      .filter((unit) => unitKind(unit) === "script" && unit.parentId === null)
      .sort((a, b) => a.order - b.order),
    [explorerUnits],
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

  const scriptUnits = useMemo(() => explorerUnits
    .filter((unit) => unitKind(unit) === "script" && !unitHidden(unit, explorerUnits))
    .sort((a, b) => a.order - b.order), [explorerUnits]);

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

  async function saveMapping(
    item: PipelineSourceView,
    target: PipelineUnit | undefined,
    baseState = state,
    options: { role?: string; relatedSourceId?: string | null; order?: number } = {},
  ) {
    const role = target ? options.role ?? placementRole(item, target) : undefined;
    const mapping: MappingItem = target ? {
      sourceId: item.source.id,
      sourceVersion: item.source.sourceVersion,
      disposition: "use",
      uses: [{
        unitId: target.id,
        role: role!,
        relatedSourceId: role === "solution" ? options.relatedSourceId ?? currentUse(item)?.relatedSourceId ?? null : null,
        order: options.order ?? baseState.sources.filter((candidate) => sourcePlacement(baseState, candidate).currentUnitId === target.id).length,
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

  async function clearMapping(
    item: PipelineSourceView,
    baseState = state,
    reason = "Quellenzuordnung im Explorer zurückgesetzt.",
  ) {
    return api<PipelineState>(`${pipelinePath(courseId)}/mapping`, {
      method: "POST",
      body: JSON.stringify({
        expectedRevision: baseState.revision,
        items: [{
          sourceId: item.source.id,
          sourceVersion: item.source.sourceVersion,
          disposition: "clear",
          uses: [],
        }],
        actor: "user",
        reason,
      }),
    });
  }

  function setOptimisticStructure(units: PipelineUnit[]) {
    setOptimisticUnits(units);
  }

  async function saveStructureOptimistically(nextUnits: PipelineUnit[], deletedUnitIds: string[] = []) {
    if (structureSaving) return undefined;
    const previous = effectiveUnits;
    setOptimisticStructure(nextUnits);
    setStructureSaving(true);
    setMoveError("");
    try {
      const saved = await onSave(nextUnits, state.revision, deletedUnitIds);
      onState(saved);
      return saved;
    } catch (error) {
      setOptimisticStructure(previous);
      setMoveError(message(error));
      return undefined;
    } finally {
      setStructureSaving(false);
    }
  }

  function patchSection(unit: PipelineUnit, patch: Partial<PipelineUnit>) {
    const nextUnits = effectiveUnits.map((candidate) => candidate.id === unit.id ? { ...candidate, ...patch } : candidate);
    void saveStructureOptimistically(nextUnits);
  }

  function beginRenameSection(unit: PipelineUnit) {
    setRenamingUnitId(unit.id);
    setRenameValue(unitLabel(unit));
  }

  function commitRenameSection(unit: PipelineUnit) {
    const value = renameValue.trim();
    setRenamingUnitId(undefined);
    setRenameValue("");
    if (!value || value === unitLabel(unit)) return;
    patchSection(unit, { customTitle: value === unit.title ? null : value });
  }

  function reorderSectionSiblings(parentId: string | null, order: string[]) {
    const positions = new Map(order.map((id, index) => [id, index]));
    const nextUnits = effectiveUnits.map((unit) =>
      unitKind(unit) === "script" && unit.parentId === parentId && positions.has(unit.id)
        ? { ...unit, order: positions.get(unit.id)! }
        : unit,
    );
    void saveStructureOptimistically(nextUnits);
  }

  function originalSectionUnit(unit: PipelineUnit) {
    const suggested = unit.sourceGroupId != null
      ? state.suggestedUnits.find((candidate) => candidate.sourceGroupId === unit.sourceGroupId)
      : state.suggestedUnits.find((candidate) => candidate.id === unit.id);
    const group = unit.sourceGroupId != null ? state.groups.find((candidate) => candidate.id === unit.sourceGroupId) : undefined;
    const originalParent = group?.parentId != null
      ? effectiveUnits.find((candidate) => candidate.sourceGroupId === group.parentId && unitKind(candidate) === "script")
      : undefined;
    return {
      ...unit,
      title: suggested?.title ?? unit.title,
      customTitle: null,
      parentId: suggested?.parentId ?? originalParent?.id ?? (group?.parentId == null ? null : unit.parentId),
      order: suggested?.order ?? group?.order ?? unit.order,
      hidden: false,
      kind: "script" as const,
      scriptUnitIds: suggested?.scriptUnitIds ?? [],
    };
  }

  async function resetSection(unit: PipelineUnit) {
    if (structureSaving || movingSourceId || unit.sourceGroupId == null) return;
    const previousUnits = effectiveUnits;
    const previousPlacements = { ...optimisticPlacements };
    const resetUnit = originalSectionUnit(unit);
    const nextUnits = effectiveUnits.map((candidate) => candidate.id === unit.id ? resetUnit : candidate);
    const affected = state.sources.filter((item) => {
      const placement = effectivePlacement(item);
      return item.source.sectionId === unit.sourceGroupId || placement.currentUnitId === unit.id;
    });

    setOptimisticStructure(nextUnits);
    setOptimisticPlacements((current) => {
      const next = { ...current };
      for (const item of affected) {
        const original = nextUnits.find((candidate) => candidate.sourceGroupId === item.source.sectionId && unitKind(candidate) === "script");
        next[item.source.id] = original
          ? { targetUnitId: original.id, hidden: false }
          : { hidden: false };
      }
      return next;
    });
    setStructureSaving(true);
    setMoveError("");

    let structureSaved = false;
    try {
      let next = await onSave(nextUnits, state.revision);
      structureSaved = true;
      onState(next);
      if (affected.length) {
        const items: MappingItem[] = affected.map((item) => ({
          sourceId: item.source.id,
          sourceVersion: item.source.sourceVersion,
          disposition: "clear",
          uses: [],
        }));
        next = await api<PipelineState>(`${pipelinePath(courseId)}/mapping`, {
          method: "POST",
          body: JSON.stringify({
            expectedRevision: next.revision,
            items,
            actor: "user",
            reason: "Section im Explorer auf Quellstruktur zurückgesetzt.",
          }),
        });
        onState(next);
      }
    } catch (error) {
      if (!structureSaved) setOptimisticStructure(previousUnits);
      else setOptimisticStructure([]);
      setOptimisticPlacements(previousPlacements);
      setMoveError(message(error));
    } finally {
      setStructureSaving(false);
    }
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
    const taskTarget = unitKind(target) === "tasks";
    const taskPrimary = taskTarget && solutionLike(item)
      ? sourcesFor(target.id).filter(taskLike)
      : [];
    if (taskTarget && solutionLike(item) && taskPrimary.length !== 1) {
      setMoveError("Die Lösung braucht genau eine eindeutige Aufgabenquelle in diesem Task.");
      clearSourceDrag();
      return;
    }
    applyOptimisticPlacement(item, { targetUnitId: target.id, hidden: false, order: optimisticOrder });
    setMovingSourceId(item.source.id); setMoveError("");
    try {
      const options = taskTarget
        ? solutionLike(item)
          ? { role: "solution", relatedSourceId: taskPrimary[0].source.id, order: optimisticOrder }
          : { role: "task", order: optimisticOrder }
        : {};
      let next = await saveMapping(item, target, state, options);
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

  async function resetSource(item: PipelineSourceView) {
    if (disabled || movingSourceId) return;
    const placement = sourcePlacement(state, item);
    const previousTask = previousTaskFor(item);
    applyOptimisticPlacement(item, {
      targetUnitId: placement.defaultUnitId,
      hidden: false,
    });
    setMovingSourceId(item.source.id);
    setMoveError("");
    try {
      let next = await clearMapping(item);
      if (previousTask && previousTask.id !== placement.defaultUnitId) {
        next = await removeEmptyTask(previousTask.id, next);
      }
      onState(next);
      const resetItem = next.sources.find((candidate) => candidate.source.id === item.source.id) ?? item;
      onSelectSource(resetItem, sourcePlacement(next, resetItem).currentUnitId ?? undefined);
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

  function taskUnitForSource(sourceId: string, script: PipelineUnit) {
    return explorerUnits
      .filter((unit) => unitKind(unit) === "tasks" && (unit.scriptUnitIds ?? []).includes(script.id))
      .find((unit) => sourcesFor(unit.id).some((candidate) => candidate.source.id === sourceId));
  }

  function previousTaskFor(item: PipelineSourceView) {
    const unitId = sourcePlacement(state, item).currentUnitId;
    return unitId ? state.units.find((unit) => unit.id === unitId && unitKind(unit) === "tasks") : undefined;
  }

  async function moveToTasks(item: PipelineSourceView, script: PipelineUnit) {
    if (disabled || movingSourceId) return;

    const available = state.sources.filter((candidate) => candidate.source.present);
    const pairable = available.filter((candidate) => candidate.decision?.disposition !== "exclude");
    const solution = solutionLike(item);
    const primary = solution ? matchingTaskSource(item, pairable) : item;
    if (!primary) {
      setMoveError("Keine eindeutige Aufgabenquelle für " + item.source.name + " gefunden.");
      clearSourceDrag();
      return;
    }

    const pairedSolution = !solution && taskLike(primary)
      ? matchingSolutionSource(primary, pairable.filter((candidate) => {
          const use = currentUse(candidate);
          return !use || use.role === "task" || use.role === "solution";
        }))
      : undefined;
    const solutionSource = solution ? item : pairedSolution;
    const oldTasks = [primary, solutionSource]
      .filter((candidate): candidate is PipelineSourceView => !!candidate)
      .map(previousTaskFor)
      .filter((unit): unit is PipelineUnit => !!unit);

    let task = taskUnitForSource(primary.source.id, script);
    const created = !task;
    if (!task) task = createTaskUnit(primary, script);

    addOptimisticUnit(task);
    applyOptimisticPlacement(primary, { targetUnitId: task.id, hidden: false, order: 0 });
    if (solutionSource) applyOptimisticPlacement(solutionSource, { targetUnitId: task.id, hidden: false, order: 1 });

    setMovingSourceId(item.source.id);
    setMoveError("");
    try {
      let next = state;
      if (created) {
        next = await onSave([...state.units, task], state.revision);
        onState(next);
        task = next.units.find((unit) => unit.id === task!.id) ?? task;
      }

      const primaryPlacement = sourcePlacement(state, primary);
      const primaryUse = currentUse(primary);
      if (primaryPlacement.currentUnitId !== task.id || primaryUse?.role !== "task") {
        next = await saveMapping(primary, task, next, { role: "task", order: 0 });
      }

      if (solutionSource) {
        const currentSolution = next.sources.find((candidate) => candidate.source.id === solutionSource.source.id) ?? solutionSource;
        const solutionUse = currentUse(currentSolution);
        const solutionPlacement = sourcePlacement(next, currentSolution);
        if (
          solutionPlacement.currentUnitId !== task.id
          || solutionUse?.role !== "solution"
          || solutionUse.relatedSourceId !== primary.source.id
        ) {
          next = await saveMapping(solutionSource, task, next, {
            role: "solution",
            relatedSourceId: primary.source.id,
            order: 1,
          });
        }
      }

      for (const oldTask of oldTasks.filter((candidate) => candidate.id !== task!.id).filter((candidate, index, all) =>
        all.findIndex((unit) => unit.id === candidate.id) === index
      )) {
        next = await removeEmptyTask(oldTask.id, next);
      }

      onState(next);
      const selected = next.sources.find((candidate) => candidate.source.id === primary.source.id) ?? primary;
      onSelectSource(selected, task.id);
    } catch (error) {
      rollbackOptimisticPlacement(primary.source.id);
      if (solutionSource) rollbackOptimisticPlacement(solutionSource.source.id);
      if (created) rollbackOptimisticUnit(task.id);
      setMoveError(message(error));
    } finally {
      setMovingSourceId(undefined);
      clearSourceDrag();
    }
  }

  async function moveTaskToContent(task: PipelineUnit) {
    if (disabled || movingSourceId || movingTaskId) return;
    const owner = taskOwner(explorerUnits, task);
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
      const role = placementRole(item, target);
      const existing = currentUse(item);
      return [{
        sourceId: item.source.id,
        sourceVersion: item.source.sourceVersion,
        disposition: "use" as const,
        uses: [{
          unitId: target.id,
          role,
          relatedSourceId: role === "solution" ? existing?.relatedSourceId ?? null : null,
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
    if (targetKey.startsWith("solution:")) {
      const [, taskId, primarySourceId] = targetKey.split(":");
      const task = effectiveUnits.find((unit) => unit.id === taskId && unitKind(unit) === "tasks");
      const primary = state.sources.find((candidate) => candidate.source.id === primarySourceId);
      if (task && primary) await assignSolutionSource(primary, task, item);
      return;
    }
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
    const currentScript = current && unitKind(current) === "script" ? current : current ? taskOwner(explorerUnits, current) : undefined;
    return <>
      {currentScript && unitKind(current!) === "script" && <button type="button" onClick={() => void moveToTasks(item, currentScript)}><ListTodo size={13} aria-hidden="true" /><span>Move to Tasks</span></button>}
      {currentScript && current && unitKind(current) === "tasks" && <button type="button" onClick={() => void moveToUnit(item, currentScript)}><BookOpen size={13} aria-hidden="true" /><span>Move to Content</span></button>}
      {!placement.hidden && <button type="button" onClick={() => void moveToIgnored(item)}><EyeOff size={13} aria-hidden="true" /><span>Move to Ignored</span></button>}
      {(item.decision || optimisticPlacements[item.source.id]) && <button type="button" onClick={() => void resetSource(item)}><RotateCcw size={13} aria-hidden="true" /><span>Reset</span></button>}
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

  function renderSourceCard(item: PipelineSourceView, unitId?: string) {
    return (
      <SourceCard
        item={item}
        preview={previews[item.source.id]}
        selected={selection.kind === "source" && selection.id === item.source.id}
        onSelect={() => onSelectSource(item, unitId)}
        menu={sourceMenu(item)}
        moving={movingSourceId === item.source.id}
      />
    );
  }

  function solutionCandidatesFor(primary: PipelineSourceView) {
    return state.sources
      .filter((candidate) =>
        candidate.source.present
        && candidate.source.id !== primary.source.id
        && candidate.source.acquisition !== "unsupported"
      )
      .sort((left, right) => {
        const leftScore =
          (solutionLike(left) ? 0 : 4)
          + (left.source.sectionId === primary.source.sectionId ? 0 : 2)
          + (left.source.kind === "file" ? 0 : 1);
        const rightScore =
          (solutionLike(right) ? 0 : 4)
          + (right.source.sectionId === primary.source.sectionId ? 0 : 2)
          + (right.source.kind === "file" ? 0 : 1);
        return leftScore - rightScore || left.source.name.localeCompare(right.source.name);
      });
  }

  async function assignSolutionSource(
    primary: PipelineSourceView,
    task: PipelineUnit,
    solution: PipelineSourceView,
  ) {
    if (disabled || movingSourceId) return;
    if (solution.source.id === primary.source.id) {
      setMoveError("Eine Aufgabenquelle kann nicht ihre eigene Lösung sein.");
      return;
    }
    if (solution.source.acquisition === "unsupported") {
      setMoveError("Diese Quelle kann nicht als Lösung verwendet werden.");
      return;
    }

    const previousTask = previousTaskFor(solution);
    const existingSolution = sourcesFor(task.id).find((candidate) => {
      if (candidate.source.id === solution.source.id) return false;
      const use = effectiveUse(candidate);
      return use?.role === "solution" && use.relatedSourceId === primary.source.id;
    });
    const existingDefault = existingSolution ? sourcePlacement(state, existingSolution).defaultUnitId : undefined;

    applyOptimisticPlacement(solution, {
      targetUnitId: task.id,
      hidden: false,
      order: 1,
      role: "solution",
      relatedSourceId: primary.source.id,
    });
    if (existingSolution) {
      applyOptimisticPlacement(existingSolution, {
        targetUnitId: existingDefault,
        hidden: false,
      });
    }

    setMovingSourceId(solution.source.id);
    setMoveError("");
    try {
      const items: MappingItem[] = [{
        sourceId: solution.source.id,
        sourceVersion: solution.source.sourceVersion,
        disposition: "use",
        uses: [{
          unitId: task.id,
          role: "solution",
          relatedSourceId: primary.source.id,
          order: 1,
        }],
      }];
      if (existingSolution) {
        items.push({
          sourceId: existingSolution.source.id,
          sourceVersion: existingSolution.source.sourceVersion,
          disposition: "clear",
          uses: [],
        });
      }

      let next = await api<PipelineState>(`${pipelinePath(courseId)}/mapping`, {
        method: "POST",
        body: JSON.stringify({
          expectedRevision: state.revision,
          items,
          actor: "user",
          reason: "Lösungsquelle im Explorer zugeordnet.",
        }),
      });
      if (previousTask && previousTask.id !== task.id) {
        next = await removeEmptyTask(previousTask.id, next);
      }
      onState(next);
    } catch (error) {
      rollbackOptimisticPlacement(solution.source.id);
      if (existingSolution) rollbackOptimisticPlacement(existingSolution.source.id);
      setMoveError(message(error));
    } finally {
      setMovingSourceId(undefined);
    }
  }

  function renderTask(task: PipelineUnit, siblingTasks: PipelineUnit[]) {
    const sources = sourcesFor(task.id);
    const siblingEntries = siblingTasks.flatMap((unit) =>
      sourcesFor(unit.id).map((item) => ({ item, unit })),
    );
    const siblingSources = siblingEntries.map((entry) => entry.item);
    const primarySources = sources.filter(taskLike);

    if (primarySources.length === 0 && sources.length > 0 && sources.every(solutionLike)) {
      const pairedElsewhere = sources.every((solution) => !!matchingTaskSource(solution, siblingSources));
      if (pairedElsewhere) return null;
    }

    if (primarySources.length > 0) {
      const pairedIds = new Set<string>();
      return (
        <li
          className="authoring-task-item authoring-task-item-sources"
          key={task.id}
          data-source-drop-target={"task:" + task.id}
          data-drop-active={dropTarget === "task:" + task.id || undefined}
        >
          <div className="authoring-task-bundles">
            {primarySources.map((primary) => {
              const explicit = siblingEntries.find((entry) => {
                const use = effectiveUse(entry.item);
                return use?.role === "solution" && use.relatedSourceId === primary.source.id;
              });
              const matched = explicit?.item ?? matchingSolutionSource(primary, siblingSources);
              const solutionEntry = matched
                ? siblingEntries.find((entry) => entry.item.source.id === matched.source.id)
                : undefined;
              if (matched) pairedIds.add(matched.source.id);

              return (
                <div className="authoring-task-bundle" key={primary.source.id}>
                  {renderSourceCard(primary, task.id)}
                  <div
                    className="authoring-task-solution"
                    data-missing={!solutionEntry || undefined}
                    data-source-drop-target={"solution:" + task.id + ":" + primary.source.id}
                    data-drop-active={dropTarget === "solution:" + task.id + ":" + primary.source.id || undefined}
                  >
                    <span className="authoring-task-solution-icon"><CheckCheck size={13} aria-hidden="true" /></span>
                    <div className="authoring-task-solution-content">
                      {solutionEntry ? (
                        renderSourceCard(solutionEntry.item, solutionEntry.unit.id)
                      ) : (
                        <div className="authoring-task-solution-missing">
                          <span>Lösung fehlt</span>
                          <SolutionPicker
                            task={primary}
                            candidates={solutionCandidatesFor(primary)}
                            disabled={disabled || !!movingSourceId}
                            onPick={(solution) => void assignSolutionSource(primary, task, solution)}
                          />
                          <small>oder später erstellen</small>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {sources
              .filter((item) => !primarySources.some((primary) => primary.source.id === item.source.id))
              .filter((item) => !pairedIds.has(item.source.id))
              .map((item) => <div key={item.source.id} className="authoring-task-unpaired">{renderSourceCard(item, task.id)}</div>)}
          </div>
        </li>
      );
    }

    if (sources.length > 0) {
      return (
        <li
          className="authoring-task-item authoring-task-item-sources"
          key={task.id}
          data-source-drop-target={"task:" + task.id}
          data-drop-active={dropTarget === "task:" + task.id || undefined}
        >
          <ReorderSourceList
            items={sources}
            targetKey={"task:" + task.id}
            renderItem={(item) => renderSourceCard(item, task.id)}
            onDragStart={startSourceDrag}
            onDragMove={updateSourceDrag}
            onDragEnd={finishSourceDrag}
            disabled={disabled || !!movingSourceId}
          />
        </li>
      );
    }

    const owner = taskOwner(explorerUnits, task);
    return (
      <li
        className="authoring-task-item"
        key={task.id}
        data-moving={movingTaskId === task.id || undefined}
        data-source-drop-target={"task:" + task.id}
        data-drop-active={dropTarget === "task:" + task.id || undefined}
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
              <summary aria-label={"Aktionen für " + unitLabel(task)} title="Aktionen">
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

  function renderUnit(unit: PipelineUnit, depth = 0, dragHandle?: ReactNode) {
    const sources = sourcesFor(unit.id);
    const children = explorerUnits
      .filter((candidate) => candidate.parentId === unit.id && unitKind(candidate) === "script")
      .sort((a, b) => a.order - b.order);
    const tasks = explorerUnits
      .filter((candidate) => unitKind(candidate) === "tasks" && taskOwner(explorerUnits, candidate)?.id === unit.id)
      .sort((a, b) => a.order - b.order);
    const collapsed = collapsedUnits.has(unit.id);
    const tasksCollapsed = collapsedTasks.has(unit.id);
    const selected = selection.kind === "unit" && selection.id === unit.id;
    const hidden = unitHidden(unit, explorerUnits);
    const inheritedHidden = hidden && !unit.hidden;
    const renaming = renamingUnitId === unit.id;
    const controlsDisabled = disabled || structureSaving || !!movingSourceId;

    return (
      <section
        className="authoring-unit"
        data-depth={depth}
        data-hidden={hidden || undefined}
        data-drop-active={dropTarget === `content:${unit.id}` || undefined}
      >
        <div
          className="authoring-unit-heading"
          data-selected={selected || undefined}
          data-hidden={hidden || undefined}
          data-source-drop-target={`content:${unit.id}`}
        >
          {renaming ? (
            <div className="authoring-unit-rename">
              <span className="authoring-unit-rename-chevron">
                {collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
              </span>
              <input
                autoFocus
                value={renameValue}
                aria-label={`${unit.title} umbenennen`}
                onChange={(event) => setRenameValue(event.target.value)}
                onBlur={() => commitRenameSection(unit)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    setRenameValue(unitLabel(unit));
                    event.currentTarget.blur();
                  }
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              className="authoring-unit-toggle"
              aria-expanded={!collapsed && !hidden}
              onClick={() => toggleUnitCollapsed(unit.id)}
            >
              {collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
              <span>{unitLabel(unit)}</span>
              {hidden && <EyeOff className="authoring-unit-hidden-mark" size={12} aria-hidden="true" />}
            </button>
          )}
          {!hidden ? <button
            type="button"
            className="authoring-unit-view authoring-unit-control"
            aria-label={unitLabel(unit) + " öffnen"}
            title="Öffnen"
            onClick={() => onSelectUnit(unit)}
          >
            <ArrowUpRight size={14} aria-hidden="true" />
          </button> : <span className="authoring-unit-control-spacer" />}
          {dragHandle ?? <span className="authoring-unit-control-spacer" />}
          <SectionActions
            unit={unit}
            hidden={!!unit.hidden}
            resettable={unit.sourceGroupId != null}
            disabled={controlsDisabled}
            visibilityDisabled={inheritedHidden}
            onRename={() => beginRenameSection(unit)}
            onVisibility={() => patchSection(unit, { hidden: !unit.hidden })}
            onReset={() => void resetSection(unit)}
          />
        </div>

        {!collapsed && !hidden && <div className="authoring-unit-content" data-source-drop-target={`content:${unit.id}`}>
          <ReorderSourceList
            items={sources}
            targetKey={`content:${unit.id}`}
            renderItem={(item) => renderSourceCard(item, unit.id)}
            onDragStart={startSourceDrag}
            onDragMove={updateSourceDrag}
            onDragEnd={finishSourceDrag}
            disabled={disabled || !!movingSourceId}
          />
          <ReorderSectionList
            items={children}
            disabled={controlsDisabled}
            renderItem={(child, handle) => renderUnit(child, depth + 1, handle)}
            onOrder={(order) => reorderSectionSiblings(unit.id, order)}
          />
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
                  <ul>{tasks.map((task) => renderTask(task, tasks))}</ul>
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
          <ReorderSectionList
            items={scriptRoots}
            disabled={disabled || structureSaving || !!movingSourceId}
            renderItem={(unit, handle) => renderUnit(unit, 0, handle)}
            onOrder={(order) => reorderSectionSiblings(null, order)}
          />
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
                renderItem={(item) => renderSourceCard(item)}
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
