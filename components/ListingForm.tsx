'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '@/lib/AppContext';
import { useBackClose } from '@/lib/useBackClose';
import { IC } from '@/lib/icons';
import { mediaFromFile } from '@/lib/mediaFile';
import { uid } from '@/lib/utils';
import { Media } from '@/lib/types';

interface ListingFormProps {
  onClose: () => void;
  onCreated: (id: string) => void;
}

export default function ListingForm({ onClose, onCreated }: ListingFormProps) {
  const { db, me, t, setDb, showToast } = useApp();
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState(db.settings.categories[0] || '');
  const [location, setLocation] = useState(me?.city || '');
  const [media, setMedia] = useState<Media[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useBackClose(true, onClose);

  if (typeof document === 'undefined' || !me) return null;

  const addFiles = async (files: FileList | null) => {
    if (!files || busy) return;
    const images = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (media.length + images.length > 4) {
      setError(t('e_photos4'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const added = await Promise.all(images.map(f => mediaFromFile(f)));
      setMedia(prev => [...prev, ...added].slice(0, 4));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('e_photos4'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError(t('e_title')); return; }
    const amount = Number(price);
    if (!Number.isFinite(amount) || amount < 1) { setError(t('e_price')); return; }
    if (!location.trim()) { setError(t('e_location')); return; }
    const id = uid();
    setDb(prev => ({
      ...prev,
      listings: [{
        id,
        uid: me.id,
        title: title.trim(),
        desc: desc.trim(),
        price: Math.round(amount),
        category,
        location: location.trim(),
        media,
        ts: Date.now(),
        status: 'active' as const
      }, ...prev.listings]
    }));
    showToast(t('listingCreated'));
    onCreated(id);
    onClose();
  };

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content listing-form-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={t('createListing')}>
        <div className="modal-header">
          <b>{t('createListing')}</b>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t('close')}>{IC.x}</button>
        </div>
        <form className="listing-form" onSubmit={submit}>
          <label className="field">
            <span>{t('listingTitle')}</span>
            <input value={title} onChange={e => setTitle(e.target.value)} maxLength={90} placeholder={t('listingTitle')}/>
          </label>
          <label className="field">
            <span>{t('description')}</span>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} maxLength={1200} rows={3} placeholder={t('description')}/>
          </label>
          <div className="field-row">
            <label className="field">
              <span>{t('price')}</span>
              <input type="number" min={1} step={1} value={price} onChange={e => setPrice(e.target.value)} placeholder="0"/>
            </label>
            <label className="field">
              <span>{t('category')}</span>
              <select value={category} onChange={e => setCategory(e.target.value)}>
                {db.settings.categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <label className="field">
            <span>{t('location')}</span>
            <input value={location} onChange={e => setLocation(e.target.value)} maxLength={80} placeholder={t('location')}/>
          </label>

          <div className="listing-form-photos">
            <div className="listing-form-thumbs">
              {media.map((m, i) => (
                <span key={i} className="listing-form-thumb">
                  <img src={m.src} alt=""/>
                  <button type="button" aria-label={t('del')} onClick={() => setMedia(prev => prev.filter((_, j) => j !== i))}>{IC.x}</button>
                </span>
              ))}
              {media.length < 4 && (
                <button type="button" className="listing-form-add" disabled={busy} onClick={() => fileRef.current?.click()}>
                  {IC.camera}<span>{busy ? '…' : t('addPhotos')}</span>
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={e => addFiles(e.target.files)}/>
            <span className="field-count">{media.length}/4</span>
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="promote-submit" disabled={busy}>{IC.store}{t('createListing')}</button>
        </form>
      </div>
    </div>,
    document.body
  );
}