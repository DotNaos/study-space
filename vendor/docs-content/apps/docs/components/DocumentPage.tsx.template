import { notFound } from 'next/navigation';
import { DocsBody, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { ExternalLink } from 'lucide-react';
import { getDocumentation, project, type DocPage } from '../lib/content';
import { Markdown } from './Markdown';

export async function DocumentPage({ slug }: { slug?: string }) {
  const { manifest, files } = await getDocumentation();
  const page = manifest.pages.find(candidate => candidate.slug === (slug ?? manifest.entrypoint ?? manifest.pages[0]?.slug));
  if (!page) notFound();
  const source = files.get(page.contentPath);
  if (!source) notFound();
  const text = new TextDecoder().decode(source);
  return <DocsPage toc={[]} tableOfContent={{ enabled: false }} tableOfContentPopover={{ enabled: false }} breadcrumb={{ enabled: Boolean(slug) }}>
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <DocsTitle>{page.title}</DocsTitle>
      <div className="flex items-center gap-3 text-xs text-fd-muted-foreground">
        <a className="inline-flex items-center gap-1 hover:text-fd-foreground" href={page.sourceUrl} rel="noreferrer" target="_blank">Source <ExternalLink className="size-3" /></a>
        <a className="inline-flex items-center gap-1 hover:text-fd-foreground" href={project.architectureUrl} rel="noreferrer">Architecture</a>
      </div>
    </header>
    <DocsBody className="docs-project-content">
      {page.format === 'unsupported-mdx' ? <div className="rounded-lg border p-4 text-sm text-fd-muted-foreground">This page uses MDX and is intentionally not executed here. Open the source to inspect it safely.</div> : <Markdown text={text} page={page} manifest={manifest} />}
    </DocsBody>
  </DocsPage>;
}

export async function params() {
  const { manifest } = await getDocumentation();
  return manifest.pages.filter(page => page.slug !== manifest.entrypoint).map((page: DocPage) => ({ slug: page.slug.split('/') }));
}
