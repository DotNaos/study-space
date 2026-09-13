import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

/** @type {import('next').NextConfig} */
export default {
  output: 'export',
  basePath: '/docs',
  trailingSlash: true,
  images: { unoptimized: true },
  turbopack: { root: repositoryRoot },
  outputFileTracingRoot: repositoryRoot,
};
