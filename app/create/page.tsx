'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { useApp } from '@/lib/AppContext';
import Avatar from '@/components/Avatar';
import { IC } from '@/lib/icons';
import { Media } from '@/lib/types';
import { resizeImage, uid, videoDuration, fmtDur } from '@/lib/utils';

const PLACES = ['Kathmandu', 'Pokhara', 'Lalitpur', 'Bhaktapur', 'Chitwan', 'Butwal', 'Dharan', 'Nepalgunj'];
const MOODS = [
  { emoji: '😊', label: 'happy' },
  { emoji: '🥰', label: 'loved' },
  { emoji: '😇', label: 'blessed' },
  { emoji: '🤩', label: 'excited' },
  { emoji: '🙏', label: 'grateful' },
  { emoji: '😌', label: 'calm' },
  { emoji: '🎉', label: 'festive' },
  { emoji: '😴', label: 'tired' }
];
const CHAR_LIMIT = 3000;

export default function CreatePostPage() {
  const router = useRouter();
  const { me, addPost, showToast } = useApp();
  const [text, setText] = useState('');
  const [media, setMedia] = useState<Media[]>([]);
  const [mood, setMood] = useState('');
  const [place, setPlace] = useState('');
  const [placeDraft, setPlaceDraft] = useState('');
  const [panel, setPanel] = useState<'location' | 'feeling' | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);
  const published = useRef(false);

  useEffect(() => {
    if (!me) router.replace('/login');
  }, [me, router]);

  useEffect(() => {
    published.current = false;
    return () => {
      if (!published.current) urls.current.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [text]);

  const attach = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    const next = [...media];
    try {
      for (const file of Array.from(files)) {
        const video = file.type.startsWith('video/');
        if (!video && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP photo, or a video.');
        if (file.size > (video ? 100 : 10) * 1024 * 1024) throw new Error(video ? 'Videos must be under 100 MB.' : 'Photos must be under 10 MB.');
        if (video && next.some(m => m.type === 'video')) throw new Error('One video per post — remove the current clip first.');
        if (!video && next.filter(m => m.type === 'image').length >= 4) throw new Error('You can attach up to four photos.');
        if (video) {
          const src = URL.createObjectURL(file);
          urls.current.push(src);
          const dur = await videoDuration(src);
          if (!Number.isFinite(dur) || dur > 60) throw new Error('Choose a video up to 60 seconds long.');
          next.push({ type: 'video', src, dur });
        } else {
          next.push({ type: 'image', src: await resizeImage(file) });
        }
      }
      setMedia(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This file could not be opened. Try another one.');
    } finally {
      setBusy(false);
    }
  };

  const removeMedia = (index: number) => setMedia(prev => prev.filter((_, i) => i !== index));

  const canPost = !busy && (text.trim().length > 0 || media.length > 0);

  const publish = () => {
    if (!me || !canPost) return;
    published.current = true;
    addPost({
      id: uid(),
      uid: me.id,
      kind: 'post',
      text: text.trim(),
      media,
      ts: Date.now(),
      status: 'live',
      mood: mood || undefined,
      place: place || undefined
    });
    showToast('Post published.');
    router.push('/');
  };

  if (!me) return null;

  const moodMeta = MOODS.find(m => m.label === mood);

  return (
    <AppShell>
      <div className="create-post-page">
        <header className="create-post-header">
          <button type="button" className="icon-btn" aria-label="Back" onClick={() => router.back()}>{IC.back}</button>
          <h1>Create post</h1>
          <button type="button" className="post-btn-header" onClick={publish} disabled={!canPost}>Post</button>
        </header>

        <div className="create-post-body">
          <div className="create-post-author">
            <Avatar user={me} size={44} />
            <div>
              <b className="create-post-name">{me.name}</b>
              <span className="create-audience">{IC.globe} Public</span>
            </div>
          </div>

          <textarea
            ref={textareaRef}
            className="create-post-textarea"
            placeholder={`What's on your mind, ${me.name.split(' ')[0]}?`}
            value={text}
            onChange={e => setText(e.target.value)}
            maxLength={CHAR_LIMIT}
            aria-label="Post caption"
          />

          {(mood || place) && (
            <div className="create-chips">
              {mood && (
                <span className="create-chip mood">
                  <span>{moodMeta?.emoji || '🙂'}</span> feeling {mood}
                  <button type="button" aria-label="Remove feeling" onClick={() => setMood('')}>{IC.x}</button>
                </span>
              )}
              {place && (
                <span className="create-chip place">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" /></svg>
                  {place}
                  <button type="button" aria-label="Remove location" onClick={() => setPlace('')}>{IC.x}</button>
                </span>
              )}
            </div>
          )}

          <div className={`create-media ${media.length === 1 ? 'single' : ''}`}>
            {media.map((item, i) => (
              <div className="create-media-item" key={item.src || i}>
                {item.type === 'video' ? (
                  <>
                    <video src={item.src} muted playsInline preload="metadata" />
                    <span className="create-media-dur">{IC.video}{fmtDur(item.dur || 0)}</span>
                  </>
                ) : (
                  <img src={item.src || item.gen} alt={`Attachment ${i + 1}`} />
                )}
                <button type="button" className="remove-media-btn" aria-label={`Remove attachment ${i + 1}`} onClick={() => removeMedia(i)}>{IC.x}</button>
              </div>
            ))}
            {media.length < 5 && (
              <button type="button" className="create-media-add" disabled={busy} onClick={() => fileRef.current?.click()}>
                <span className="create-media-plus">{IC.plus}</span>
                <span>Photo/video</span>
              </button>
            )}
          </div>

          <div className="create-addons">
            <div className="create-addons-title">Add to your post</div>

            <button type="button" className="create-addon-row" onClick={() => fileRef.current?.click()} disabled={busy}>
              <span className="addon-bubble green">{IC.img}</span>
              <span className="addon-copy">
                <b>Photos/videos</b>
                <small>{media.length ? `${media.length} attached` : 'Up to 4 photos or one clip'}</small>
              </span>
              <span className="addon-go">{IC.plus}</span>
            </button>

            <button
              type="button"
              className={`create-addon-row ${panel === 'location' ? 'open' : ''}`}
              aria-expanded={panel === 'location'}
              onClick={() => { setPanel(p => p === 'location' ? null : 'location'); setPlaceDraft(place); }}
            >
              <span className="addon-bubble red">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" /></svg>
              </span>
              <span className="addon-copy">
                <b>Location</b>
                <small>{place || 'Tag a place'}</small>
              </span>
              <span className={`addon-chev ${panel === 'location' ? 'open' : ''}`}>{IC.chev}</span>
            </button>
            <div className={`addon-panel ${panel === 'location' ? 'open' : ''}`}>
              <div className="addon-panel-inner">
                <form
                  className="place-form"
                  onSubmit={e => {
                    e.preventDefault();
                    if (placeDraft.trim()) { setPlace(placeDraft.trim()); setPanel(null); }
                  }}
                >
                  <input
                    type="text"
                    name="location"
                    autoComplete="off"
                    enterKeyHint="done"
                    placeholder="Search or type a place…"
                    value={placeDraft}
                    maxLength={60}
                    onChange={e => setPlaceDraft(e.target.value)}
                    aria-label="Location"
                  />
                  <button type="submit" disabled={!placeDraft.trim()}>Save</button>
                </form>
                <div className="place-suggestions">
                  {PLACES.filter(p => !placeDraft || p.toLowerCase().includes(placeDraft.toLowerCase())).map(p => (
                    <button type="button" key={p} className={place === p ? 'on' : ''} onClick={() => { setPlace(p); setPanel(null); }}>{p}</button>
                  ))}
                </div>
              </div>
            </div>

            <button
              type="button"
              className={`create-addon-row ${panel === 'feeling' ? 'open' : ''}`}
              aria-expanded={panel === 'feeling'}
              onClick={() => setPanel(p => p === 'feeling' ? null : 'feeling')}
            >
              <span className="addon-bubble amber">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" /></svg>
              </span>
              <span className="addon-copy">
                <b>Feeling/activity</b>
                <small>{mood ? `${moodMeta?.emoji || '🙂'} feeling ${mood}` : 'How are you feeling?'}</small>
              </span>
              <span className={`addon-chev ${panel === 'feeling' ? 'open' : ''}`}>{IC.chev}</span>
            </button>
            <div className={`addon-panel ${panel === 'feeling' ? 'open' : ''}`}>
              <div className="addon-panel-inner">
                <div className="mood-grid">
                  {MOODS.map(m => (
                    <button type="button" key={m.label} className={mood === m.label ? 'on' : ''} onClick={() => { setMood(m.label); setPanel(null); }}>
                      <span>{m.emoji}</span>{m.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {busy && <p className="create-feedback" role="status">Preparing your attachment…</p>}
          {error && <p className="create-feedback error" role="alert">{error}</p>}
        </div>

        <footer className="create-post-footer">
          <span className={`char-count ${text.length > CHAR_LIMIT - 100 ? 'warning' : ''}`}>{text.length}/{CHAR_LIMIT}</span>
          <button type="button" className="create-publish" onClick={publish} disabled={!canPost}>Post</button>
        </footer>

        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,video/*"
          multiple
          hidden
          onChange={e => { void attach(e.target.files); e.target.value = ''; }}
        />
      </div>
    </AppShell>
  );
}
