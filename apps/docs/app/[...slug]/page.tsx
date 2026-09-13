import { notFound } from 'next/navigation';
import { DocumentPage, params } from '../../components/DocumentPage';
import { getDocumentation } from '../../lib/content';

export const dynamicParams = false;
export async function generateStaticParams() { return params(); }
export default async function Page({ params: value }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await value;
  const key = slug.join('/');
  const { manifest } = await getDocumentation();
  if (!manifest.pages.some(page => page.slug === key)) notFound();
  return <DocumentPage slug={key} />;
}
