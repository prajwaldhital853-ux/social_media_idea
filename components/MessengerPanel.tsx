'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ConversationRow from './ConversationRow';
import PeoplePicker from './PeoplePicker';
import { useApp } from '@/lib/AppContext';
import { closeLayerWithoutBack } from '@/lib/useBackClose';
import { useInbox } from '@/lib/useInbox';
import { IC } from '@/lib/icons';

// The popover is a jump list, not the inbox: twelve threads, then the screen.
const PANEL_ROWS = 12;
// Three names from the band, so the conversations already running keep the rest.
const PANEL_BAND = 3;

export default function MessengerPanel({ close }: { close: () => void }) {
  const router = useRouter();
  const { me, t, serverMode, ready } = useApp();
  const [q, setQ] = useState('');
  const [picker, setPicker] = useState(false);
  const { conversations, inbox } = useInbox();

  const needle = q.trim().toLowerCase();
  const matching = conversations.filter(c =>
    !needle || c.other.name.toLowerCase().includes(needle) || c.other.username.toLowerCase().includes(needle)
  );
  const band = matching.filter(c => c.suggested).slice(0, PANEL_BAND);
  const shown = [...band, ...matching.filter(c => !c.suggested)].slice(0, PANEL_ROWS);

  const go = (username: string) => {
    closeLayerWithoutBack();
    close();
    router.push(`/messages/${username}`);
  };

  return (
    <div className="topbar-panel" role="dialog" aria-label={t('messages')}>
      <header className="panel-head">
        <h2>{t('messages')}</h2>
        {me && (
          <button type="button" className="panel-act" onClick={() => setPicker(true)} title={t('newMessage')} aria-label={t('newMessage')}>
            {IC.plus}
          </button>
        )}
        <button
          type="button"
          className="panel-act"
          title={t('openMessenger')}
          aria-label={t('openMessenger')}
          onClick={() => { closeLayerWithoutBack(); close(); router.push('/messages'); }}
        >
          {IC.expand}
        </button>
        <button type="button" className="panel-act" onClick={close} aria-label={t('close')}>{IC.x}</button>
      </header>

      {me && (
        <div className="panel-search">
          {IC.search}
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={t('searchConversations')}
            aria-label={t('searchConversations')}
          />
        </div>
      )}

      <div className="panel-body">
        {!me ? (
          ready && (
            <div className="panel-empty">
              <span className="empty-state-icon">{IC.msg}</span>
              <p>{t('needLogin')}</p>
              <button type="button" className="empty-state-cta" onClick={() => { closeLayerWithoutBack(); close(); router.push('/login'); }}>{t('signIn')}</button>
            </div>
          )
        ) : shown.length === 0 ? (
          serverMode && inbox.error ? (
            <div className="panel-empty">
              <p>{t('listFailed')}</p>
              <button type="button" className="empty-state-cta" onClick={() => void inbox.reload()}>{t('retry')}</button>
            </div>
          ) : serverMode && !inbox.loaded ? (
            <div className="panel-loading" aria-hidden="true">
              {[0, 1, 2].map(i => (
                <div className="people-skeleton" key={i}>
                  <span className="sk-avatar" /><span className="sk-lines"><i /><i /></span>
                </div>
              ))}
            </div>
          ) : (
            <div className="panel-empty">
              <span className="empty-state-icon">{IC.msg}</span>
              <p>{t('noMessages')}</p>
            </div>
          )
        ) : (
          <div className="inbox-list">
            {shown.map(c => (
              <ConversationRow key={c.other.id} c={c} avatarSize={44} onOpen={go} />
            ))}
          </div>
        )}
      </div>

      <footer className="panel-foot">
        <Link href="/messages" onClick={close}>{t('seeAllMessages')}</Link>
      </footer>

      {picker && me && (
        <PeoplePicker
          title={t('newMessage')}
          exclude={[me.id]}
          onClose={() => setPicker(false)}
          onSelect={u => go(u.username)}
        />
      )}
    </div>
  );
}
