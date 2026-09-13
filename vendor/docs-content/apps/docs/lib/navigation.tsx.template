import { createElement } from 'react';
import type { Root, Node, Folder } from 'fumadocs-core/page-tree';
import type { LucideIcon } from 'lucide-react';
import {
  BadgeCheck, Blocks, BookCopy, BookOpen, BookOpenText, Box, CircleCheck, ClipboardCheck,
  Cloud, Code2, Database, FileJson, FileText, Files, FolderTree, GitBranch, GitPullRequestArrow,
  GraduationCap, House, Network, RefreshCw, Rocket, ScanSearch, SearchCheck, Server, Settings2,
  Share2, ShieldCheck, Target, Terminal, Workflow,
} from 'lucide-react';
import type { Manifest, NavNode, DocPage } from './content';
import { routeFor } from './content';

const icons: Record<string, LucideIcon> = {
  'badge-check': BadgeCheck, blocks: Blocks, 'book-copy': BookCopy, 'book-open': BookOpen,
  'book-open-text': BookOpenText, box: Box, 'circle-check': CircleCheck, 'clipboard-check': ClipboardCheck,
  cloud: Cloud, code: Code2, database: Database, 'file-json': FileJson, 'file-text': FileText, files: Files,
  'folder-tree': FolderTree, 'git-branch': GitBranch, 'git-pull-request-arrow': GitPullRequestArrow,
  'graduation-cap': GraduationCap, house: House, network: Network, 'refresh-cw': RefreshCw, rocket: Rocket,
  'scan-search': ScanSearch, 'search-check': SearchCheck, server: Server, 'settings-2': Settings2,
  'share-2': Share2, 'shield-check': ShieldCheck, target: Target, terminal: Terminal, workflow: Workflow,
};
const icon = (name?: string) => name && icons[name] ? createElement(icons[name], { 'aria-hidden': true }) : undefined;

export function navigationTree(manifest: Manifest): Root {
  const pages = new Map(manifest.pages.map(page => [page.slug, page]));
  const seen = new Set<string>();
  const pageNode = (page: DocPage, label?: string, iconName?: string): Node => {
    seen.add(page.slug);
    return { type: 'page', name: label ?? page.title, url: routeFor(manifest, page), icon: icon(iconName ?? (page.slug === 'project-readme' ? 'book-open' : 'file-text')) };
  };
  const visit = (item: NavNode): Node | undefined => {
    if (item.type === 'page') {
      const page = pages.get(item.slug);
      return page ? pageNode(page, item.label, item.icon) : undefined;
    }
    const children = item.children.map(visit).filter((node): node is Node => Boolean(node));
    if (!children.length) return undefined;
    return { type: 'folder', name: item.label, icon: icon(item.icon), defaultOpen: false, children } satisfies Folder;
  };
  const children = (manifest.navigation?.items ?? []).map(visit).filter((node): node is Node => Boolean(node));
  for (const page of manifest.pages) if (!seen.has(page.slug)) children.push(pageNode(page));
  return { $id: `${manifest.projectId}:${manifest.revision}`, name: manifest.title, children };
}
