import type { Metadata } from 'next';
import { listingMetadata } from '@/lib/og';
import ListingView from './ListingView';

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  return listingMetadata(params.id);
}

export default function ListingPage() {
  return <ListingView />;
}
