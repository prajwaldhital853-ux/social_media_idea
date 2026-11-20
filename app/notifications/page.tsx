'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import Avatar from '@/components/Avatar';
import VerifiedBadge from '@/components/VerifiedBadge';
import ThemeToggle from '@/components/ThemeToggle';
import { useApp } from '@/lib/AppContext';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/utils';
import { Notification, NotificationKind, User } from '@/lib/types';

const KIND_ICON: Record<NotificationKind, JSX.Element> = {
  follow: IC.users,
  reaction: IC.heart,
  comment: IC.comment,
  message: IC.msg,
  coins: IC.coin,
  promotion: IC.chart,
  warning: IC.flag,
  system: IC.shield
};

function dayStart(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export default function NotificationsPage() {
  const router = useRouter();
  const { db, me, t, setDb, markAllRead } = useApp();
  const lang = db.lang;

  const mine = useMemo(
    () => db.notifications.filter(n => n.uid === me?.id).sort((a, b) => b.ts - a.ts),
    [db.notifications, me?.id]
  );
  const unread = mine.filter(n => !n.read).length;
  const todayStart = dayStart(Date.now());
  const groups: { label: string; items: Notification[] }[] = [];
  const today = mine.filter(n => n.ts >= todayStart);
  const earlier = mine.filter(n => n.ts < todayStart);
  if (today.length) groups.push({ label: t('today'), items: today });
  if (earlier.length) groups.push({ label: t('earlier'), items: earlier });

  const open = (n: Notification) => {
    if (!n.read) {
      setDb(prev => ({ ...prev, notifications: prev.notifications.map(x => x.id === n.id ? { ...x, read: true } : x) }));
    }
    if (n.href) router.push(n.href);
  };

  const actorOf = (n: Notification): User | undefined =>
    n.actor ? db.users.find(u => u.id === n.actor) : undefined;

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
              <button type="button" className="ghost-btn notif-mark" onClick={markAllRead}>
                {IC.check}<span>{t('markAllRead')}</span>
              </button>
            )}
            <ThemeToggle compact/>
          </div>
        </div>
      </header>

      {!me ? (
        <div className="empty-state">
          <span className="empty-state-icon">{IC.bell}</span>
          <h2>{t('needLogin')}</h2>
          <button type="button" className="empty-state-cta" onClick={() => router.push('/login')}>{t('signIn')}</button>
        </div>
      ) : mine.length === 0 ? (
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
              {g.items.map(n => {
                const actor = actorOf(n);
                return (
                  <button
                    type="button"
                    key={n.id}
                    className={`notif-row ${n.read ? '' : 'unread'}`}
                    onClick={() => open(n)}
                  >
                    <span className={`notif-icon kind-${n.kind}`}>
                      {actor ? <Avatar user={actor} size={44}/> : KIND_ICON[n.kind]}
                      {actor && <span className="notif-icon-badge">{KIND_ICON[n.kind]}</span>}
                    </span>
                    <span className="notif-main">
                      <span className="notif-text">
                        {actor && <b>{actor.name}{actor.verified && <VerifiedBadge/>}</b>}
                        {actor ? ' ' : ''}{n.text}
                      </span>
                      <span className={`notif-time ${n.read ? '' : 'fresh'}`}>{ago(n.ts, lang)}</span>
                    </span>
                    {!n.read && <span className="notif-dot" aria-label={t('unread')}/>}
                  </button>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  </AppShell>;
}