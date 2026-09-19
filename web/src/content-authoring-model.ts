import { unitHidden, unitKind } from "./learning-structure";
import type { PipelineUnit } from "./pipeline-api";
import type { ContentBlockSummary, ContentPlacement } from "./content-api";

export type ContentUnitNode = {
  unit: PipelineUnit;
  blocks: ContentBlockSummary[];
  children: ContentUnitNode[];
  linkedScriptUnits: PipelineUnit[];
};

export type ContentTaskGroup = {
  id: string;
  scriptUnit?: PipelineUnit;
  tasks: ContentUnitNode[];
};

export type ContentOutline = {
  script: ContentUnitNode[];
  taskGroups: ContentTaskGroup[];
  unassignedBlocks: ContentBlockSummary[];
};

function primaryPlacement(block: ContentBlockSummary): ContentPlacement | undefined {
  return [...block.placements].sort((left, right) =>
    left.unitOrder - right.unitOrder || left.order - right.order,
  )[0];
}

function blockOrder(block: ContentBlockSummary, unitId: string) {
  const placement = block.placements
    .filter(candidate => candidate.unitId === unitId)
    .sort((left, right) => left.order - right.order)[0] ?? primaryPlacement(block);
  return placement?.order ?? Number.MAX_SAFE_INTEGER;
}

function buildNodes(
  kind: "script" | "tasks",
  units: PipelineUnit[],
  blocksByUnit: Map<string, ContentBlockSummary[]>,
  linkedScriptUnits: (unit: PipelineUnit) => PipelineUnit[],
): ContentUnitNode[] {
  const visible = units.filter(unit => unitKind(unit) === kind && !unitHidden(unit, units));
  const visibleIds = new Set(visible.map(unit => unit.id));
  const nodes = new Map<string, ContentUnitNode>();

  for (const unit of visible) {
    nodes.set(unit.id, {
      unit,
      blocks: [...(blocksByUnit.get(unit.id) ?? [])].sort((left, right) =>
        blockOrder(left, unit.id) - blockOrder(right, unit.id) || left.name.localeCompare(right.name),
      ),
      children: [],
      linkedScriptUnits: linkedScriptUnits(unit),
    });
  }

  const roots: ContentUnitNode[] = [];
  for (const unit of visible) {
    const node = nodes.get(unit.id)!;
    if (unit.parentId && visibleIds.has(unit.parentId)) nodes.get(unit.parentId)!.children.push(node);
    else roots.push(node);
  }

  const sortNodes = (items: ContentUnitNode[]) => {
    items.sort((left, right) => left.unit.order - right.unit.order || left.unit.title.localeCompare(right.unit.title));
    for (const item of items) sortNodes(item.children);
  };
  sortNodes(roots);
  return roots;
}

function flattenNodes(nodes: ContentUnitNode[]): ContentUnitNode[] {
  return nodes.flatMap(node => [node, ...flattenNodes(node.children)]);
}

function collectNodeBlocks(node: ContentUnitNode): ContentBlockSummary[] {
  return [...node.blocks, ...node.children.flatMap(collectNodeBlocks)];
}

function uniqueBlocks(blocks: ContentBlockSummary[]) {
  return [...new Map(blocks.map(block => [block.id, block])).values()];
}

export function contentBlocksForUnit(outline: ContentOutline, unitId: string): ContentBlockSummary[] {
  const scriptNode = flattenNodes(outline.script).find(node => node.unit.id === unitId);
  if (scriptNode) {
    const scriptIds = new Set(flattenNodes([scriptNode]).map(node => node.unit.id));
    const linkedTasks = outline.taskGroups
      .filter(group => group.scriptUnit && scriptIds.has(group.scriptUnit.id))
      .flatMap(group => group.tasks);
    return uniqueBlocks([
      ...collectNodeBlocks(scriptNode),
      ...linkedTasks.flatMap(collectNodeBlocks),
    ]);
  }

  const taskNode = outline.taskGroups
    .flatMap(group => flattenNodes(group.tasks))
    .find(node => node.unit.id === unitId);
  return taskNode ? uniqueBlocks(collectNodeBlocks(taskNode)) : [];
}

export function buildContentOutline(blocks: ContentBlockSummary[], units: PipelineUnit[]): ContentOutline {
  const included = blocks.filter(block => block.included);
  const visibleUnits = units.filter(unit => !unitHidden(unit, units));
  const visibleById = new Map(visibleUnits.map(unit => [unit.id, unit]));
  const visibleScript = visibleUnits.filter(unit => unitKind(unit) === "script");
  const visibleScriptById = new Map(visibleScript.map(unit => [unit.id, unit]));
  const blocksByUnit = new Map<string, ContentBlockSummary[]>();
  const unassignedBlocks: ContentBlockSummary[] = [];

  for (const block of included) {
    const placement = primaryPlacement(block);
    if (!placement || !visibleById.has(placement.unitId)) {
      unassignedBlocks.push(block);
      continue;
    }
    const assigned = blocksByUnit.get(placement.unitId) ?? [];
    assigned.push(block);
    blocksByUnit.set(placement.unitId, assigned);
  }

  const linkedScriptUnits = (unit: PipelineUnit) =>
    (unit.scriptUnitIds ?? [])
      .map(id => visibleScriptById.get(id))
      .filter((candidate): candidate is PipelineUnit => !!candidate);

  const script = buildNodes("script", units, blocksByUnit, () => []);
  const taskRoots = buildNodes("tasks", units, blocksByUnit, linkedScriptUnits);
  const taskGroups = new Map<string, ContentTaskGroup>();

  for (const task of taskRoots) {
    const primaryScript = task.linkedScriptUnits[0];
    const id = primaryScript?.id ?? "unassigned";
    const group = taskGroups.get(id) ?? { id, scriptUnit: primaryScript, tasks: [] };
    group.tasks.push(task);
    taskGroups.set(id, group);
  }

  const scriptOrder = new Map(flattenNodes(script).map((node, index) => [node.unit.id, index]));
  const orderedTaskGroups = [...taskGroups.values()].sort((left, right) => {
    if (!left.scriptUnit) return 1;
    if (!right.scriptUnit) return -1;
    return (scriptOrder.get(left.scriptUnit.id) ?? Number.MAX_SAFE_INTEGER) -
      (scriptOrder.get(right.scriptUnit.id) ?? Number.MAX_SAFE_INTEGER);
  });

  return { script, taskGroups: orderedTaskGroups, unassignedBlocks };
}
