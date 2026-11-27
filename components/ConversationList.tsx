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

// A handful of names, not a directory: the band is there to start a chat, and
// the picker behind the pencil is where anybody else is.
const BAND_ROWS = 6;

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
  // The band is short on purpose: it is a starting point, and it has no history
  // to page through. The conversations above it — where a message that just
  // landed belongs — window and paginate as before.
  const band = shown.filter(c => c.suggested).slice(0, BAND_ROWS);
  const threads = shown.filter(c => !c.suggested);
  const { limit, pending, sentinel, hasMore } = useWindowed(threads.length, 10, needle,
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
        <>
          <div className="inbox-list">
            {threads.slice(0, limit).map(c => (
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
          {band.length > 0 && (
            <section className="inbox-suggested">
              <h3 className="inbox-band-label">{t('mutualBand')}</h3>
              <div className="inbox-list">
                {band.map(c => (
                  <ConversationRow
                    key={c.other.id}
                    c={c}
                    active={c.other.id === activeId}
                    onOpen={openThread}
                  />
                ))}
              </div>
            </section>
          )}
        </>
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
