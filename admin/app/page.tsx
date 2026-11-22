'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { navFor } from '@/lib/nav';
import { useSession } from '@/lib/session';

/**
 * The console has no fixed home page: the first screen you land on is the first
 * one your seat is actually allowed to open, so a Moderator never arrives at a
 * door that would immediately refuse them.
 */
export default function ConsoleIndex() {
  const router = useRouter();
  const { status, session } = useSession();

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'out' || !session) {
      router.replace('/login');
      return;
    }
    const groups = navFor(session.permissions, session.role);
    router.replace(groups[0]?.items[0]?.href || '/me');
  }, [status, session, router]);

  return null;
}
