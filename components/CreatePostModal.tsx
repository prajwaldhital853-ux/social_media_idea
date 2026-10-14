'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Media, User } from '@/lib/types';
import Avatar from './Avatar';

const MAX = 500;
const MOODS = ['\u{1F60A} Grateful', '\u26F0 Adventurous', '\u2615 Chill', '\u{1F389} Celebrating', '\u{1F4AD} Thoughtful', '\u{1F525} Motivated'];

interface Props {
  me: User;
  open: boolean;
  onClose: () => void;
  onPublish: (text: string, media: Media[]) => void;
}

export default function CreatePostModal({ me, open, onClose, onPublish }: Props) {
  const [text, setText] = useState('');
  const [media, setMedia] = useState<Media[]>([]);
  const [audience, setAudience] = useState<'everyone' | 'circle'>('everyone');
  const [mood, setMood] = useState<string | null>(null);
  const [place, setPlace] = useState('');
  const [showPlace, setShowPlace] = useState(false);
  const [showMoods, setShowMoods] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => areaRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const first = me.name.split(' ')[0] || me.username;
  const left = MAX - text.length;
  const canPost = text.trim().length > 0 || media.length > 0;
  const pct = Math.min(text.length / MAX, 1);

  const pickFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).slice(0, 4 - media.length).forEach(f => {
      const isVideo = f.type.startsWith('video');
      if (isVideo) {
        setMedia(m => [...m, { type: 'video', src: URL.createObjectURL(f) }]);
      } else {
        const r = new FileReader();
        r.onload = () => setMedia(m => [...m, { type: 'image', src: String(r.result) }]);
        r.readAsDataURL(f);
      }
    });
  };

  const publish = () => {
    if (!canPost) return;
    let body = text.trim();
    const extras = [mood ? `feeling ${mood}` : '', place.trim() ? `\u{1F4CD} ${place.trim()}` : ''].filter(Boolean);
    if (extras.length) body += (body ? '\n\n' : '') + extras.join('  ·  ');
    onPublish(body, media);
    setText(''); setMedia([]); setMood(null); setPlace(''); setShowPlace(false); setShowMoods(false);
    onClose();
  };

  return createPortal(
    <div className="cp-overlay" onClick={onClose}>
      <div className="cp-card" onClick={e => e.stopPropagation()} role="dialog" aria-label="Create a post">
        <div className="cp-head">
          <button type="button" className="cp-icon" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          <div className="cp-title">
            <span>New moment</span>
            <small>Share it with the Chautari</small>
          </div>
          <button type="button" className="cp-publish-mini" disabled={!canPost} onClick={publish}>Share</button>
        </div>

        <div className="cp-body">
          <div className="cp-author">
            <Avatar user={me} size={44} />
            <div>
              <b>{me.name || me.username}</b>
              <div className="cp-audience">
                <button type="button" className={audience === 'everyone' ? 'on' : ''} onClick={() => setAudience('everyone')}>Everyone</button>
                <button type="button" className={audience === 'circle' ? 'on' : ''} onClick={() => setAudience('circle')}>My circle</button>
              </div>
            </div>
          </div>

          <textarea
            ref={areaRef}
            className="cp-text"
            placeholder={`Pull up a seat, ${first}. What's the story today?`}
            value={text}
            maxLength={MAX}
            onChange={e => setText(e.target.value)}
          />

          {(mood || place.trim()) && (
            <div className="cp-tags">
              {mood && <span onClick={() => setMood(null)}>feeling {mood} {'\u2715'}</span>}
              {place.trim() && <span onClick={() => setPlace('')}>{'\u{1F4CD} '}{place} {'\u2715'}</span>}
            </div>
          )}

          {media.length > 0 && (
            <div className={`cp-media n${media.length}`}>
              {media.map((m, i) => (
                <div key={i} className="cp-thumb">
                  {m.type === 'video' ? <video src={m.src} muted /> : <img src={m.src} alt="" />}
                  <button type="button" onClick={() => setMedia(ms => ms.filter((_, j) => j !== i))} aria-label="Remove">{'\u2715'}</button>
                </div>
              ))}
            </div>
          )}

          {showMoods && (
            <div className="cp-moods">
              {MOODS.map(m => (
                <button key={m} type="button" className={mood === m ? 'on' : ''} onClick={() => { setMood(m); setShowMoods(false); }}>{m}</button>
              ))}
            </div>
          )}

          {showPlace && (
            <input className="cp-place" placeholder="Where are you? e.g. Pokhara" value={place} onChange={e => setPlace(e.target.value)} />
          )}

          <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={e => { pickFiles(e.target.files); e.target.value = ''; }} />

          <div className="cp-tools">
            <button type="button" className="t-photo" onClick={() => fileRef.current?.click()}><i>{'\u{1F4F7}'}</i><span>Photo / Video</span></button>
            <button type="button" className="t-mood" onClick={() => setShowMoods(v => !v)}><i>{'\u{1F642}'}</i><span>Mood</span></button>
            <button type="button" className="t-place" onClick={() => setShowPlace(v => !v)}><i>{'\u{1F4CD}'}</i><span>Place</span></button>
            <button type="button" className="t-live"><i>{'\u{1F3A5}'}</i><span>Go live</span></button>
          </div>
        </div>

        <div className="cp-foot">
          <div className="cp-ring" style={{ ['--p' as string]: pct } as React.CSSProperties} title={`${left} characters left`}>
            <span className={left < 40 ? 'warn' : ''}>{left}</span>
          </div>
          <button type="button" className="cp-publish" disabled={!canPost} onClick={publish}>
            Share moment
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
