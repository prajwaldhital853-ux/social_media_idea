'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import ChatThread from '@/components/ChatThread';
import ConversationList from '@/components/ConversationList';
import { useApp } from '@/lib/AppContext';
import { IC } from '@/lib/icons';
import { User } from '@/lib/types';

export default function ConversationPage() {
  const params = useParams();
  const router = useRouter();
  const { db, me, t, serverMode, loadPerson, ready } = useApp();
  const [missing, setMissing] = useState(false);

  // A thread is addressed by handle; older links and the demo data used ids.
  const handle = String(params.uid ?? '');
  const other = useMemo<User | undefined>(
    () => db.users.find(u => u.username === handle || u.id === handle),
    [db.users, handle],
  );

  useEffect(() => {
    if (!serverMode || !handle || other) return;
    let live = true;
    loadPerson(handle)
      .then(read => { if (live && !read) setMissing(true); })
      .catch(() => {});
    return () => { live = false; };
  }, [serverMode, handle, other, loadPerson]);

  // `ready` gates the sign-in copy: on a cold load the session restores a beat
  // after this screen mounts, and a signed-in reader is not "signed out".
  if (!me) {
    return <AppShell>
      {ready && <div className="empty-state">
        <span className="empty-state-icon">{IC.msg}</span>
        <h2>{t('needLogin')}</h2>
        <button type="button" className="empty-state-cta" onClick={() => router.push('/login')}>{t('signIn')}</button>
      </div>}
    </AppShell>;
  }

  const side = (
    <div className="messenger-side">
      <ConversationList head={<h1 className="messenger-side-title">{t('messages')}</h1>} activeId={other?.id} />
    </div>
  );

  const main = !other
    ? serverMode && !missing ? (
      <div className="chat-skeleton" aria-hidden="true">
        <span className="sk-lines"><i /><i /></span>
        <span className="sk-lines right"><i /></span>
      </div>
    ) : (
      <div className="empty-state">
        <h2>{t('noUser')}</h2>
        <button type="button" className="empty-state-cta" onClick={() => router.push('/messages')}>{t('seeAllMessages')}</button>
      </div>
    )
    : <ChatThread other={other} />;

  return <AppShell>
    <div className="inbox-view messenger">
      {side}
      <div className="messenger-main">{main}</div>
    </div>
  </AppShell>;
}
