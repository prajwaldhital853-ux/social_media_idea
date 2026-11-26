'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '@/lib/AppContext';
import { api } from '@/lib/api';
import { useBackClose } from '@/lib/useBackClose';
import { User } from '@/lib/types';
import Avatar from './Avatar';
import { IC } from '@/lib/icons';

/** Where the last few in-app shares went, so the sheet opens with faces. */
const RECENT_KEY = 'exposing-shared-with';

export interface SharePreview {
  title: string;
  subtitle?: string;
  image?: string;
  video?: string;
}

interface ShareDialogProps {
  open: boolean;
  url: string;
  title: string;
  text?: string;
  preview?: SharePreview;
  onShared: () => void;
  onClose: () => void;
}

function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(x => typeof x === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

function remember(username: string) {
  const next = [username, ...readRecent().filter(name => name !== username)].slice(0, 8);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* private mode */ }
}

export default function ShareDialog({ open, url, title, text, preview, onShared, onClose }: ShareDialogProps) {
  const { db, me, t, serverMode, sendMessage, showToast, merge } = useApp();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<User[] | null>(null);
  // People are picked, not messaged: the sheet collects as many as the reader
  // chooses and asks once before anything leaves.
  const [picked, setPicked] = useState<User[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useBackClose(open, onClose);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setFound(null);
    setPicked([]);
    setConfirming(false);
    setRecent(readRecent());
  }, [open]);

  // The page behind the sheet stays where it is: a wheel or swipe outside the
  // sheet would otherwise scroll the feed under a dialog still in use.
  useEffect(() => {
    if (!open) return;
    const had = document.body.classList.contains('noscroll');
    document.body.classList.add('noscroll');
    return () => { if (!had) document.body.classList.remove('noscroll'); };
  }, [open]);

  // People the viewer follows, minus themselves: the sheet's first row of faces.
  const following = useMemo(() => {
    if (!me) return [] as User[];
    return db.follows
      .filter(f => f.follower === me.id && f.status !== 'pending' && f.following !== me.id)
      .map(f => db.users.find(u => u.id === f.following))
      .filter((u): u is User => !!u);
  }, [db.follows, db.users, me]);

  const recentPeople = useMemo(
    () => recent.map(name => db.users.find(u => u.username === name)).filter((u): u is User => !!u),
    [recent, db.users],
  );

  useEffect(() => {
    const q = query.trim().replace(/^@/, '');
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!q) { setFound(null); return; }
    searchTimer.current = setTimeout(() => {
      if (!serverMode) {
        setFound(db.users.filter(u => u.username.toLowerCase().includes(q.toLowerCase())
          || (u.name || '').toLowerCase().includes(q.toLowerCase())).slice(0, 24));
        return;
      }
      api.get<{ results: any[] }>('/api/users/', { q })
        .then(page => setFound((page?.results || []).map((row: any) => ({
          id: String(row.id), username: row.username, name: row.name || row.username,
          avatar: row.avatar_url || '', bio: row.bio || '', joined: row.joined || '',
        } as unknown as User))))
        .catch(() => setFound([]));
    }, 220);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [query, serverMode, db.users]);

  if (!open || typeof document === 'undefined') return null;

  const togglePerson = (person: User) => {
    setPicked(prev => prev.some(p => p.id === person.id)
      ? prev.filter(p => p.id !== person.id)
      : [...prev, person]);
  };

  // Search hits may be people the cache has never held; the message call
  // resolves a person by id, so every row has to land first.
  const sendToAll = async () => {
    setSending(true);
    let failed = 0;
    for (const person of picked) {
      try {
        merge({ users: [person] });
        await sendMessage(person.id, `${text || title}\n${url}`);
        remember(person.username);
      } catch {
        failed += 1;
      }
    }
    setSending(false);
    if (failed === picked.length) {
      showToast(t('shareFailed'));
      return;
    }
    if (picked.length === 1) showToast(t('shareSent').replace('{name}', picked[0].name || picked[0].username));
    else showToast(t('shareSentMany').replace('{count}', String(picked.length)));
    onShared();
    onClose();
  };

  const openApp = (href: string) => {
    window.open(href, '_blank', 'noopener,noreferrer');
    onShared();
    onClose();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      showToast(t('linkCopied'));
      onShared();
      onClose();
    } catch {
      showToast(url);
    }
  };

  // No web dialog exists for Messenger: a phone hands the link to the app's own
  // composer, and a desktop copies it and opens messenger.com to paste from.
  const shareMessenger = () => {
    if (/Android/i.test(navigator.userAgent)) {
      const fallback = encodeURIComponent('https://www.messenger.com/');
      window.location.href = `intent://share/?link=${link}#Intent;package=com.facebook.orca;scheme=fb-messenger;S.browser_fallback_url=${fallback};end`;
      onShared();
      onClose();
      return;
    }
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      window.location.href = `fb-messenger://share/?link=${link}`;
      // An iPhone without the app ignores the scheme; then the link is copied
      // and messenger.com opens so the share still happens somewhere.
      setTimeout(async () => {
        if (document.visibilityState !== 'visible') return;
        try { await navigator.clipboard.writeText(url); showToast(t('messengerCopied')); } catch { /* clipboard refused */ }
        window.open('https://www.messenger.com/', '_blank', 'noopener,noreferrer');
      }, 1200);
      onShared();
      onClose();
      return;
    }
    void navigator.clipboard.writeText(url)
      .then(() => showToast(t('messengerCopied')))
      .catch(() => { /* private mode */ });
    openApp('https://www.messenger.com/');
  };

  // Instagram accepts no share from the web: the link goes to the clipboard
  // first, then the app (phone) or the site (desktop) opens for the paste.
  const shareInstagram = async () => {
    try { await navigator.clipboard.writeText(url); showToast(t('instagramCopied')); } catch { /* clipboard refused; open anyway */ }
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) window.location.href = 'instagram://app';
    else openApp('https://www.instagram.com/');
  };

  const message = encodeURIComponent(`${text || title} ${url}`);
  const link = encodeURIComponent(url);
  const subject = encodeURIComponent(title);

  const apps = [
    { key: 'copy', label: t('copyLink'), mark: <span className="share-mark">{IC.link}</span>, run: () => { void copy(); } },
    { key: 'whatsapp', label: 'WhatsApp', mark: <span className="share-mark wa">{IC.phone}</span>, run: () => openApp(`https://wa.me/?text=${message}`) },
    { key: 'facebook', label: 'Facebook', mark: <span className="share-mark fb">{IC.fb}</span>, run: () => openApp(`https://www.facebook.com/sharer/sharer.php?u=${link}`) },
    { key: 'messenger', label: 'Messenger', mark: <span className="share-mark ms">{IC.msg}</span>, run: () => shareMessenger() },
    { key: 'instagram', label: 'Instagram', mark: <span className="share-mark ig">{IC.camera}</span>, run: () => { void shareInstagram(); } },
    { key: 'email', label: 'Email', mark: <span className="share-mark">{IC.send}</span>, run: () => openApp(`mailto:?subject=${subject}&body=${message}`) },
    { key: 'x', label: 'X', mark: <span className="share-mark x">X</span>, run: () => openApp(`https://twitter.com/intent/tweet?text=${message}`) },
  ];

  const people = found ?? (recentPeople.length ? recentPeople : following);
  const heading = found ? t('shareSearch') : recentPeople.length ? t('shareRecent') : t('shareFollow');

  return createPortal(
    <div className="modal-overlay share-overlay" onClick={onClose}>
      <div className="share-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('share')}>
        <div className="share-head">
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('close')}>{IC.x}</button>
          <b>{t('share')}</b>
          <span className="share-head-spacer" />
        </div>

        <label className="share-search">
          {IC.search}
          <input
            type="search"
            value={query}
            onChange={e => { setQuery(e.target.value); setConfirming(false); }}
            placeholder={t('shareSearch')}
            autoComplete="off"
          />
        </label>

        {preview && (
          <a className="share-preview" href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
            <span className="share-preview-art">
              {preview.image
                ? <img src={preview.image} alt="" loading="lazy" />
                : preview.video
                  ? <video src={preview.video} muted playsInline preload="metadata" />
                  : <span className="share-preview-fallback">{IC.video}</span>}
              {preview.video && <span className="share-preview-play">{IC.video}</span>}
            </span>
            <span className="share-preview-copy">
              <b>{preview.title}</b>
              {preview.subtitle && <small>{preview.subtitle}</small>}
              <small className="share-preview-host">{url.replace(/^https?:\/\//, '').split('/')[0]}</small>
            </span>
          </a>
        )}

        <div className="share-people">
          {confirming ? (
            <div className="share-confirm">
              <span className="share-confirm-faces">
                {picked.slice(0, 4).map(person => <Avatar key={person.id} user={person} size={picked.length === 1 ? 64 : 44} />)}
                {picked.length > 4 && <span className="share-confirm-more">+{picked.length - 4}</span>}
              </span>
              <b>
                {picked.length === 1
                  ? t('shareConfirm').replace('{name}', picked[0].name || picked[0].username)
                  : t('shareConfirmMany').replace('{count}', String(picked.length))}
              </b>
              <span className="share-confirm-handle">
                {picked.length === 1
                  ? `@${picked[0].username}`
                  : picked.map(p => p.name || p.username).join(', ')}
              </span>
              <div className="share-confirm-actions">
                <button type="button" className="ghost-btn" disabled={sending} onClick={() => setConfirming(false)}>{t('cancel')}</button>
                <button type="button" className="share-confirm-send" disabled={sending} onClick={() => void sendToAll()}>
                  {IC.send}{t('send')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <span className="share-section-label">{heading}</span>
              {people.length === 0 ? (
                <p className="share-empty">{t('shareSearch')}</p>
              ) : (
                <div className="share-grid">
                  {people.map(person => {
                    const on = picked.some(p => p.id === person.id);
                    return (
                      <button
                        type="button"
                        key={person.username}
                        className={`share-person ${on ? 'selected' : ''}`}
                        aria-pressed={on}
                        onClick={() => togglePerson(person)}
                      >
                        <Avatar user={person} size={64} />
                        <b>{person.name || person.username}</b>
                        {on && <span className="share-person-pick">{IC.check}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {picked.length > 0 && !confirming && (
          <div className="share-sendbar">
            <span className="share-sendbar-names">{picked.map(p => p.name || p.username).join(', ')}</span>
            <button type="button" className="share-confirm-send" onClick={() => setConfirming(true)}>
              {IC.send}{t('send')}
            </button>
          </div>
        )}

        <div className="share-apps">
          <span className="share-section-label">{t('shareVia')}</span>
          <div className="share-app-row">
            {apps.map(app => (
              <button type="button" key={app.key} className="share-app" onClick={app.run}>
                {app.mark}
                <span>{app.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
