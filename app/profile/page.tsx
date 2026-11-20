'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/AppContext';

export default function ProfileRedirect() {
  const { me } = useApp();
  const router = useRouter();
  useEffect(() => {
    router.replace(me ? `/u/${me.username}` : '/login');
  }, [me, router]);
  return null;
}