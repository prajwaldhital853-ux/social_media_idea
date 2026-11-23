'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import PeopleList from '@/components/PeopleList';
import { useApp } from '@/lib/AppContext';
import { usersFragment, useList } from '@/lib/lists';
import { localSuggestions } from '@/lib/suggest';
import { User } from '@/lib/types';
import { IC } from '@/lib/icons';

// Wider than the rail's thirty: See all is the whole roster the graph justifies,
// and asking for it is what fills the cache the rail is already reading.
const ROSTER = 60;

export default function SuggestedPeoplePage() {
  const router = useRouter();
  const { db, me, t, serverMode } = useApp();
  const list = useList('suggested', { path: '/users/suggested/', frag: usersFragment }, { limit: ROSTER }, serverMode);

  const people = useMemo<User[]>(() => {
    if (serverMode) {
      const index = new Map(db.users.map(u => [u.id, u] as [string, User]));
      return list.ids.map(id => index.get(id)).filter((u): u is User => !!u);
    }
    return localSuggestions(db, me?.id || null, ROSTER);
  }, [serverMode, list.ids, db, me?.id]);

  return (
    <AppShell>
      <div className="people-page">
        <header className="detail-header">
          <button
            type="button"
            className="icon-btn"
            aria-label={t('back')}
            onClick={() => window.history.length > 1 ? router.back() : router.push('/')}
          >
            {IC.back}
          </button>
          <h1>{t('suggestedForYou')}</h1>
          <span className="detail-header-spacer" />
        </header>
        <p className="people-page-note">{t('suggestedWhy')}</p>
        <PeopleList
          people={people}
          empty={t('suggestedNone')}
          server={serverMode ? {
            hasMore: list.hasMore,
            loading: list.loading,
            load: list.loadMore,
            loaded: list.loaded,
            error: list.error,
            retry: list.reload,
          } : undefined}
        />
      </div>
    </AppShell>
  );
}
