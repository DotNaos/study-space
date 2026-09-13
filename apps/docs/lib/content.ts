import { cache } from 'react';
import { resolve } from 'node:path';
// @ts-expect-error docs.content is a dependency-free generated JavaScript module.
import { exportDocs } from '../../../scripts/docs-content.mjs';

export interface DocPage { slug: string; title: string; sourcePath: string; sourceUrl: string; contentPath: string; format: 'markdown' | 'unsupported-mdx'; sha256: string }
export interface DocAsset { sourcePath: string; contentPath: string; sha256: string }
export interface NavPage { type: 'page'; slug: string; label?: string; icon?: string }
export interface NavGroup { type: 'group'; label: string; icon?: string; children: NavNode[] }
export type NavNode = NavPage | NavGroup;
export interface Manifest { schemaVersion: 1; projectId: string; title: string; revision: string; repositoryUrl: string; entrypoint?: string; pages: DocPage[]; assets: DocAsset[]; navigation?: { version: 1; items: NavNode[] } }
export interface DocumentationExport { manifest: Manifest; files: Map<string, Uint8Array> }

const root = resolve(process.cwd(), '../..');
export const project = {
  id: 'study-space',
  title: 'Study Space',
  repositoryUrl: 'https://github.com/DotNaos/study-space',
  architectureUrl: 'https://architecture.os-pc.vpn.os-home.net/project-docs/study-space',
};

export const getDocumentation = cache(async (): Promise<DocumentationExport> => {
  const revision = process.env.DOCS_CONTENT_REVISION;
  return exportDocs({
    root,
    projectId: project.id,
    title: project.title,
    repositoryUrl: project.repositoryUrl,
    production: Boolean(revision),
    revision,
  }) as Promise<DocumentationExport>;
});

export function routeFor(manifest: Manifest, page: DocPage) {
  return page.slug === manifest.entrypoint ? '/' : `/${page.slug}`;
}

function safeExternal(value: string) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    if ([...url.searchParams.keys()].some(key => /token|secret|password|credential|signature|api[-_]?key|authorization/i.test(key))) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function mapLink(raw: string, page: DocPage, manifest: Manifest, image = false): string | undefined {
  if (!raw || /[\u0000-\u0020\u007f\\]/.test(raw) || raw.startsWith('//')) return undefined;
  if (raw.startsWith('#')) return image ? undefined : raw;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return image ? undefined : safeExternal(raw);
  let decoded: string;
  try { decoded = decodeURIComponent(raw); } catch { return undefined; }
  if (/[?\\\u0000-\u001f]/.test(decoded) || /%[0-9a-f]{2}/i.test(decoded)) return undefined;
  const [path, fragment] = decoded.split('#');
  const segments = path.startsWith('/') ? [] : page.sourcePath.split('/').slice(0, -1);
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!segments.length) return undefined; segments.pop(); }
    else segments.push(part);
  }
  const sourcePath = segments.join('/');
  const suffix = fragment ? `#${encodeURIComponent(fragment)}` : '';
  const target = manifest.pages.find(candidate => candidate.sourcePath === sourcePath);
  if (target && !image) return routeFor(manifest, target) + suffix;
  const asset = manifest.assets.find(candidate => candidate.sourcePath === sourcePath);
  if (asset) return `/docs-content/${asset.contentPath.split('/').map(encodeURIComponent).join('/')}`;
  if (image || !sourcePath) return undefined;
  return `${manifest.repositoryUrl}/blob/${manifest.revision === 'development' ? 'main' : manifest.revision}/${sourcePath.split('/').map(encodeURIComponent).join('/')}${suffix}`;
}

export const markdownBody = (text: string) => text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
