import ReelsFeed from '@/components/ReelsFeed';

export default function ReelAtPage({ params }: { params: { key: string } }) {
  return <ReelsFeed initialKey={params.key} />;
}