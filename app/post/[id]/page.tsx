import type { Metadata } from 'next';
import { postMetadata } from '@/lib/og';
import PostView from './PostView';

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  return postMetadata(params.id);
}

export default function PostPage() {
  return <PostView />;
}
