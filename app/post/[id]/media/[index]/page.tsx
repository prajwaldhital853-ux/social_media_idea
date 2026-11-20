'use client';

import { useParams } from 'next/navigation';
import MediaPage from '@/components/MediaPage';

export default function PostMediaRoute() {
  const params = useParams<{ id: string; index: string }>();
  const index = Number.parseInt(params.index, 10);
  return <MediaPage postId={params.id} initialIndex={Number.isFinite(index) ? index : 0} />;
}