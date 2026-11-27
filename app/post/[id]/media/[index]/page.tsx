import type { Metadata } from 'next';
import MediaPage from '@/components/MediaPage';
import { mediaMetadata } from '@/lib/og';

export async function generateMetadata({
  params,
}: {
  params: { id: string; index: string };
}): Promise<Metadata> {
  return mediaMetadata(params.id, Number.parseInt(params.index, 10));
}

export default function PostMediaRoute({ params }: { params: { id: string; index: string } }) {
  const index = Number.parseInt(params.index, 10);
  return <MediaPage postId={params.id} initialIndex={Number.isFinite(index) ? index : 0} />;
}
