import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { getDocumentation, project } from '../lib/content';
import { navigationTree } from '../lib/navigation';
import './global.css';

export const metadata: Metadata = { title: { default: `${project.title} documentation`, template: `%s · ${project.title}` }, description: `${project.title} project documentation.` };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { manifest } = await getDocumentation();
  return <html lang="en" suppressHydrationWarning><body>
    <RootProvider>
      <DocsLayout tree={navigationTree(manifest)} nav={{ title: project.title, url: '/' }} githubUrl={project.repositoryUrl}
        links={[{ icon: <ArrowLeft aria-hidden />, text: 'Architecture', url: project.architectureUrl }]}> {children} </DocsLayout>
    </RootProvider>
  </body></html>;
}
