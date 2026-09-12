import { memo, useEffect, useRef } from "react";
import { Button, Icon } from "@dotnaos/ui-base";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { kindLabel, type TraceNode } from "./content-graph";
import type { TraceBox } from "./content-graph-layout";

export type GroupFlowNode = Node<
  {
    box: TraceBox;
    selectedId?: string;
    relatedIds: Set<string>;
    onChoose: (id: string) => void;
  },
  "contentGroup"
>;
export type ClusterFlowNode = Node<{ title: string }, "cluster">;
export type FlowNode = GroupFlowNode | ClusterFlowNode;

function iconFor(item: TraceNode) {
  return item.kind === "section"
    ? "folder-open"
    : item.kind === "activity"
      ? "app-window"
      : item.kind === "chapter"
        ? "list"
        : item.kind === "exercise"
          ? "pencil-line"
          : "file-text";
}

const ContentGroupNode = memo(function ContentGroupNode({
  data,
}: NodeProps<GroupFlowNode>) {
  const { box, selectedId, relatedIds, onChoose } = data;
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = list.current;
    const row = Array.from(
      container?.querySelectorAll<HTMLElement>("[data-trace-id]") || [],
    ).find((element) => element.dataset.traceId === selectedId);
    if (!container || !row) return;
    // Scroll only the list body. Never move the browser page or change the graph.
    const top = row.offsetTop;
    if (top < container.scrollTop) container.scrollTop = top;
    else if (
      top + row.offsetHeight >
      container.scrollTop + container.clientHeight
    )
      container.scrollTop = top + row.offsetHeight - container.clientHeight;
  }, [selectedId]);

  if (box.kind === "section") {
    const root = box.rows[0]?.item;
    return (
      <div
        className="study-trace-root"
        style={{ width: box.width, height: box.height }}
      >
        {root ? (
          <div
            data-trace-id={root.id}
            data-selected={root.id === selectedId}
            className="study-trace-root-action nodrag"
          >
            <Button
              variant="ghost"
              icon="folder-open"
              size="sm"
              label={root.title}
              accessibilityLabel={`${kindLabel[root.kind]}: ${root.title}`}
              title={root.title}
              onPress={() => onChoose(root.id)}
            />
            <span className="study-trace-root-subtitle">{root.subtitle}</span>
          </div>
        ) : (
          <div className="study-trace-root-fallback">
            <Icon name="folder-open" size="m" />
            <span>{box.title}</span>
          </div>
        )}
        <Handle type="source" position={Position.Right} isConnectable={false} />
      </div>
    );
  }
  const icon =
    box.kind === "chapters"
      ? "list"
      : box.kind === "exercises"
        ? "pencil-line"
        : box.kind === "moodle"
          ? "folder-open"
          : "file-text";
  return (
    <div
      className="study-trace-group"
      style={{ width: box.width, height: box.height }}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <header className="study-trace-group-header">
        <Icon name={icon} size="m" />
        <span>{box.title}</span>
        <small>{box.rows.length}</small>
      </header>
      <div
        ref={list}
        role="list"
        aria-label={`${box.title}: ${box.rows.length} Einträge`}
        className="study-trace-group-body nodrag nopan nowheel"
        tabIndex={0}
      >
        {box.rows.map(({ item, depth }) => (
          <div
            key={item.id}
            role="listitem"
            className={`study-trace-row${depth ? " is-nested" : ""}`}
            data-trace-id={item.id}
            data-selected={item.id === selectedId}
            data-related={relatedIds.has(item.id)}
          >
            <Button
              variant="ghost"
              size="sm"
              icon={iconFor(item)}
              label={item.title}
              accessibilityLabel={`${kindLabel[item.kind]}: ${item.title}${item.notice ? `. ${item.notice}` : ""}`}
              title={`${item.title}\n${item.subtitle}${item.notice ? `\n${item.notice}` : ""}`}
              onPress={() => onChoose(item.id)}
            />
            {item.notice && (
              <span className="study-trace-row-warning" title={item.notice}>
                <Icon name="alert-triangle" size="s" />
                <span className="sr-only">{item.notice}</span>
              </span>
            )}
          </div>
        ))}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
});

const ClusterNode = memo(function ClusterNode() {
  return <div className="study-trace-cluster" />;
});

export const contentGraphNodeTypes = {
  contentGroup: ContentGroupNode,
  cluster: ClusterNode,
};
