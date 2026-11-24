'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { useApp } from '@/lib/AppContext';
import { api, API_ENABLED } from '@/lib/api';
import { IC } from '@/lib/icons';

interface WarningDetail {
  id: string | number;
  text: string;
  actor?: string;
  actor_username?: string;
  created_at: string;
  notice_detail?: {
    id: number;
    text: string;
    reason?: string;
    audience: 'public' | 'private';
    created_at: string;
    by?: string;
    is_live: boolean;
  } | null;
  target?: {
    kind: 'post' | 'comment' | 'listing' | 'user';
    id: string | number;
    status: string;
    created_at: string;
    text?: string;
    author?: { username: string; name: string };
    href: string;
  } | null;
}

export default function WarningDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { db, me, ready, t } = useApp();
  const id = String(params.id || '');
  const [detail, setDetail] = useState<WarningDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!ready || !id || !API_ENABLED) return;
    setBusy(true);
    setError(null);
    try {
      setDetail(await api.get<WarningDetail>(`/api/notifications/${id}/`));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [id, ready]);

  useEffect(() => {
    if (me) void load();
    else if (ready) router.replace('/login');
  }, [load, me, ready, router]);

  const notice = detail?.notice_detail;
  const target = detail?.target;
  const date = (value?: string) => value
    ? new Date(value).toLocaleString(db.lang === 'ne' ? 'ne-NP' : 'en-GB', {
      dateStyle: 'medium', timeStyle: 'short',
    })
    : '—';

  return (
    <AppShell>
      <div className="warning-detail-page">
        <header className="detail-header">
          <button type="button" className="icon-btn" aria-label={t('back')} onClick={() => router.back()}>
            {IC.back}
          </button>
          <h1>{t('warningDetail')}</h1>
          <span className="detail-header-spacer" />
        </header>

        {!ready || (API_ENABLED && !detail && !error) ? (
          <div className="feed-skeleton" aria-hidden="true">
            <div className="feed-skeleton-head"><span className="sk-avatar" /><span className="sk-lines"><i /><i /></span></div>
            <div className="sk-lines wide"><i /><i /></div>
          </div>
        ) : error ? (
          <div className="feed-empty">
            <p>{error}</p>
            <button type="button" className="ghost-btn" onClick={load} disabled={busy}>{t('retry')}</button>
          </div>
        ) : detail ? (
          <main className="warning-detail">
            <div className="notice-banner">
              <div className="notice-line">
                <p className="notice-copy"><span className="notice-text">{notice?.text || detail.text}</span></p>
                <Link href="/notifications">{t('visitInbox')}</Link>
              </div>
            </div>

            <section className="warning-card">
              <h2>{t('warningMessage')}</h2>
              <p className="warning-copy">{notice?.text || detail.text}</p>
              <dl className="warning-facts">
                {notice?.reason && (
                  <div><dt>{t('warningReason')}</dt><dd>{notice.reason}</dd></div>
                )}
                {notice && (
                  <div>
                    <dt>{t('warningAudience')}</dt>
                    <dd>{notice.audience === 'private' ? t('warningPrivate') : t('warningPublic')}</dd>
                  </div>
                )}
                <div>
                  <dt>{t('warningIssuedBy')}</dt>
                  <dd>{notice?.by || detail.actor_username ? `@${notice?.by || detail.actor_username}` : 'staff'}</dd>
                </div>
                <div><dt>{t('warningIssuedAt')}</dt><dd>{date(notice?.created_at || detail.created_at)}</dd></div>
              </dl>
            </section>

            <section className="warning-card">
              <h2>{t('warningTarget')}</h2>
              {target ? (
                <>
                  <p className="warning-target-label">
                    {target.author?.username ? `@${target.author.username} · ` : ''}
                    {target.kind} #{target.id}
                  </p>
                  {target.text && <p className="warning-copy">{target.text}</p>}
                  <dl className="warning-facts">
                    <div><dt>{t('warningPostedAt')}</dt><dd>{date(target.created_at)}</dd></div>
                    <div><dt>{t('warningStatus')}</dt><dd>{target.status}</dd></div>
                  </dl>
                  <Link className="warning-target-link" href={target.href}>
                    {t('openWarningTarget')} {IC.go}
                  </Link>
                </>
              ) : <p className="warning-copy">{t('warningMissingTarget')}</p>}
            </section>
          </main>
        ) : !API_ENABLED ? (
          <div className="feed-empty">
            <p>{t('noUser')}</p>
            <Link href="/notifications">{t('notifications')}</Link>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
