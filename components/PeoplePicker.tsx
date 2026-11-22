'use client';

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Avatar from '@/components/Avatar';
import VerifiedBadge from '@/components/VerifiedBadge';
import { useApp } from '@/lib/AppContext';
import { useBackClose } from '@/lib/useBackClose';
import { IC } from '@/lib/icons';
import { User } from '@/lib/types';

interface PeoplePickerProps {
  title: string;
  exclude?: string[];
  onSelect: (user: User) => void;
  onClose: () => void;
}

export default function PeoplePicker({ title, exclude = [], onSelect, onClose }: PeoplePickerProps) {
  const { db, t } = useApp();
  const [q, setQ] = useState('');
  useBackClose(true, onClose);

  const people = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return db.users
      .filter(u => !exclude.includes(u.id) && !u.susp)
      .filter(u => !needle || u.name.toLowerCase().includes(needle) || u.username.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [db.users, exclude, q]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    // The root keeps a top-bar panel that opened this picker alive: the overlay
    // lives outside that panel's box, and dismissing on a click inside the
    // picker would take the picker — and the press meant for it — away.
    <div className="modal-overlay" data-stays-open onClick={onClose}>
      <div className="modal-content people-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="modal-header">
          <b>{title}</b>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t('close')}>{IC.x}</button>
        </div>
        <div className="people-search">
          {IC.search}
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={t('searchPeople')}
            aria-label={t('searchPeople')}
          />
        </div>
        <div className="people-list">
          {people.length === 0 ? (
            <p className="feed-empty">{t('noUser')}</p>
          ) : people.map(u => (
            <button type="button" key={u.id} className="people-row people-pick" onClick={() => onSelect(u)}>
              <Avatar user={u} size={44}/>
              <span className="people-meta">
                <b>{u.name}{u.verified && <VerifiedBadge/>}</b>
                <small>@{u.username}</small>
              </span>
              {IC.chev}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}