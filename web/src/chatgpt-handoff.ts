export type ChatGptHandoffBlock = {
  contentBlockId: string;
  editableRevision: string;
  sourceName: string;
  materialId: string;
  materialRevision?: string | null;
};

export type ChatGptHandoffContext = {
  courseId: number;
  courseName: string;
  scopeLabel: string;
  learningUnitId?: string;
  learningUnitTitle?: string;
  blocks: readonly ChatGptHandoffBlock[];
  page?: number | null;
  sourceBlockIds?: readonly string[];
  selectionText?: string;
  instruction: string;
};

export function buildChatGptHandoffPrompt(context: ChatGptHandoffContext) {
  const lines = [
    "Study Space edit request",
    "",
    `Course: ${context.courseName}`,
    `courseId: ${context.courseId}`,
    `scope: ${context.scopeLabel}`,
  ];
  if (context.learningUnitId) lines.push(`learningUnitId: ${context.learningUnitId}`);
  if (context.learningUnitTitle) lines.push(`learningUnit: ${context.learningUnitTitle}`);

  for (const [index, block] of context.blocks.entries()) {
    lines.push(
      "",
      context.blocks.length === 1 ? "Editable block:" : `Editable block ${index + 1}:`,
      `contentBlockId: ${block.contentBlockId}`,
      `editableRevision: ${block.editableRevision}`,
      `Source: ${block.sourceName}`,
      `materialId: ${block.materialId}`,
    );
    if (block.materialRevision) lines.push(`materialRevision: ${block.materialRevision}`);
  }

  if (context.page) lines.push("", `page: ${context.page}`);
  if (context.sourceBlockIds?.length) lines.push(`sourceBlocks: ${context.sourceBlockIds.join(", ")}`);
  if (context.selectionText?.trim()) lines.push("", "Current selection:", context.selectionText.trim());
  lines.push(
    "",
    "User instruction:",
    context.instruction.trim(),
    "",
    "Use the Study Space tools to load every current content block listed in this scope before editing.",
    "Edit only the listed editable MDX blocks, using optimistic revision checking for each block.",
    "Preserve immutable source/extraction data and provenance. Use the whole selected scope as context, even when only some blocks need changes.",
  );
  return lines.join("\n");
}

/**
 * ChatGPT browser prompt-prefill is deliberately isolated here because this URL
 * surface is not the Study Space editing contract. Stable IDs in the prompt are.
 */
export function buildChatGptHandoffUrl(prompt: string) {
  const url = new URL("https://chatgpt.com/");
  url.searchParams.set("prompt", prompt);
  return url.toString();
}
