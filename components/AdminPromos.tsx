'use client';

import { useState } from 'react';
import Avatar from '@/components/Avatar';
import { useApp } from '@/lib/AppContext';
import { IC } from '@/lib/icons';
import { ago, compact, uid } from '@/lib/utils';
import { Promotion } from '@/lib/types';

const FILTERS = ['all', 'pending', 'active', 'ended', 'rejected'] as const;
const DAY = 24 * 60 * 60 * 1000;

export default function AdminPromos() {
  const { db, t, setDb, showToast, logAudit, notify } = useApp();
  const lang = db.lang;
  const [filter, setFilter] = useState<typeof FILTERS[number]>('all');

  const promos = db.promotions
    .filter(p => filter === 'all' || p.status === filter)
    .sort((a, b) => b.ts - a.ts);

  const targetLabel = (p: Promotion) => {
    if (p.targetType === 'post') {
      const post = db.posts.find(x => x.id === p.targetId);
      return post ? (post.text.slice(0, 70) || t('photo')) : p.targetId;
    }
    const listing = db.listings.find(x => x.id === p.targetId);
    return listing ? listing.title : p.targetId;
  };

  const activate = (p: Promotion) => {
    const pk = db.settings.packages.find(x => x.id === p.packageId);
    const ends = Date.now() + (pk?.days ?? 3) * DAY;
    setDb(prev => ({ ...prev, promotions: prev.promotions.map(x => x.id === p.id ? { ...x, status: 'active' as const, ends } : x) }));
    notify(p.uid, 'promotion', t('promoActivated'), '/wallet');
    logAudit('activate_promotion', p.id, pk?.name ?? p.packageId);
    showToast(t('promoActivated'));
  };

  const reject = (p: Promotion) => {
    const now = Date.now();
    setDb(prev => ({
      ...prev,
      promotions: prev.promotions.map(x => x.id === p.id ? { ...x, status: 'rejected' as const } : x),
      users: prev.users.map(u => u.id === p.uid ? { ...u, coins: u.coins + p.coins } : u),
      ledger: [{ id: uid(), uid: p.uid, delta: p.coins, kind: 'refund' as const, note: 'Promotion request rejected', ts: now }, ...prev.ledger]
    }));
    notify(p.uid, 'promotion', t('promoRejected'), '/wallet');
    logAudit('reject_promotion', p.id, `${p.coins} coins returned`);
    showToast(t('promoRejected'));
  };

  const end = (p: Promotion) => {
    setDb(prev => ({ ...prev, promotions: prev.promotions.map(x => x.id === p.id ? { ...x, status: 'ended' as const, ends: Date.now() } : x) }));
    notify(p.uid, 'promotion', t('promoEnded'), '/wallet');
    logAudit('end_promotion', p.id, '');
    showToast(t('promoEnded'));
  };

  return (
    <div className="admin-panel">
      <div className="admin-chips">
        {FILTERS.map(f => (
          <button key={f} type="button" className={`admin-chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? t('all') : t(f)}
            {f === 'pending' && <span className="admin-chip-n">{db.promotions.filter(p => p.status === 'pending').length}</span>}
          </button>
        ))}
      </div>
      {promos.length === 0 ? (
        <div className="empty-state"><span className="empty-state-icon">{IC.chart}</span><h2>{t('noPromos')}</h2></div>
      ) : (
        <div className="admin-list">
          {promos.map(p => {
            const user = db.users.find(u => u.id === p.uid);
            const pk = db.settings.packages.find(x => x.id === p.packageId);
            return (
              <div key={p.id} className="admin-promo">
                {user && <Avatar user={user} size={44}/>}
                <span className="admin-promo-main">
                  <b>{user?.name ?? p.uid} · {pk?.name ?? p.packageId} · {p.coins} {t('coins')}</b>
                  <span className="admin-promo-target">{t(p.targetType === 'post' ? 'dpost' : 'dlisting')}: {targetLabel(p)}</span>
                  <span className="admin-promo-meta">
                    <span>{p.category}</span>
                    <span>{p.ageMin}–{p.ageMax}</span>
                    <span>{p.country || t('allLocations')}{p.city ? ` · ${p.city}` : ''}</span>
                    <span>{IC.eye}{compact(p.impressions)} {t('impressions')}</span>
                    <span>{IC.chart}{compact(p.clicks)} {t('clicks')}</span>
                    <span>{t('endsIn')} {new Date(p.ends).toLocaleDateString(lang === 'ne' ? 'ne-NP' : 'en-GB')}</span>
                    <span>{ago(p.ts, lang)}</span>
                  </span>
                </span>
                <span className={`status-chip ${p.status}`}>{t(p.status)}</span>
                <span className="admin-promo-actions">
                  {p.status === 'pending' && (
                    <>
                      <button type="button" className="promote-submit" onClick={() => activate(p)}>{IC.check}{t('activate')}</button>
                      <button type="button" className="ghost-btn danger" onClick={() => reject(p)}>{IC.x}{t('reject')}</button>
                    </>
                  )}
                  {p.status === 'active' && (
                    <button type="button" className="ghost-btn" onClick={() => end(p)}>{IC.x}{t('ended')}</button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}