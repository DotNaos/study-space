import type { PipelineUnit } from "./pipeline-api";
import type { ContentBlockSummary } from "./content-api";

export type ContentUnitGroup = {
  unitId: string;
  unit?: PipelineUnit;
  blocks: ContentBlockSummary[];
};

export function groupContentBlocks(blocks: ContentBlockSummary[], units: PipelineUnit[]): ContentUnitGroup[] {
  const groups = new Map<string, ContentUnitGroup>();
  for (const block of blocks.filter(block => block.included)) {
    const first = [...block.placements].sort((left, right) => left.unitOrder - right.unitOrder || left.order - right.order)[0];
    const unitId = first?.unitId ?? "unassigned";
    const group = groups.get(unitId) ?? { unitId, unit: units.find(unit => unit.id === unitId), blocks: [] };
    group.blocks.push(block);
    groups.set(unitId, group);
  }
  return [...groups.values()]
    .sort((left, right) => {
      const leftOrder = Math.min(...left.blocks.flatMap(block => block.placements.map(placement => placement.unitOrder)), Number.MAX_SAFE_INTEGER);
      const rightOrder = Math.min(...right.blocks.flatMap(block => block.placements.map(placement => placement.unitOrder)), Number.MAX_SAFE_INTEGER);
      return leftOrder - rightOrder;
    })
    .map(group => ({
      ...group,
      blocks: [...group.blocks].sort((left, right) => {
        const leftPlacement = [...left.placements].sort((a,b) => a.unitOrder - b.unitOrder || a.order - b.order)[0];
        const rightPlacement = [...right.placements].sort((a,b) => a.unitOrder - b.unitOrder || a.order - b.order)[0];
        return (leftPlacement?.order ?? Number.MAX_SAFE_INTEGER) - (rightPlacement?.order ?? Number.MAX_SAFE_INTEGER) || left.name.localeCompare(right.name);
      }),
    }));
}
