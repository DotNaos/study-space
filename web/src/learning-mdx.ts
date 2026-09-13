export type LearningComponent = {
  name: "Figure" | "TaskRef";
  attributes: Record<string, string>;
};

export function parseLearningComponent(
  text: string,
): LearningComponent | undefined {
  const match = /^<(Figure|TaskRef)\s+([^<>]*)\/\s*>$/.exec(text.trim());
  if (!match) return;
  const attributes: Record<string, string> = Object.create(null);
  let cursor = 0;
  for (const attribute of match[2].matchAll(
    /([A-Za-z][A-Za-z0-9]*)\s*=\s*"([^"<>\r\n{}&]*)"/g,
  )) {
    if (
      match[2].slice(cursor, attribute.index).trim() ||
      attribute[1] in attributes
    )
      return;
    attributes[attribute[1]] = attribute[2];
    cursor = attribute.index! + attribute[0].length;
  }
  if (match[2].slice(cursor).trim()) return;
  const allowed =
    match[1] === "Figure"
      ? ["materialId", "revision", "assetId", "alt"]
      : ["id"];
  if (
    Object.keys(attributes).some((key) => !allowed.includes(key)) ||
    allowed.some((key) => !(key in attributes))
  )
    return;
  if (
    match[1] === "Figure" &&
    (!/^[a-f0-9]{64}$/.test(attributes.materialId) ||
      !/^[a-f0-9]{64}$/.test(attributes.revision) ||
      !/^[a-z0-9-]{1,80}$/.test(attributes.assetId) ||
      !attributes.alt.trim())
  )
    return;
  if (match[1] === "TaskRef" && !/^[a-f0-9]{32,64}$/.test(attributes.id))
    return;
  return { name: match[1] as LearningComponent["name"], attributes };
}

type Node = {
  type: string;
  value?: string;
  children?: Node[];
  data?: Record<string, unknown>;
};
// Transform only our two validated literal components to inert React-rendered elements.
// All other raw HTML remains subject to react-markdown's existing skipHtml restriction.
export default function remarkLearningMdx() {
  return (tree: Node) => {
    for (const node of tree.children ?? []) {
      if (node.type !== "html" || !node.value) continue;
      const component = parseLearningComponent(node.value);
      if (!component) continue;
      node.type = "paragraph";
      node.value = undefined;
      node.children = [];
      node.data = {
        hName: component.name === "Figure" ? "study-figure" : "study-task",
        hProperties: component.attributes,
      };
    }
  };
}
