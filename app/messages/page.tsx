'use client';

import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import ConversationList from '@/components/ConversationList';
import ThemeToggle from '@/components/ThemeToggle';
import { useApp } from '@/lib/AppContext';
import { useInbox } from '@/lib/useInbox';
import { IC } from '@/lib/icons';

export default function MessagesPage() {
  const router = useRouter();
  const { me, t } = useApp();
  // Shared cache with the column below; here it is only the header count.
  const { conversations } = useInbox();
  const totalUnread = conversations.reduce((n, c) => n + c.unread, 0);

  const head = (
    <header className="header home-header">
      <div className="home-header-row">
        <div className="home-header-copy">
          <h1 className="header-title">{t('messages')}</h1>
          <p className="header-sub">{totalUnread > 0 ? `${totalUnread} ${t('unread')}` : t('inbox')}</p>
        </div>
        <div className="header-actions">
          {me && <ThemeToggle compact />}
        </div>
      </div>
    </header>
  );

  return <AppShell>
    <div className="inbox-view messenger">
      <div className="messenger-side">
        {!me ? (
          <div className="empty-state">
            <span className="empty-state-icon">{IC.msg}</span>
            <h2>{t('needLogin')}</h2>
            <button type="button" className="empty-state-cta" onClick={() => router.push('/login')}>{t('signIn')}</button>
          </div>
        ) : (
          <ConversationList head={head} />
        )}
      </div>
      <div className="messenger-main">
        {me && (
          <div className="messenger-empty">
            <span className="messenger-empty-icon">{IC.msg}</span>
            <h2>{t('chooseConversation')}</h2>
            <p>{t('chooseConversationSub')}</p>
          </div>
        )}
      </div>
    </div>
  </AppShell>;
}
