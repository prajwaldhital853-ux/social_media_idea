'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import NotificationRow from './NotificationRow';
import { useApp } from '@/lib/AppContext';
import { closeLayerWithoutBack } from '@/lib/useBackClose';
import { IC } from '@/lib/icons';
import { useNotifications } from '@/lib/useNotifications';
import { Notification } from '@/lib/types';

// The popover is a preview; the screen behind it holds the whole history.
const PANEL_ROWS = 12;

export default function NotificationPanel({ close }: { close: () => void }) {
  const router = useRouter();
  const { me, t, markAllRead, markRead, serverMode, ready } = useApp();
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const { rows, unread, feed } = useNotifications();

  const listed = tab === 'unread' ? rows.filter(n => !n.read) : rows;
  const shown = listed.slice(0, PANEL_ROWS);
  const fresh = shown.filter(n => !n.read);
  const older = shown.filter(n => n.read);
  const groups = tab === 'all'
    ? [{ label: t('panelNew'), items: fresh }, { label: t('panelEarlier'), items: older }]
    : [{ label: '', items: shown }];

  const open = (n: Notification) => {
    if (!n.read) void markRead(n.id);
    closeLayerWithoutBack();
    close();
    if (n.href) router.push(n.href);
  };

  return (
    <div className="topbar-panel" role="dialog" aria-label={t('notifications')}>
      <header className="panel-head">
        <h2>{t('notifications')}</h2>
        {unread > 0 && (
          <button type="button" className="panel-act" onClick={() => void markAllRead()} title={t('markAllRead')} aria-label={t('markAllRead')}>
            {IC.check}
          </button>
        )}
        <button type="button" className="panel-act" onClick={close} aria-label={t('close')}>{IC.x}</button>
      </header>

      <div className="panel-tabs" role="tablist" aria-label={t('notifications')}>
        <button type="button" role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
          {t('allFilter')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'unread'} className={tab === 'unread' ? 'active' : ''} onClick={() => setTab('unread')}>
          {t('unreadFilter')}{unread > 0 ? ` (${unread > 9 ? '9+' : unread})` : ''}
        </button>
      </div>

      <div className="panel-body">
        {!me ? (
          ready && (
            <div className="panel-empty">
              <span className="empty-state-icon">{IC.bell}</span>
              <p>{t('needLogin')}</p>
              <button type="button" className="empty-state-cta" onClick={() => { closeLayerWithoutBack(); close(); router.push('/login'); }}>{t('signIn')}</button>
            </div>
          )
        ) : serverMode && feed.error && rows.length === 0 ? (
          <div className="panel-empty">
            <p>{t('listFailed')}</p>
            <button type="button" className="empty-state-cta" onClick={() => void feed.reload()}>{t('retry')}</button>
          </div>
        ) : serverMode && !feed.loaded && rows.length === 0 ? (
          <div className="panel-loading" aria-hidden="true">
            {[0, 1, 2, 3].map(i => (
              <div className="people-skeleton" key={i}>
                <span className="sk-avatar" /><span className="sk-lines"><i /><i /></span>
              </div>
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="panel-empty">
            <span className="empty-state-icon">{IC.bell}</span>
            <p>{tab === 'unread' ? t('allRead') : t('noNotifications')}</p>
          </div>
        ) : (
          groups.map(g => (
            g.items.length ? (
              <section className="panel-group" key={g.label || 'rows'}>
                {g.label && <h3 className="panel-group-label">{g.label}</h3>}
                <div className="notif-list">
                  {g.items.map(n => (
                    <NotificationRow key={n.id} n={n} onOpen={open} />
                  ))}
                </div>
              </section>
            ) : null
          ))
        )}
      </div>

      <footer className="panel-foot">
        <Link href="/notifications" onClick={() => { closeLayerWithoutBack(); close(); }}>{t('seeAllNotifications')}</Link>
      </footer>
    </div>
  );
}
