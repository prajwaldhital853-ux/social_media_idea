'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '@/lib/AppContext';
import { useBackClose } from '@/lib/useBackClose';
import { api, API_ENABLED } from '@/lib/api';
import { listingImages, mapListing } from '@/lib/dto';
import { forgetLists } from '@/lib/lists';
import { IC } from '@/lib/icons';
import { mediaFromFile } from '@/lib/mediaFile';
import { uid } from '@/lib/utils';
import { Media } from '@/lib/types';

interface ListingFormProps {
  onClose: () => void;
  onSaved: (id: string) => void;
  listingId?: string;
}

export default function ListingForm({ onClose, onSaved, listingId }: ListingFormProps) {
  const { db, me, t, setDb, merge, showToast } = useApp();
  const existing = listingId ? db.listings.find(l => l.id === listingId) : undefined;
  const [title, setTitle] = useState(existing?.title || '');
  const [desc, setDesc] = useState(existing?.desc || '');
  const [price, setPrice] = useState(existing ? String(existing.price) : '');
  const [category, setCategory] = useState(existing?.category || db.settings.categories[0] || '');
  const [location, setLocation] = useState(existing?.location || me?.city || '');
  const [media, setMedia] = useState<Media[]>(existing?.media || []);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState<{ name: string; pct: number } | null>(null);
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
      const added: Media[] = [];
      // One at a time: the bar then describes the file actually in flight.
      for (const file of images) {
        added.push(await mediaFromFile(file, (sent, total) => {
          setSending({ name: file.name, pct: total > 0 ? Math.min(99, Math.round(sent / total * 100)) : 0 });
        }));
      }
      setMedia(prev => [...prev, ...added].slice(0, 4));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('e_photos4'));
    } finally {
      setBusy(false);
      setSending(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const addUrl = () => {
    const value = url.trim();
    if (!/^https?:\/\/\S+/i.test(value)) { setError(t('e_url')); return; }
    if (media.length >= 4) { setError(t('e_photos4')); return; }
    setMedia(prev => [...prev, { type: 'image' as const, src: value }]);
    setUrl('');
    setError('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError(t('e_title')); return; }
    const amount = Number(price);
    if (!Number.isFinite(amount) || amount < 1) { setError(t('e_price')); return; }
    if (!location.trim()) { setError(t('e_location')); return; }
    const values = {
      title: title.trim(),
      desc: desc.trim(),
      price: Math.round(amount),
      category,
      location: location.trim(),
      media,
    };

    if (API_ENABLED) {
      setBusy(true);
      const fields = {
        title: values.title, description: values.desc, price: values.price,
        category: values.category, location: values.location, images: listingImages(values.media),
      };
      try {
        const row = existing
          ? await api.patch(`/api/marketplace/${existing.id}/`, fields)
          : await api.post('/api/marketplace/', { ...fields, currency: 'NPR' });
        merge({ listings: [mapListing(row)] });
        // The market, the seller's grid and every saved page all list this row.
        ['market', 'profile-listings', 'saved-listings'].forEach(forgetLists);
        showToast(existing ? t('listingUpdated') : t('listingCreated'));
        onSaved(String(row.id));
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The listing could not be saved.');
        setBusy(false);
      }
      return;
    }

    if (existing) {
      setDb(prev => ({
        ...prev,
        listings: prev.listings.map(l => l.id === existing.id ? { ...l, ...values } : l)
      }));
      showToast(t('listingUpdated'));
      onSaved(existing.id);
      onClose();
      return;
    }
    const id = uid();
    setDb(prev => ({
      ...prev,
      listings: [{ id, uid: me.id, ...values, ts: Date.now(), status: 'active' as const }, ...prev.listings]
    }));
    showToast(t('listingCreated'));
    onSaved(id);
    onClose();
  };

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content listing-form-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={existing ? t('editListing') : t('createListing')}>
        <div className="modal-header">
          <b>{existing ? t('editListing') : t('createListing')}</b>
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
                  {IC.camera}<span>{sending ? `${sending.pct}%` : busy ? '…' : t('addPhotos')}</span>
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={e => addFiles(e.target.files)}/>
            <span className="field-count">{media.length}/4</span>
          </div>

          {sending && (
            <div className="create-upload" role="status">
              <span className="create-upload-name">{sending.name}</span>
              <span className="create-upload-track"><i style={{ width: `${sending.pct}%` }} /></span>
              <b className="create-upload-pct">{sending.pct}%</b>
            </div>
          )}

          {media.length < 4 && (
            <div className="listing-url-row">
              <input
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://…jpg"
                aria-label={t('addImageUrl')}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addUrl(); } }}
              />
              <button type="button" className="ghost-btn small" onClick={addUrl} disabled={!url.trim()}>{IC.plus}<span>{t('addImageUrl')}</span></button>
            </div>
          )}

          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="promote-submit" disabled={busy}>{IC.store}{existing ? t('save') : t('createListing')}</button>
        </form>
      </div>
    </div>,
    document.body
  );
}