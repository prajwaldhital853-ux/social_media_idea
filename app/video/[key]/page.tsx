import type { Metadata } from 'next';
import ReelsFeed from '@/components/ReelsFeed';
import { reelMetadata } from '@/lib/og';

export async function generateMetadata({ params }: { params: { key: string } }): Promise<Metadata> {
  return reelMetadata(params.key);
}

export default function ReelAtPage({ params }: { params: { key: string } }) {
  return <ReelsFeed initialKey={params.key} />;
}