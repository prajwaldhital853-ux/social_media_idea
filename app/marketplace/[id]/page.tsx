'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import Avatar from '@/components/Avatar';
import VerifiedBadge from '@/components/VerifiedBadge';
import ListingForm from '@/components/ListingForm';
import PromoteModal from '@/components/PromoteModal';
import ReportModal from '@/components/ReportModal';
import { useApp } from '@/lib/AppContext';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/utils';

export default function ListingPage() {
  const params = useParams();
  const router = useRouter();
  const { db, me, t, feature, setDb, showToast, activePromo, isListingSaved, toggleListingSave } = useApp();
  const lang = db.lang;
  const [photo, setPhoto] = useState(0);
  const [editing, setEditing] = useState(false);
  const [promote, setPromote] = useState(false);
  const [report, setReport] = useState(false);

  const listing = db.listings.find(l => l.id === String(params.id || ''));

  if (!listing || listing.status === 'removed') {
    return (
      <AppShell>
        <header className="detail-header">
          <button type="button" className="icon-btn" aria-label={t('back')} onClick={() => router.push('/marketplace')}>{IC.back}</button>
          <h1>{t('marketplace')}</h1>
          <span className="detail-header-spacer" />
        </header>
        <div className="empty-state">
          <span className="empty-state-icon">{IC.store}</span>
          <h2>{t('noListings')}</h2>
          <button type="button" className="empty-state-cta" onClick={() => router.push('/marketplace')}>{t('backFeed')}</button>
        </div>
      </AppShell>
    );
  }

  const seller = db.users.find(u => u.id === listing.uid);
  const mine = me?.id === listing.uid;
  const promo = activePromo('listing', listing.id);
  const images = listing.media.filter(m => m.type === 'image' && m.src);
  const current = images[Math.min(photo, images.length - 1)];
  const saved = isListingSaved(listing.id);
  const sellerListings = seller ? db.listings.filter(l => l.uid === seller.id && (l.status === 'active' || l.status === 'sold')).length : 0;

  const setStatus = (status: 'active' | 'sold' | 'removed') => {
    setDb(prev => ({ ...prev, listings: prev.listings.map(l => l.id === listing.id ? { ...l, status } : l) }));
    if (status === 'removed') {
      showToast(t('deleted'));
      router.push('/marketplace');
    } else {
      showToast(status === 'sold' ? t('sold') : t('relist'));
    }
  };

  const contact = () => {
    if (!me) { router.push('/login'); return; }
    router.push(`/messages/${listing.uid}`);
  };

  const share = async () => {
    const url = `${window.location.origin}/marketplace/${listing.id}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast(t('linkCopied'));
    } catch {
      showToast(url);
    }
  };

  const save = () => {
    if (!me) { router.push('/login'); return; }
    toggleListingSave(listing.id);
  };

  return (
    <AppShell>
      <div className="listing-page">
        <header className="detail-header">
          <button type="button" className="icon-btn" aria-label={t('back')} onClick={() => window.history.length > 1 ? router.back() : router.push('/marketplace')}>{IC.back}</button>
          <h1>{mine ? t('myListings') : t('marketplace')}</h1>
          <span className="detail-header-spacer" />
        </header>

        <div className="listing-layout">
          <div className="listing-media">
            <div className="listing-media-main">
              {current ? (
                <img src={current.src} alt={listing.title} decoding="async" />
              ) : (
                <span className="listing-photos-empty">{IC.store}</span>
              )}
              {listing.status === 'sold' && <span className="listing-sold-flag">{t('sold')}</span>}
              {promo && listing.status === 'active' && <span className="listing-promoted-flag">{IC.chart}{t('promoted')}</span>}
              {images.length > 1 && (
                <div className="listing-photos-nav">
                  <button type="button" aria-label={t('back')} disabled={photo === 0} onClick={() => setPhoto(p => Math.max(0, p - 1))}>{IC.back}</button>
                  <span>{Math.min(photo, images.length - 1) + 1} / {images.length}</span>
                  <button type="button" aria-label={t('next')} disabled={photo >= images.length - 1} onClick={() => setPhoto(p => Math.min(images.length - 1, p + 1))}>{IC.chev}</button>
                </div>
              )}
            </div>
            {images.length > 1 && (
              <div className="listing-thumbs" role="tablist" aria-label={t('media')}>
                {images.map((m, i) => (
                  <button
                    key={i}
                    type="button"
                    role="tab"
                    aria-selected={i === Math.min(photo, images.length - 1)}
                    className={`listing-thumb ${i === Math.min(photo, images.length - 1) ? 'active' : ''}`}
                    onClick={() => setPhoto(i)}
                  >
                    <img src={m.src} alt="" loading="lazy" decoding="async" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="listing-info">
            <div className="listing-price-row">
              <b className="listing-price">NPR {listing.price.toLocaleString('en-US')}</b>
              {listing.status === 'sold' && <span className="status-chip">{t('sold')}</span>}
            </div>
            <h2 className="listing-title">{listing.title}</h2>
            <p className="listing-meta">
              <span>{IC.store}{listing.category}</span>
              <span>{IC.globe}{listing.location}</span>
              <span>{IC.calendar}{ago(listing.ts, lang)}</span>
            </p>
            {listing.desc && <p className="listing-desc">{listing.desc}</p>}

            <div className="listing-actions">
              {mine ? (
                <>
                  <button type="button" className="promote-submit" onClick={() => setEditing(true)}>{IC.edit}{t('edit')}</button>
                  {listing.status === 'active' && feature('promotion') && !promo && (
                    <button type="button" className="ghost-btn" onClick={() => setPromote(true)}>{IC.chart}{t('promote')}</button>
                  )}
                  {listing.status === 'active' ? (
                    <button type="button" className="ghost-btn" onClick={() => setStatus('sold')}>{IC.check}{t('markSold')}</button>
                  ) : listing.status === 'sold' ? (
                    <button type="button" className="ghost-btn" onClick={() => setStatus('active')}>{IC.store}{t('relist')}</button>
                  ) : null}
                  <button
                    type="button"
                    className="ghost-btn danger"
                    onClick={() => { if (window.confirm(t('confirmDelete'))) setStatus('removed'); }}
                  >
                    {IC.x}{t('del')}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="promote-submit" onClick={contact}>{IC.msg}{t('contactSeller')}</button>
                  <button type="button" className={`ghost-btn ${saved ? 'saved-on' : ''}`} onClick={save} aria-pressed={saved}>
                    {IC.bookmark}<span>{saved ? t('saved') : t('saveListing')}</span>
                  </button>
                  <button type="button" className="ghost-btn" onClick={() => void share()}>{IC.share}{t('share')}</button>
                  <button type="button" className="ghost-btn" onClick={() => me ? setReport(true) : router.push('/login')}>{IC.flag}{t('report')}</button>
                </>
              )}
            </div>

            {seller && (
              <Link href={`/u/${seller.username}`} className="listing-seller-card">
                <Avatar user={seller} size={52} />
                <span className="listing-seller-id">
                  <b>{seller.name}{seller.verified && <VerifiedBadge />}</b>
                  <span>@{seller.username}</span>
                  <small>{sellerListings} {t('listings')}{seller.city ? ` · ${seller.city}` : ''}</small>
                </span>
                {IC.chev}
              </Link>
            )}

            {!mine && (
              <p className="listing-safety">{IC.shield}{t('safetyTip')}</p>
            )}
          </div>
        </div>
      </div>

      {editing && mine && <ListingForm listingId={listing.id} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
      {promote && <PromoteModal targetType="listing" targetId={listing.id} defaultCategory={listing.category} onClose={() => setPromote(false)} />}
      {report && <ReportModal type="listing" targetId={listing.id} onClose={() => setReport(false)} />}
    </AppShell>
  );
}