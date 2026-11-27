'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import PromotionEditor from '@/components/PromotionEditor';
import WalletShell, { StatusChip } from '@/components/WalletShell';
import { useApp } from '@/lib/AppContext';
import { promotionsFragment, useList } from '@/lib/lists';
import { useWindowed } from '@/lib/useWindowed';
import { ago } from '@/lib/utils';
import { Promotion } from '@/lib/types';

const pct = (clicks: number, impressions: number) =>
  impressions > 0 ? `${Math.round((clicks / impressions) * 1000) / 10}%` : '—';

const daysLeft = (ends: number) => Math.max(0, Math.ceil((ends - Date.now()) / 86400000));

export default function WalletPromotionsPage() {
  const { db, me, t, cancelPromotion, setPromotionStatus, showConfirm, serverMode } = useApp();
  const [editing, setEditing] = useState<Promotion | null>(null);

  // The list, not the copy the session carried in at sign-in: an open screen has to
  // answer for campaigns that were placed, decided and served while it sat there, and
  // a list is what the shell's pull and the arrival of the screen both re-read.
  const list = useList(
    'promotions',
    { path: '/promotions/', frag: promotionsFragment },
    undefined,
    serverMode && !!me,
  );
  const all = useMemo<Promotion[]>(() => {
    if (!me) return [];
    if (serverMode) {
      const index = new Map(db.promotions.map(p => [p.id, p] as [string, Promotion]));
      return list.ids.map(id => index.get(id)).filter((p): p is Promotion => !!p && p.uid === me.id);
    }
    return db.promotions.filter(p => p.uid === me.id).sort((a, b) => b.ts - a.ts);
  }, [db.promotions, list.ids, me, serverMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const { limit, pending, sentinel, hasMore } = useWindowed(all.length, 10, 'wallet-promotions',
    serverMode ? {
      hasMore: list.hasMore, loading: list.loading, load: list.loadMore,
      loaded: list.loaded, error: list.error, retry: list.reload,
    } : undefined);
  const promos = all.slice(0, limit);
  // A card names the thing it advertises. The caption usually arrives with the post
  // rows this screen never asked for, which is how a live campaign came to read as
  // "Post not available" — so the server's own line for the target is the fallback.
  const title = (p: Promotion) => p.targetType === 'post'
    ? (db.posts.find(x => x.id === p.targetId)?.text || p.targetLabel || '').slice(0, 70) || t('unavailable')
    : db.listings.find(x => x.id === p.targetId)?.title || p.targetLabel || t('unavailable');
  const href = (p: Promotion) => p.targetType === 'post' ? `/post/${p.targetId}` : `/marketplace/${p.targetId}`;
  const pack = (p: Promotion) => db.settings.packages.find(x => x.id === p.packageId)?.name || p.packageId;

  return (
    <WalletShell>
      <section className="wallet-sec">
        <div className="wallet-sec-head">
          <h2>{t('myPromotions')}</h2>
          <span className="wallet-sec-note">{t('promotions')}</span>
        </div>

        {serverMode && !list.loaded && all.length === 0 ? (
          <div className="wallet-rows" aria-hidden="true">
            <i className="wallet-skel" /><i className="wallet-skel" />
          </div>
        ) : promos.length === 0 ? (
          <p className="wallet-empty">{t('noPromos')}</p>
        ) : promos.map(p => {
          const open = p.status === 'active' || p.status === 'paused';
          const waiting = p.status === 'pending';
          const left = daysLeft(p.ends);
          const cities = p.cities || [];
          return (
            <article className="promo-card" key={p.id}>
              <header className="promo-card-head">
                <Link href={href(p)} className="promo-card-title">{title(p)}</Link>
                <StatusChip status={p.status} />
              </header>

              {waiting && <p className="promo-charge-note">{t('chargedOnApproval')}</p>}

              <div className="promo-figures">
                <div><b>{p.impressions.toLocaleString('en-US')}</b><span>{t('impressions')}</span></div>
                <div><b>{p.clicks.toLocaleString('en-US')}</b><span>{t('clicks')}</span></div>
                <div><b>{(p.profileVisits || 0).toLocaleString('en-US')}</b><span>{t('profileVisits')}</span></div>
                <div><b>{pct(p.clicks, p.impressions)}</b><span>{t('openRate')}</span></div>
                <div><b title={waiting ? t('notChargedYet') : undefined}>{p.coins}</b><span>{waiting ? t('notChargedYet') : t('spent')}</span></div>
              </div>

              <dl className="promo-facts">
                <div><dt>{t('package')}</dt><dd>{pack(p)}</dd></div>
                <div><dt>{t('category')}</dt><dd>{p.category || '—'}</dd></div>
                <div><dt>{t('targetAge')}</dt><dd>{t('ageRange', { min: p.ageMin, max: p.ageMax })}</dd></div>
                <div>
                  <dt>{t('targetLocation')}</dt>
                  <dd>{p.country || t('allLocations')}{cities.length ? ` · ${cities.join(', ')}` : ''}</dd>
                </div>
                <div>
                  <dt>{t('started')}</dt>
                  <dd>{p.starts ? ago(p.starts, db.lang) : t('awaitingApproval')}</dd>
                </div>
                <div>
                  <dt>{t('endsIn')}</dt>
                  <dd>{waiting || !p.ends
                    ? '—'
                    : p.status === 'active'
                      ? t('daysLeft', { n: left })
                      : new Date(p.ends).toLocaleDateString(db.lang === 'ne' ? 'ne-NP' : 'en-GB', { day: 'numeric', month: 'short' })}</dd>
                </div>
              </dl>

              <div className="promo-actions">
                {(open || waiting) && <button type="button" className="wallet-button" onClick={() => setEditing(p)}>{t('editTargeting')}</button>}
                {p.status === 'active' && <button type="button" className="wallet-quiet" onClick={() => void setPromotionStatus(p.id, 'pause')}>{t('pause')}</button>}
                {p.status === 'paused' && <button type="button" className="wallet-quiet" onClick={() => void setPromotionStatus(p.id, 'resume')}>{t('resume')}</button>}
                {open && (
                  <button
                    type="button"
                    className="wallet-quiet danger"
                    onClick={() => showConfirm(t('confirmDelete'), () => void cancelPromotion(p.id))}
                  >
                    {t('endNow')}
                  </button>
                )}
                {waiting && (
                  <button type="button" className="wallet-quiet danger" onClick={() => void cancelPromotion(p.id)}>{t('cancelPromo')}</button>
                )}
              </div>
            </article>
          );
        })}
        {pending && hasMore && (
          <div className="wallet-rows" aria-hidden="true"><i className="wallet-skel" /></div>
        )}
        {hasMore && <div ref={sentinel} className="feed-sentinel" aria-hidden="true" />}
      </section>

      {editing && <PromotionEditor promo={editing} onClose={() => setEditing(null)} />}
    </WalletShell>
  );
}
