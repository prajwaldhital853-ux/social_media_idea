'use client';

import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import NotificationRow from '@/components/NotificationRow';
import ThemeToggle from '@/components/ThemeToggle';
import { useApp } from '@/lib/AppContext';
import { useNotifications } from '@/lib/useNotifications';
import { PAGED_WINDOW, useWindowed } from '@/lib/useWindowed';
import { IC } from '@/lib/icons';
import { Notification } from '@/lib/types';

function dayStart(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export default function NotificationsPage() {
  const router = useRouter();
  const { me, t, markAllRead, markRead, serverMode, ready } = useApp();

  const { rows: all, unread, feed } = useNotifications();

  const todayStart = dayStart(Date.now());
  const today = all.filter(n => n.ts >= todayStart);
  const earlier = all.filter(n => n.ts < todayStart);
  const shown = today.length + earlier.length;
  // Ten at a time, which is the same cut the server pages its answer by, so one
  // screen step is exactly one round trip rather than a window that runs ahead of
  // the rows that exist.
  const { limit, pending, sentinel, hasMore } = useWindowed(shown, 10, 'notifications',
    serverMode ? {
      hasMore: feed.hasMore, loading: feed.loading, load: feed.loadMore,
      loaded: feed.loaded, error: feed.error, retry: feed.reload,
    } : undefined,
    // Asked for close enough that the reader is looking at the seam when the page
    // arrives, and held long enough that a warm answer still shows as a page.
    PAGED_WINDOW);
  // One window over two day-groups: the newest day fills first, so a page break
  // never splits "Earlier" above something still waiting under "Today".
  const visibleToday = today.slice(0, limit);
  const visibleEarlier = earlier.slice(0, Math.max(0, limit - visibleToday.length));
  const groups: { label: string; items: Notification[] }[] = [];
  if (visibleToday.length) groups.push({ label: t('today'), items: visibleToday });
  if (visibleEarlier.length) groups.push({ label: t('earlier'), items: visibleEarlier });

  const open = (n: Notification) => {
    if (!n.read) void markRead(n.id);
    if (n.href) router.push(n.href);
  };

  return <AppShell>
    <div className="notif-view">
      <header className="header home-header">
        <div className="home-header-row">
          <div className="home-header-copy">
            <h1 className="header-title">{t('notifications')}</h1>
            <p className="header-sub">{unread > 0 ? `${unread} ${t('unread')}` : t('allRead')}</p>
          </div>
          <div className="header-actions">
            {unread > 0 && (
              <button type="button" className="ghost-btn notif-mark" onClick={markAllRead}
                title={t('markAllRead')} aria-label={t('markAllRead')}>
                {IC.check}<span>{t('markAllRead')}</span>
              </button>
            )}
            <ThemeToggle compact/>
          </div>
        </div>
      </header>

      {!me ? (ready ? (
        <div className="empty-state">
          <span className="empty-state-icon">{IC.bell}</span>
          <h2>{t('needLogin')}</h2>
          <button type="button" className="empty-state-cta" onClick={() => router.push('/login')}>{t('signIn')}</button>
        </div>
      ) : null) : shown === 0 && feed.error ? (
        <div className="empty-state">
          <h2>{t('listFailed')}</h2>
          <button type="button" className="empty-state-cta" onClick={() => void feed.reload()}>{t('retry')}</button>
        </div>
      ) : shown === 0 && serverMode && !feed.loaded ? (
        <div className="notif-list" aria-hidden="true">
          {[0, 1, 2].map(i => (
            <div className="people-skeleton" key={i}>
              <span className="sk-avatar" /><span className="sk-lines"><i /><i /></span>
            </div>
          ))}
        </div>
      ) : shown === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">{IC.bell}</span>
          <h2>{t('noNotifications')}</h2>
          <button type="button" className="empty-state-cta" onClick={() => router.push('/')}>{t('backFeed')}</button>
        </div>
      ) : (
        <div className="notif-list">
          {groups.map(g => (
            <section key={g.label} className="notif-group">
              <h2 className="notif-group-label">{g.label}</h2>
              {g.items.map(n => (
                <NotificationRow key={n.id} n={n} onOpen={open} />
              ))}
            </section>
          ))}
          {pending && hasMore && [0, 1, 2].map(i => (
            <div className="people-skeleton" key={`sk-${i}`} aria-hidden="true">
              <span className="sk-avatar" /><span className="sk-lines"><i /><i /></span>
            </div>
          ))}
          {hasMore && <div ref={sentinel} className="feed-sentinel" aria-hidden="true" />}
        </div>
      )}
    </div>
  </AppShell>;
}