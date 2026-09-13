import { isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import { renderMermaidSVG } from 'beautiful-mermaid';
import Link from 'next/link';
import type { DocPage, Manifest } from '../lib/content';
import { mapLink, markdownBody } from '../lib/content';

function Mermaid({ chart }: { chart: string }) {
  try {
    const svg = renderMermaidSVG(chart, { bg: 'var(--color-fd-background)', fg: 'var(--color-fd-foreground)', interactive: true, transparent: true });
    return <div aria-label="Documentation diagram" className="my-6 overflow-x-auto rounded-lg border bg-fd-card p-4 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} role="img" />;
  } catch { return <pre><code className="language-mermaid">{chart}</code></pre>; }
}

export function Markdown({ text, page, manifest }: { text: string; page: DocPage; manifest: Manifest }) {
  return <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]}
    urlTransform={(url, key) => mapLink(url, page, manifest, key === 'src') ?? ''}
    components={{
      a: ({ href, children }) => href ? href.startsWith('/') && !href.startsWith('/docs-content/') ? <Link href={href}>{children}</Link> : <a href={href} rel="noreferrer" target={href.startsWith('#') ? undefined : '_blank'}>{children}</a> : <span>{children}</span>,
      img: ({ src, alt }) => typeof src === 'string' && src ? <img src={src} alt={alt ?? ''} loading="lazy" /> : <span>{alt ?? 'Image unavailable'}</span>, // eslint-disable-line @next/next/no-img-element
      pre: ({ children }) => {
        const child = Array.isArray(children) ? children[0] : children;
        if (isValidElement<{ className?: string; children?: ReactNode }>(child) && child.props.className === 'language-mermaid') return <Mermaid chart={String(child.props.children ?? '').replace(/\n$/, '')} />;
        return <pre>{children}</pre>;
      },
      table: ({ children }) => <div className="overflow-x-auto"><table>{children}</table></div>,
    }}>{markdownBody(text)}</ReactMarkdown>;
}
