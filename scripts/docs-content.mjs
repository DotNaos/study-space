// Canonical owner: Project Template docs.content module. Update through module sync.
import { lstat, readdir, readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const images = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']);
const markdown = new Set(['.md', '.markdown', '.mdx']);
export function safePath(value) {
  return typeof value === 'string' && value.length <= 512 && /^[a-zA-Z0-9_ /.-]+$/.test(value)
    && value.split('/').every(part => part && !part.startsWith('.') && part.trim() === part);
}
export function exactOrigin(value) {
  if (value === '') return value;
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.origin !== value || url.username || url.password) throw new Error('Expected exact docs reader origin');
  return value;
}
function repository(value) {
  if (!/^https:\/\/github\.com\/[\w-]+\/[\w.-]+$/.test(value)) throw new Error('Expected GitHub repository URL without credentials or query');
  return value;
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function pageTitle(text, fallback) {
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const title = frontmatter?.[1].match(/^title:\s*(.+)$/m)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
  return title || text.slice(frontmatter?.[0].length ?? 0).match(/^#\s+(.+?)\s*#*\s*$/m)?.[1] || fallback;
}
export async function exportDocs({ root, projectId, title, repositoryUrl, production = false, revision }) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(projectId) || !title?.trim()) throw new Error('Invalid documentation project identity');
  repository(repositoryUrl);
  root = resolve(root);
  revision ??= production ? process.env.DOCS_CONTENT_REVISION || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() : 'development';
  if (!(production ? /^[a-f0-9]{40}$/.test(revision) : revision === 'development' || /^[a-f0-9]{40}$/.test(revision))) throw new Error('Production docs require exact source SHA');
  // A checkout must prove that exported bytes belong to the named commit. Git-less
  // release archives rely on the exact-commit build argument supplied by their pipeline.
  let committedFiles;
  if (production && await lstat(join(root, '.git')).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) {
    const commit = execFileSync('git', ['rev-parse', '--verify', `${revision}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
    if (commit !== revision) throw new Error('Documentation revision must identify an exact commit');
    const entries = execFileSync('git', ['ls-tree', '-rz', revision, '--', 'docs'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    committedFiles = new Map();
    for (const entry of entries) {
      const [metadata, path] = entry.split('\t');
      const [mode, type, objectId] = metadata.split(' ');
      if (mode === '120000') throw new Error('Symlink in committed docs');
      if (type === 'blob' && (markdown.has(extname(path).toLowerCase()) || images.has(extname(path).toLowerCase()))) committedFiles.set(path, objectId);
    }
  }
  const manifest = { schemaVersion: 1, projectId, title, revision, repositoryUrl, pages: [], assets: [] };
  const files = new Map();
  async function walk(directory, prefix = '') {
    const info = await lstat(directory).catch(error => { if (error.code === 'ENOENT' && !prefix) return null; throw error; });
    if (!info) return;
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Docs directory must be a regular directory');
    for (const name of (await readdir(directory)).sort()) {
      const relative = prefix + name;
      const path = join(directory, name);
      const entry = await lstat(path);
      if (entry.isSymbolicLink()) throw new Error(`Symlink in docs: ${relative}`);
      if (!safePath(relative)) throw new Error(`Unsafe docs path: ${relative}`);
      if (entry.isDirectory()) { await walk(path, relative + '/'); continue; }
      if (!entry.isFile()) throw new Error('Docs may only contain regular files');
      const extension = extname(name).toLowerCase();
      if (!markdown.has(extension) && !images.has(extension)) continue;
      if (entry.size > 2 * 1024 * 1024) throw new Error(`Docs file exceeds 2 MiB: ${relative}`);
      const bytes = await readFile(path);
      const sourcePath = `docs/${relative}`;
      const contentPath = `${markdown.has(extension) ? 'pages' : 'assets'}/${relative}`;
      if (committedFiles) {
        const objectId = committedFiles.get(sourcePath);
        if (!objectId || !execFileSync('git', ['cat-file', 'blob', objectId], { cwd: root, maxBuffer: 2 * 1024 * 1024 }).equals(bytes)) throw new Error(`Docs differ from production revision: ${sourcePath}`);
        committedFiles.delete(sourcePath);
      }
      files.set(contentPath, bytes);
      if (markdown.has(extension)) manifest.pages.push({
        slug: relative.slice(0, -extension.length), title: pageTitle(bytes.toString('utf8'), name), sourcePath,
        sourceUrl: `${repositoryUrl}/blob/${revision === 'development' ? 'main' : revision}/${sourcePath.split('/').map(encodeURIComponent).join('/')}`,
        contentPath, format: extension === '.mdx' ? 'unsupported-mdx' : 'markdown', sha256: digest(bytes),
      });
      else manifest.assets.push({ sourcePath, contentPath, sha256: digest(bytes) });
    }
  }
  await walk(join(root, 'docs'));
  if (committedFiles?.size) throw new Error('Docs removed from production revision');
  const slugs = manifest.pages.map(page => page.slug);
  if (new Set(slugs).size !== slugs.length) throw new Error('Duplicate documentation slug');
  if (manifest.pages.length > 2000 || manifest.assets.length > 2000) throw new Error('Too many documentation files');
  if (manifest.pages.length) manifest.entrypoint = manifest.pages.find(page => /^readme$/i.test(page.slug))?.slug ?? manifest.pages[0].slug;
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  if (manifestBytes.length > 2 * 1024 * 1024) throw new Error('Manifest exceeds 2 MiB');
  files.set('manifest.json', manifestBytes);
  return { manifest, files };
}
export function contentType(path) {
  return ({ '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.markdown': 'text/plain; charset=utf-8', '.mdx': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif' })[extname(path).toLowerCase()] ?? 'application/octet-stream';
}
export function docsMiddleware(load, origin = process.env.DOCS_CONTENT_ORIGIN || '') {
  exactOrigin(origin);
  return async (request, response, next) => {
    const raw = request.url || '';
    if (raw !== '/docs-content' && !raw.startsWith('/docs-content/')) return next();
    response.setHeader('Vary', 'Origin');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const fail = (status, message) => { response.statusCode = status; response.setHeader('Content-Type', 'text/plain; charset=utf-8'); response.end(request.method === 'HEAD' ? undefined : message); };
    const ownOrigin = `${request.socket.encrypted ? 'https' : 'http'}://${request.headers.host}`;
    if (request.headers.origin && request.headers.origin !== origin && request.headers.origin !== ownOrigin) return fail(403, 'Docs origin forbidden');
    if (origin && request.headers.origin === origin) response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return fail(405, 'Method not allowed');
    if (request.method === 'OPTIONS') { response.statusCode = 204; response.end(); return; }
    let path;
    try { path = decodeURIComponent(raw.slice('/docs-content/'.length)); } catch { return fail(404, 'Not found'); }
    if (raw.includes('?') || !safePath(path)) return fail(404, 'Not found');
    try {
      const { files } = await load();
      const bytes = files.get(path);
      if (!bytes) return fail(404, 'Not found');
      response.setHeader('Content-Type', contentType(path));
      response.setHeader('Content-Length', bytes.length);
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { fail(503, 'Documentation export unavailable'); }
  };
}
// Vite invokes the same exporter for normal development, preview and production builds.
// Consumers own this small configuration; docs/ is never module-owned.
export function docsContent(options) {
  const origin = exactOrigin(options.origin ?? process.env.DOCS_CONTENT_ORIGIN ?? '');
  let production = false;
  return {
    name: 'project-docs-content',
    configResolved(config) { production = config.command === 'build'; },
    configureServer(server) { server.middlewares.use(docsMiddleware(() => exportDocs(options), origin)); },
    configurePreviewServer(server) {
      server.middlewares.use(docsMiddleware(async () => {
        const out = resolve(server.config.root, server.config.build.outDir, 'docs-content');
        const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
        const files = new Map([['manifest.json', await readFile(join(out, 'manifest.json'))]]);
        for (const item of [...manifest.pages, ...manifest.assets]) {
          if (!safePath(item.contentPath)) throw new Error('Unsafe content path');
          files.set(item.contentPath, await readFile(join(out, item.contentPath)));
        }
        return { files };
      }, origin));
    },
    async generateBundle() {
      const { files } = await exportDocs({ ...options, production });
      for (const [path, source] of files) this.emitFile({ type: 'asset', fileName: `docs-content/${path}`, source });
    },
  };
}
