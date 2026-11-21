'use client';

import { ReactNode, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConversationRow from './ConversationRow';
import PeoplePicker from './PeoplePicker';
import { useApp } from '@/lib/AppContext';
import { useInbox } from '@/lib/useInbox';
import { useWindowed } from '@/lib/useWindowed';
import { closeLayerWithoutBack } from '@/lib/useBackClose';
import { IC } from '@/lib/icons';

interface ConversationListProps {
  head?: ReactNode;
  activeId?: string;
}

/**
 * The inbox column: it is the whole messages screen below the top bar and the
 * left pane of the desktop messenger above it, so both keep one search box,
 * one windowing rule and one unread badge.
 */
export default function ConversationList({ head, activeId }: ConversationListProps) {
  const router = useRouter();
  const { me, t, serverMode } = useApp();
  const [q, setQ] = useState('');
  const [picker, setPicker] = useState(false);

  const { conversations, inbox } = useInbox();

  const needle = q.trim().toLowerCase();
  const shown = conversations.filter(c =>
    !needle || c.other.name.toLowerCase().includes(needle) || c.other.username.toLowerCase().includes(needle)
  );
  const { limit, pending, sentinel, hasMore } = useWindowed(shown.length, 10, needle,
    serverMode ? {
      hasMore: inbox.hasMore, loading: inbox.loading, load: inbox.loadMore,
      loaded: inbox.loaded, error: inbox.error, retry: inbox.reload,
    } : undefined);

  const openThread = (username: string) => router.push(`/messages/${username}`);

  return (
    <div className="inbox-column">
      {head}

      {me && (
        <div className="inbox-toolbar">
          <div className="inbox-search">
            {IC.search}
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={t('searchPeople')}
              aria-label={t('searchPeople')}
            />
          </div>
          <button
            type="button"
            className="inbox-new"
            onClick={() => setPicker(true)}
            title={t('newMessage')}
            aria-label={t('newMessage')}
          >
            {IC.edit}
          </button>
        </div>
      )}

      {!me ? null : shown.length === 0 ? (
        serverMode && inbox.error ? (
          <div className="empty-state">
            <h2>{t('listFailed')}</h2>
            <button type="button" className="empty-state-cta" onClick={() => void inbox.reload()}>{t('retry')}</button>
          </div>
        ) : serverMode && !inbox.loaded ? (
          <div className="inbox-list" aria-hidden="true">
            {[0, 1, 2].map(i => (
              <div className="people-skeleton inbox" key={i}>
                <span className="sk-avatar" /><span className="sk-lines"><i /><i /></span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <span className="empty-state-icon">{IC.msg}</span>
            <h2>{t('noMessages')}</h2>
            <button type="button" className="empty-state-cta" onClick={() => setPicker(true)}>{t('newMessage')}</button>
          </div>
        )
      ) : (
        <div className="inbox-list">
          {shown.slice(0, limit).map(c => (
            <ConversationRow
              key={c.other.id}
              c={c}
              active={c.other.id === activeId}
              onOpen={openThread}
            />
          ))}
          {pending && hasMore && (
            <div className="people-skeleton inbox" aria-hidden="true">
              <span className="sk-avatar" /><span className="sk-lines"><i /><i /></span>
            </div>
          )}
          {hasMore && <div ref={sentinel} className="feed-sentinel" aria-hidden="true" />}
        </div>
      )}

      {picker && me && (
        <PeoplePicker
          title={t('newMessage')}
          exclude={[me.id]}
          onClose={() => setPicker(false)}
          onSelect={u => { closeLayerWithoutBack(); setPicker(false); openThread(u.username); }}
        />
      )}
    </div>
  );
}
