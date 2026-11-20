'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '@/lib/AppContext';
import { useBackClose } from '@/lib/useBackClose';
import { COUNTRIES, resizeImage } from '@/lib/utils';
import Avatar from './Avatar';
import { IC } from '@/lib/icons';

export default function EditProfileModal({ onClose }: { onClose: () => void }) {
  const { me, setDb, t, showToast } = useApp();
  const [name, setName] = useState(me?.name || '');
  const [bio, setBio] = useState(me?.bio || '');
  const [country, setCountry] = useState(me?.country || 'Nepal');
  const [province, setProvince] = useState(me?.province || '');
  const [city, setCity] = useState(me?.city || '');
  const [avatar, setAvatar] = useState(me?.avatar || '');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useBackClose(true, onClose);

  if (!me) return null;

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      setAvatar(await resizeImage(file));
    } catch {
      showToast(t('e_type'));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setDb(prev => ({
      ...prev,
      users: prev.users.map(u => u.id === me.id ? { ...u, name: name.trim() || u.username, bio: bio.trim(), country, province: province.trim(), city: city.trim(), avatar: avatar || undefined } : u)
    }));
    showToast(t('profileUpdated'));
    onClose();
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
              <span>{busy ? '…' : t('changePhoto')}</span>
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => { void pickAvatar(e.target.files?.[0]); e.target.value = ''; }} />
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
          <button type="submit" className="promote-submit" disabled={busy}>{t('save')}</button>
        </form>
      </div>
    </div>,
    document.body
  );
}