'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import Avatar from '@/components/Avatar';
import VerifiedBadge from '@/components/VerifiedBadge';
import PromoteModal from '@/components/PromoteModal';
import ReportModal from '@/components/ReportModal';
import { useApp } from '@/lib/AppContext';
import { useBackClose, closeLayerWithoutBack } from '@/lib/useBackClose';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/utils';

interface ListingDetailProps {
  listingId: string;
  onClose: () => void;
}

export default function ListingDetail({ listingId, onClose }: ListingDetailProps) {
  const router = useRouter();
  const { db, me, t, feature, setDb, showToast, activePromo } = useApp();
  const lang = db.lang;
  const [photo, setPhoto] = useState(0);
  const [promote, setPromote] = useState(false);
  const [report, setReport] = useState(false);
  useBackClose(true, onClose);

  const listing = db.listings.find(l => l.id === listingId);
  if (typeof document === 'undefined' || !listing) return null;

  const seller = db.users.find(u => u.id === listing.uid);
  const mine = me?.id === listing.uid;
  const promo = activePromo('listing', listing.id);
  const images = listing.media.filter(m => m.type === 'image' && m.src);
  const current = images[Math.min(photo, images.length - 1)];

  const setStatus = (status: 'active' | 'sold' | 'removed') => {
    setDb(prev => ({ ...prev, listings: prev.listings.map(l => l.id === listing.id ? { ...l, status } : l) }));
    if (status === 'removed') {
      showToast(t('deleted'));
      onClose();
    } else {
      showToast(status === 'sold' ? t('sold') : t('relist'));
    }
  };

  const contact = () => {
    closeLayerWithoutBack();
    if (!me) { onClose(); router.push('/login'); return; }
    onClose();
    router.push(`/messages/${listing.uid}`);
  };

  return createPortal(
    <>
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content listing-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={listing.title}>
        <div className="modal-header">
          <b>{mine ? t('myListings') : t('marketplace')}</b>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t('close')}>{IC.x}</button>
        </div>

        <div className="listing-photos">
          {current ? (
            <img src={current.src} alt={listing.title}/>
          ) : (
            <span className="listing-photos-empty">{IC.store}</span>
          )}
          {listing.status === 'sold' && <span className="listing-sold-flag">{t('sold')}</span>}
          {images.length > 1 && (
            <div className="listing-photos-nav">
              <button type="button" aria-label={t('back')} disabled={photo === 0} onClick={() => setPhoto(p => Math.max(0, p - 1))}>{IC.back}</button>
              <span>{photo + 1} / {images.length}</span>
              <button type="button" aria-label={t('next')} disabled={photo >= images.length - 1} onClick={() => setPhoto(p => Math.min(images.length - 1, p + 1))}>{IC.chev}</button>
            </div>
          )}
        </div>

        <div className="listing-body">
          <div className="listing-price-row">
            <b className="listing-price">NPR {listing.price.toLocaleString('en-US')}</b>
            {promo && <span className="status-chip active">{t('promoted')}</span>}
          </div>
          <h2 className="listing-title">{listing.title}</h2>
          <p className="listing-meta">
            <span>{IC.store}{listing.category}</span>
            <span>{IC.globe}{listing.location}</span>
            <span>{ago(listing.ts, lang)}</span>
          </p>
          {listing.desc && <p className="listing-desc">{listing.desc}</p>}

          {seller && (
            <button type="button" className="listing-seller" onClick={() => { closeLayerWithoutBack(); onClose(); router.push(`/u/${seller.username}`); }}>
              <Avatar user={seller} size={44}/>
              <span className="listing-seller-id">
                <b>{seller.name}{seller.verified && <VerifiedBadge/>}</b>
                <span>@{seller.username}</span>
              </span>
              {IC.chev}
            </button>
          )}

          <div className="listing-actions">
            {mine ? (
              <>
                {listing.status === 'active' && feature('promotion') && !promo && (
                  <button type="button" className="promote-submit" onClick={() => setPromote(true)}>{IC.chart}{t('promote')}</button>
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
                <button type="button" className="ghost-btn" onClick={() => { if (me) { setReport(true); } else { closeLayerWithoutBack(); onClose(); router.push('/login'); } }}>{IC.flag}{t('report')}</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>

    {promote && <PromoteModal targetType="listing" targetId={listing.id} defaultCategory={listing.category} onClose={() => setPromote(false)}/>}
    {report && <ReportModal type="listing" targetId={listing.id} onClose={() => setReport(false)}/>}
    </>,
    document.body
  );
}