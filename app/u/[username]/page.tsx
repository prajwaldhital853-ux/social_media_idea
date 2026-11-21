import type { Metadata } from 'next';
import { profileMetadata } from '@/lib/og';
import ProfileView from './ProfileView';

export async function generateMetadata({ params }: { params: { username: string } }): Promise<Metadata> {
  return profileMetadata(params.username);
}

export default function ProfilePage() {
  return <ProfileView />;
}
