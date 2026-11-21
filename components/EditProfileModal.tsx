'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '@/lib/AppContext';
import { useBackClose } from '@/lib/useBackClose';
import { COUNTRIES } from '@/lib/utils';
import { profileImage } from '@/lib/mediaFile';
import { API_ENABLED } from '@/lib/api';
import Avatar from './Avatar';
import { IC } from '@/lib/icons';

export default function EditProfileModal({ onClose }: { onClose: () => void }) {
  const { me, setDb, t, showToast, updateProfile } = useApp();
  const [name, setName] = useState(me?.name || '');
  const [bio, setBio] = useState(me?.bio || '');
  const [country, setCountry] = useState(me?.country || 'Nepal');
  const [province, setProvince] = useState(me?.province || '');
  const [city, setCity] = useState(me?.city || '');
  const [avatar, setAvatar] = useState(me?.avatar || '');
  const [cover, setCover] = useState(me?.cover || '');
  const [dob, setDob] = useState(me?.dob || '');
  const [isPrivate, setIsPrivate] = useState(!!me?.private);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  useBackClose(true, onClose);

  if (!me) return null;

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
    const patch = {
      name: name.trim(), bio: bio.trim(), country, province: province.trim(), city: city.trim(),
      avatar: avatar || '', cover: cover || '', dob, private: isPrivate,
    };
    // Demo builds have no server to call, so the cache is the source of truth.
    if (!API_ENABLED) {
      setDb(prev => ({ ...prev, users: prev.users.map(u => u.id === me.id ? { ...u, ...patch } : u) }));
      showToast(t('profileUpdated'));
      onClose();
      return;
    }
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content edit-profile-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={t('editProfile')}>
        <div className="modal-header">
          <b>{t('editProfile')}</b>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t('close')}>{IC.x}</button>
        </div>
        <form className="edit-profile-form" onSubmit={submit}>
          <div className="edit-avatar-row">
            <Avatar user={{ ...me, avatar: avatar || undefined }} size={72} />
            <button type="button" className="edit-avatar-btn" disabled={busy} onClick={() => fileRef.current?.click()}>
              {IC.camera}
              <span>{uploading ? `Uploading ${uploading}%` : busy ? '…' : t('changePhoto')}</span>
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => { void pickImage(e.target.files?.[0], 320, setAvatar); e.target.value = ''; }} />
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
            <input ref={coverRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => { void pickImage(e.target.files?.[0], 1600, setCover); e.target.value = ''; }} />
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
    </div>,
    document.body
  );
}