export type ChatGptHandoffContext = {
  courseId: number;
  courseName: string;
  learningUnitId?: string;
  learningUnitTitle?: string;
  contentBlockId: string;
  editableRevision: string;
  sourceName: string;
  materialId: string;
  materialRevision?: string | null;
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
  ];
  if (context.learningUnitId) lines.push(`learningUnitId: ${context.learningUnitId}`);
  if (context.learningUnitTitle) lines.push(`learningUnit: ${context.learningUnitTitle}`);
  lines.push(
    `contentBlockId: ${context.contentBlockId}`,
    `editableRevision: ${context.editableRevision}`,
    "",
    `Source: ${context.sourceName}`,
    `materialId: ${context.materialId}`,
  );
  if (context.materialRevision) lines.push(`materialRevision: ${context.materialRevision}`);
  if (context.page) lines.push(`page: ${context.page}`);
  if (context.sourceBlockIds?.length) lines.push(`sourceBlocks: ${context.sourceBlockIds.join(", ")}`);
  if (context.selectionText?.trim()) lines.push("", "Current selection:", context.selectionText.trim());
  lines.push(
    "",
    "User instruction:",
    context.instruction.trim(),
    "",
    "Use the Study Space tools to load the current content block and its current revision before editing.",
    "Write only to the editable MDX layer with optimistic revision checking. Preserve the immutable source/extraction and its provenance.",
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
