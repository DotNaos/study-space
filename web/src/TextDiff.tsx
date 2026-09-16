import "./text-diff.css";
import { useMemo } from "react";

export type TextDiffMode = "inline" | "split";

type DiffLine = {
  kind: "equal" | "add" | "remove";
  text: string;
  beforeLine?: number;
  afterLine?: number;
};

type SplitRow = {
  before?: DiffLine;
  after?: DiffLine;
};

function sourceLines(value: string) {
  if (!value) return [];
  const lines = value.replaceAll("\r\n", "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function buildDiff(before: string, after: string): DiffLine[] {
  const left = sourceLines(before);
  const right = sourceLines(after);
  const table = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i] === right[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let beforeLine = 1;
  let afterLine = 1;

  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      result.push({ kind: "equal", text: left[i], beforeLine, afterLine });
      i += 1;
      j += 1;
      beforeLine += 1;
      afterLine += 1;
      continue;
    }

    if (j < right.length && (i === left.length || table[i][j + 1] >= table[i + 1][j])) {
      result.push({ kind: "add", text: right[j], afterLine });
      j += 1;
      afterLine += 1;
      continue;
    }

    result.push({ kind: "remove", text: left[i], beforeLine });
    i += 1;
    beforeLine += 1;
  }

  return result;
}

function splitRows(lines: DiffLine[]) {
  const rows: SplitRow[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line.kind === "equal") {
      rows.push({ before: line, after: line });
      index += 1;
      continue;
    }

    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (index < lines.length && lines[index].kind !== "equal") {
      if (lines[index].kind === "remove") removed.push(lines[index]);
      else added.push(lines[index]);
      index += 1;
    }

    const count = Math.max(removed.length, added.length);
    for (let row = 0; row < count; row += 1) rows.push({ before: removed[row], after: added[row] });
  }

  return rows;
}

function DiffCell({ line, side }: { line?: DiffLine; side: "before" | "after" }) {
  const number = side === "before" ? line?.beforeLine : line?.afterLine;
  const prefix = !line ? "" : line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";
  return <div className="text-diff-cell" data-side={side} data-kind={line?.kind ?? "empty"}>
    <span className="text-diff-line-number">{number ?? ""}</span>
    <span className="text-diff-prefix" aria-hidden="true">{prefix}</span>
    <code>{line?.text || " "}</code>
  </div>;
}

export function TextDiff({
  before,
  after,
  mode,
  beforeLabel = "Raw",
  afterLabel = "Bearbeitet",
  mobileSide = "before",
}: {
  before: string;
  after: string;
  mode: TextDiffMode;
  beforeLabel?: string;
  afterLabel?: string;
  mobileSide?: "before" | "after";
}) {
  const lines = useMemo(() => buildDiff(before, after), [before, after]);
  const rows = useMemo(() => splitRows(lines), [lines]);

  if (mode === "inline") return <div className="text-diff text-diff-inline" aria-label={`${beforeLabel} zu ${afterLabel} Diff`}>
    <div className="text-diff-header"><span>- {beforeLabel}</span><span>+ {afterLabel}</span></div>
    <div className="text-diff-body">
      {lines.map((line, index) => <div className="text-diff-inline-row" data-kind={line.kind} key={`${index}-${line.beforeLine ?? ""}-${line.afterLine ?? ""}`}>
        <span className="text-diff-line-number">{line.beforeLine ?? ""}</span>
        <span className="text-diff-line-number">{line.afterLine ?? ""}</span>
        <span className="text-diff-prefix" aria-hidden="true">{line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}</span>
        <code>{line.text || " "}</code>
      </div>)}
    </div>
  </div>;

  return <div className="text-diff text-diff-split" data-mobile-side={mobileSide} aria-label={`${beforeLabel} zu ${afterLabel} Diff`}>
    <div className="text-diff-split-header">
      <span data-side="before">{beforeLabel}</span>
      <span data-side="after">{afterLabel}</span>
    </div>
    <div className="text-diff-body">
      {rows.map((row, index) => <div className="text-diff-split-row" key={`${index}-${row.before?.beforeLine ?? ""}-${row.after?.afterLine ?? ""}`}>
        <DiffCell line={row.before} side="before"/>
        <DiffCell line={row.after} side="after"/>
      </div>)}
    </div>
  </div>;
}
