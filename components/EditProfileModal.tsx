'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '@/lib/AppContext';
import { useBackClose } from '@/lib/useBackClose';
import { COUNTRIES, safeUrl } from '@/lib/utils';
import { checkPhoto, profileImage } from '@/lib/mediaFile';
import { ProfileLink } from '@/lib/types';
import Avatar from './Avatar';
import ImageCropper from './ImageCropper';
import { IC } from '@/lib/icons';

export default function EditProfileModal({ onClose }: { onClose: () => void }) {
  const { me, t, showToast, updateProfile } = useApp();
  const [name, setName] = useState(me?.name || '');
  const [bio, setBio] = useState(me?.bio || '');
  const [country, setCountry] = useState(me?.country || 'Nepal');
  const [province, setProvince] = useState(me?.province || '');
  const [city, setCity] = useState(me?.city || '');
  const [avatar, setAvatar] = useState(me?.avatar || '');
  const [cover, setCover] = useState(me?.cover || '');
  const [dob, setDob] = useState(me?.dob || '');
  const [phone, setPhone] = useState(me?.phone || '');
  const [website, setWebsite] = useState(me?.website || '');
  const [links, setLinks] = useState<ProfileLink[]>(me?.links || []);
  const [isPrivate, setIsPrivate] = useState(!!me?.private);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const [crop, setCrop] = useState<{ src: string; kind: 'avatar' | 'cover' } | null>(null);
  const cropSrc = useRef('');

  useBackClose(true, onClose);

  useEffect(() => () => { if (cropSrc.current) URL.revokeObjectURL(cropSrc.current); }, []);

  if (!me) return null;

  const stopCrop = () => {
    if (cropSrc.current) URL.revokeObjectURL(cropSrc.current);
    cropSrc.current = '';
    setCrop(null);
  };

  // The crop runs before a byte leaves the device, so the author decides which part
  // of the picture exists at all rather than which part the frame happens to show.
  const openCrop = (file: File | undefined, kind: 'avatar' | 'cover') => {
    if (!file) return;
    try {
      checkPhoto(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That image could not be read. Try another one.');
      return;
    }
    const url = URL.createObjectURL(file);
    cropSrc.current = url;
    setCrop({ src: url, kind });
  };

  const useCrop = async (file: File) => {
    const kind = crop?.kind;
    stopCrop();
    if (!kind) return;
    await pickImage(file, kind === 'avatar' ? 320 : 1600, kind === 'avatar' ? setAvatar : setCover);
  };

  const pickImage = async (file: File | undefined, max: number, apply: (src: string) => void) => {
    if (!file) return;
    setBusy(true);
    setUploading(0);
    setError('');
    try {
      apply(await profileImage(file, max, (sent, total) => setUploading(total > 0 ? Math.min(99, Math.round(sent / total * 100)) : 0)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That image could not be read. Try another one.');
    } finally {
      setBusy(false);
      setUploading(0);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('A display name is needed before saving.');
      return;
    }
    if (phone.trim() && !/^[+]?[0-9 ()-]{6,40}$/.test(phone.trim())) {
      setError(t('phoneBad'));
      return;
    }
    if (website.trim() && !safeUrl(website)) {
      setError(t('linkBad'));
      return;
    }
    const filled = links.filter(l => l.url.trim() || l.label.trim());
    for (const row of filled) {
      if (!safeUrl(row.url)) {
        setError(t('linkBad'));
        return;
      }
    }
    const patch = {
      name: name.trim(), bio: bio.trim(), country, province: province.trim(), city: city.trim(),
      avatar: avatar || '', cover: cover || '', dob, private: isPrivate,
      phone: phone.trim(), website: website.trim(),
      links: filled.map(l => ({ label: l.label.trim() || new URL(l.url).hostname, url: (safeUrl(l.url) as string) }))
    };
    setBusy(true);
    setError('');
    try {
      await updateProfile(patch);
      showToast(t('profileUpdated'));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your profile could not be saved.');
      setBusy(false);
    }
  };

  return createPortal(
    <>
      <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content edit-profile-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={t('editProfile')}>
        <div className="modal-header">
          <b>{t('editProfile')}</b>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t('close')}>{IC.x}</button>
        </div>
        {/* Native url bubbles are untranslated and preempt the app's own instruction. */}
        <form className="edit-profile-form" onSubmit={submit} noValidate>
          <div className="edit-avatar-row">
            <Avatar user={{ ...me, avatar: avatar || undefined }} size={72} />
            <button type="button" className="edit-avatar-btn" disabled={busy} onClick={() => fileRef.current?.click()}>
              {IC.camera}
              <span>{uploading ? `Uploading ${uploading}%` : busy ? '…' : t('changePhoto')}</span>
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => { openCrop(e.target.files?.[0], 'avatar'); e.target.value = ''; }} />
          </div>
          <div className="edit-cover-row">
            <div className="edit-cover-preview" style={cover ? { backgroundImage: `url(${cover})` } : undefined}>
              {!cover && <span>{IC.img}</span>}
            </div>
            <button type="button" className="edit-avatar-btn" disabled={busy} onClick={() => coverRef.current?.click()}>
              {IC.camera}
              <span>{uploading ? `Uploading ${uploading}%` : busy ? '…' : t('changeCover')}</span>
            </button>
            {cover && <button type="button" className="edit-cover-clear" onClick={() => setCover('')} aria-label={t('close')}>{IC.x}</button>}
            <input ref={coverRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => { openCrop(e.target.files?.[0], 'cover'); e.target.value = ''; }} />
          </div>
          <label className="field">
            <span>{t('fullName')}</span>
            <input type="text" value={name} maxLength={60} onChange={e => setName(e.target.value)} autoComplete="off" />
          </label>
          <label className="field">
            <span>{t('bio')}</span>
            <textarea value={bio} maxLength={160} rows={3} onChange={e => setBio(e.target.value)} placeholder={t('bio')} />
            <small className="field-count">{bio.length}/160</small>
          </label>
          <label className="field">
            <span>{t('dob')}</span>
            <input type="date" value={dob} onChange={e => setDob(e.target.value)} />
          </label>
          <div className="field-row">
            <label className="field">
              <span>{t('country')}</span>
              <select value={country} onChange={e => setCountry(e.target.value)}>
                {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{t('province')}</span>
              <input type="text" value={province} maxLength={40} onChange={e => setProvince(e.target.value)} autoComplete="off" />
            </label>
          </div>
          <label className="field">
            <span>{t('city')}</span>
            <input type="text" value={city} maxLength={40} onChange={e => setCity(e.target.value)} autoComplete="off" />
          </label>
          <div className="field-row">
            <label className="field">
              <span>{t('phone')}</span>
              <input type="tel" value={phone} maxLength={40} onChange={e => setPhone(e.target.value)} placeholder="+977 98 00000000" autoComplete="off" />
            </label>
            <label className="field">
              <span>{t('website')}</span>
              <input type="url" value={website} maxLength={160} onChange={e => setWebsite(e.target.value)} placeholder={t('linkUrl')} autoComplete="off" />
            </label>
          </div>
          <div className="edit-links">
            <span className="edit-links-title">{t('links')}</span>
            {links.map((row, i) => (
              <div className="edit-link-row" key={i}>
                <input
                  type="text"
                  className="edit-link-label"
                  value={row.label}
                  maxLength={40}
                  placeholder={t('linkLabel')}
                  autoComplete="off"
                  onChange={e => setLinks(prev => prev.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))}
                />
                <input
                  type="url"
                  className="edit-link-url"
                  value={row.url}
                  maxLength={300}
                  placeholder={t('linkUrl')}
                  autoComplete="off"
                  onChange={e => setLinks(prev => prev.map((r, j) => (j === i ? { ...r, url: e.target.value } : r)))}
                />
                <button type="button" className="edit-link-remove" aria-label={t('removeLink')} onClick={() => setLinks(prev => prev.filter((_, j) => j !== i))}>{IC.x}</button>
              </div>
            ))}
            {links.length < 8 && (
              <button type="button" className="edit-link-add" onClick={() => setLinks(prev => [...prev, { label: '', url: '' }])}>{IC.plus}<span>{t('addLink')}</span></button>
            )}
          </div>
          <label className="edit-private-row">
            <span className="edit-private-copy">
              <b>{t('privateToggle')}</b>
              <small>{t('privateToggleSub')}</small>
            </span>
            <input type="checkbox" checked={isPrivate} onChange={e => setIsPrivate(e.target.checked)} />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="promote-submit" disabled={busy}>{busy && !uploading ? 'Saving…' : t('save')}</button>
        </form>
      </div>
      </div>
      {crop && (
        <ImageCropper
          src={crop.src}
          name={crop.kind === 'avatar' ? 'avatar.jpg' : 'cover.jpg'}
          ratio={crop.kind === 'avatar' ? 1 : 2.4}
          round={crop.kind === 'avatar'}
          max={crop.kind === 'avatar' ? 320 : 1600}
          onCancel={stopCrop}
          onCrop={file => { void useCrop(file); }}
        />
      )}
    </>,
    document.body
  );
}