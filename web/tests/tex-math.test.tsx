import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SafeMarkdown } from "../src/SafeMarkdown";

const render = (children: string) =>
  renderToStaticMarkup(createElement(SafeMarkdown, { children }));
const formulas = (html: string) => (html.match(/class="katex"/g) || []).length;

test("standard TeX delimiters render inline and display math alongside dollar math", () => {
  const html = render(
    String.raw`Inline: \(x^2\). Display: \[\frac{1}{2}\]. Existing: $a+b$.`,
  );
  expect(formulas(html)).toBe(3);
  expect(html).toContain('class="katex-display"');
  expect(html).toContain(
    '<annotation encoding="application/x-tex">\\frac{1}{2}</annotation>',
  );
  expect(html).not.toContain("katex-error");
});

test("TeX math owns its operators, line breaks and Markdown punctuation", () => {
  const html = render(String.raw`\[
\begin{pmatrix}1 & 2 \\ 3 & 4\end{pmatrix}
\]

\(a_i * b_j + \text{a < b}\)

> \(x^2\)

| Value | Formula |
| --- | --- |
| Half | \(\frac{1}{2}\) |`);
  expect(formulas(html)).toBe(4);
  expect(html).not.toContain("katex-error");
  expect(html).toContain("<table");
});

test("code examples and escaped literal delimiters stay literal", () => {
  const html = render(
    [
      "Inline code: `" + String.raw`\(x^2\)` + "`",
      "```tex\n" + String.raw`\[\frac{1}{2}\]` + "\n```",
      "~~~\n" + String.raw`\(x^2\)` + "\n~~~",
      "    " + String.raw`\(x^2\)`,
      String.raw`Escaped: \\(x^2\\) and \\[x^2\\].`,
    ].join("\n\n"),
  );
  expect(formulas(html)).toBe(0);
  expect(html).toContain(String.raw`\(x^2\)`);
  expect(html).toContain(String.raw`\[\frac{1}{2}\]`);
});

test("malformed delimiters recover without consuming a later formula", () => {
  for (const text of [
    String.raw`\(unclosed`,
    String.raw`\[unclosed`,
    String.raw`\(\)`,
    String.raw`\\(literal\\)`,
  ])
    expect(formulas(render(text))).toBe(0);
  expect(formulas(render(String.raw`\(unclosed then \(x^2\)`))).toBe(1);
});

test("TeX delimiters do not grant HTML, URL or media authority", () => {
  const html =
    render(String.raw`\(\href{https://external.example/action}{click}\)

\[\includegraphics{https://external.example/tracker.png}\]

\(\htmlClass{injected}{x}\)

[action](https://external.example/\(x\))

![tracker](https://external.example/\(x\).png)

<img src="https://external.example/tracker.png" onerror="alert(1)"><script>alert(1)</script>`);
  expect(html).not.toContain("<a ");
  expect(html).not.toContain("href=");
  expect(html).not.toContain("<img");
  expect(html).not.toContain("src=");
  expect(html).not.toContain("<script");
  expect(html).not.toContain('class="injected"');
});
