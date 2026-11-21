'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useApp } from '@/lib/AppContext';
import BrandLogo from './BrandLogo';
import ThemeToggle from './ThemeToggle';
import NotificationPanel from './NotificationPanel';
import MessengerPanel from './MessengerPanel';
import { useDismiss } from '@/lib/useDismiss';
import { useBackClose } from '@/lib/useBackClose';
import { IC } from '@/lib/icons';

type Panel = 'none' | 'messages' | 'notifications';

export default function TopBar() {
  const { me, db, t, feedTab, setFeedTab } = useApp();
  const pathname = usePathname();
  const [panel, setPanel] = useState<Panel>('none');
  const msgBox = useRef<HTMLDivElement>(null);
  const notifBox = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setPanel('none'), []);
  const toggle = (next: Panel) => setPanel(p => (p === next ? 'none' : next));

  useDismiss(panel !== 'none', msgBox, close);
  useDismiss(panel !== 'none', notifBox, close);
  // One history layer for the whole popover, so phone-back and browser-back
  // step out of the panel before they leave the page.
  useBackClose(panel !== 'none', close);
  useEffect(() => setPanel('none'), [pathname]);

  const unreadMsg = db.unread ? db.unread.messages : (me ? db.messages.filter(m => m.to === me.id && !m.read).length : 0);
  const unreadNotif = db.unread ? db.unread.notifications : (me ? db.notifications.filter(n => n.uid === me.id && !n.read).length : 0);
  const badge = (n: number) => (n > 9 ? '9+' : String(n));

  return (
    <header className="topbar">
      <div className="topbar-left">
        <Link href="/" className="topbar-brand" aria-label="Exposing home">
          <BrandLogo height={30} />
        </Link>
        <Link href="/explore" className="topbar-search" aria-label={t('search')}>
          {IC.search}
          <span>Search Exposing</span>
        </Link>
      </div>
      {pathname === '/' && (
        <div className="topbar-tabs" role="tablist" aria-label="Feed">
          <button
            type="button"
            role="tab"
            aria-selected={feedTab === 'foryou'}
            className={`topbar-tab ${feedTab === 'foryou' ? 'active' : ''}`}
            onClick={() => setFeedTab('foryou')}
          >
            {t('forYou')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={feedTab === 'following'}
            className={`topbar-tab ${feedTab === 'following' ? 'active' : ''}`}
            onClick={() => setFeedTab('following')}
          >
            {t('following')}
          </button>
        </div>
      )}
      <div className="topbar-right">
        <Link
          href="/video"
          className={`topbar-icon ${pathname.startsWith('/video') ? 'active' : ''}`}
          aria-label={t('video')}
          title={t('video')}
        >
          {IC.video}
        </Link>
        <div className="topbar-slot" ref={msgBox}>
          <button
            type="button"
            className={`topbar-icon ${pathname.startsWith('/messages') || panel === 'messages' ? 'active' : ''}`}
            aria-label={t('messages')}
            title={t('messages')}
            aria-haspopup="dialog"
            aria-expanded={panel === 'messages'}
            onClick={() => toggle('messages')}
          >
            {IC.msg}
            {unreadMsg > 0 && <span className="topbar-badge">{badge(unreadMsg)}</span>}
          </button>
          {panel === 'messages' && <MessengerPanel close={close} />}
        </div>
        <div className="topbar-slot" ref={notifBox}>
          <button
            type="button"
            className={`topbar-icon ${pathname.startsWith('/notifications') || panel === 'notifications' ? 'active' : ''}`}
            aria-label={t('notifications')}
            title={t('notifications')}
            aria-haspopup="dialog"
            aria-expanded={panel === 'notifications'}
            onClick={() => toggle('notifications')}
          >
            {IC.bell}
            {unreadNotif > 0 && <span className="topbar-badge">{badge(unreadNotif)}</span>}
          </button>
          {panel === 'notifications' && <NotificationPanel close={close} />}
        </div>
        {!me && (
          <span className="topbar-auth">
            <Link href="/signup" className="topbar-signup">{t('signup')}</Link>
            <Link href="/login" className="topbar-signin">{t('signIn')}</Link>
          </span>
        )}
        <ThemeToggle compact />
      </div>
    </header>
  );
}
