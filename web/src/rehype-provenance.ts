import {
  mappingLabels,
  matchingRanges,
  type ScriptRange,
} from "./script-provenance";

type TreeNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: TreeNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};
export type ProvenanceMarkup = {
  markdown: string;
  ranges: ScriptRange[];
  selectedId?: string;
};

export default function rehypeProvenance(options?: ProvenanceMarkup) {
  return (tree: TreeNode) => {
    if (!options) return;
    function properties(ranges: ScriptRange[]) {
      const range = ranges.find((r) => r.state !== "source") ?? ranges[0];
      if (!range) return {};
      const mixed = new Set(ranges.map((r) => r.state)).size > 1;
      return {
        "data-map-id": range.id,
        "data-map-state": mixed ? "mixed" : range.state,
        "data-map-active": ranges.some((r) => r.id === options!.selectedId)
          ? "true"
          : undefined,
        className: ["script-map-mark"],
        title: mixed ? "Teilweise zugeordnet" : mappingLabels[range.state],
        tabIndex: 0,
        role: "button",
        "aria-label": mixed
          ? "Textstelle: teilweise zugeordnet"
          : `Textstelle: ${mappingLabels[range.state]}`,
      };
    }
    function visit(parent: TreeNode) {
      if (!parent.children) return;
      parent.children = parent.children.flatMap((node) => {
        const start = node.position?.start.offset,
          end = node.position?.end.offset;
        if (start === undefined || end === undefined) {
          visit(node);
          return [node];
        }
        const ranges = matchingRanges(options!.ranges, start, end);
        if (node.type === "text" && node.value?.trim() && ranges.length) {
          if (options!.markdown.slice(start, end) !== node.value)
            return [
              {
                type: "element",
                tagName: "span",
                properties: properties(ranges),
                children: [node],
              },
            ];
          const points = [
            ...new Set([
              start,
              end,
              ...ranges.flatMap((r) => [
                Math.max(start, r.start),
                Math.min(end, r.end),
              ]),
            ]),
          ].sort((a, b) => a - b);
          return points.slice(0, -1).map((from, i) => {
            const to = points[i + 1],
              value = node.value!.slice(from - start, to - start);
            return value.trim()
              ? {
                  type: "element",
                  tagName: "span",
                  properties: properties(matchingRanges(ranges, from, to)),
                  children: [{ type: "text", value }],
                }
              : { type: "text", value };
          });
        }
        if (
          node.type === "element" &&
          ["code", "pre", "img"].includes(node.tagName || "") &&
          ranges.length
        ) {
          return [
            {
              type: "element",
              tagName: node.tagName === "pre" ? "div" : "span",
              properties: properties(ranges),
              children: [node],
            },
          ];
        }
        visit(node);
        return [node];
      });
    }
    visit(tree);
  };
}
