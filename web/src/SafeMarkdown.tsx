import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkTexMath from "./remark-tex-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

// Model text has no navigation authority. Source buttons are rendered separately
// from validated document references; even relative links/images remain inert.
export function SafeMarkdown({ children }: { children: string }) {
  return (
    <div className="min-w-0 break-words text-sm leading-7 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-text-muted [&_code]:rounded [&_code]:bg-bg-1 [&_code]:px-1 [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-medium [&_h2]:my-4 [&_h2]:text-lg [&_h2]:font-medium [&_h3]:my-3 [&_h3]:font-medium [&_li]:pl-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-bg-1 [&_pre]:p-4 [&_table]:w-full [&_table]:text-left [&_td]:border-b [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_th]:border-b [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkMath, remarkTexMath]}
        rehypePlugins={[
          [
            rehypeKatex,
            { trust: false, strict: "warn", maxExpand: 1000, maxSize: 20 },
          ],
        ]}
        urlTransform={() => ""}
        components={{
          a: ({ children }) => <span>{children}</span>,
          img: ({ alt }) =>
            alt ? (
              <span className="text-text-muted">[Abbildung: {alt}]</span>
            ) : null,
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
