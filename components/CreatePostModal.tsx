'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Media, Post } from '@/lib/types';
import { useApp, PromoConfig } from '@/lib/AppContext';
import { resizeImage, uid, videoDuration } from '@/lib/utils';
import { IC } from '@/lib/icons';
import Avatar from './Avatar';
import PromoteForm from './PromoteForm';

function Composer({ original }: { original?: Post }) {
  const { me, t, closeComposer, addPost, updatePost, showToast, requestPromotion, feature } = useApp();
  const [stage, setStage] = useState<'choose' | 'post' | 'reel'>(original ? original.kind || 'post' : 'choose');
  const [text, setText] = useState(original?.text || '');
  const [media, setMedia] = useState<Media[]>(original?.media || []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [promote, setPromote] = useState(false);
  const [promoConfig, setPromoConfig] = useState<PromoConfig | null>(null);
  const [closing, setClosing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const urls = useRef<string[]>([]);
  const published = useRef(false);
  const alive = useRef(true);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestClose = () => {
    if (closeTimer.current) return;
    setClosing(true);
    closeTimer.current = setTimeout(closeComposer, 190);
  };

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  useEffect(() => {
    alive.current = true;
    const overflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      alive.current = false;
      document.body.style.overflow = overflow;
      previousFocus?.focus();
      if (!published.current) urls.current.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (stage === 'post') areaRef.current?.focus();
  }, [stage]);

  const attach = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    const next = [...media];
    try {
      for (const file of Array.from(files)) {
        const video = file.type.startsWith('video/');
        if (!video && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG, WebP photo or a video.');
        if (file.size > (video ? 100 : 10) * 1024 * 1024) throw new Error(video ? 'Videos must be under 100 MB.' : 'Photos must be under 10 MB.');
        if (video && next.some(m => m.type === 'video')) throw new Error('Choose one video at a time.');
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
      if (alive.current) {
        setMedia(next);
        if (stage === 'choose') setStage('reel');
      }
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : 'This file could not be opened. Try another file.');
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const canPost = !busy && (text.trim().length > 0 || media.length > 0) && (stage !== 'reel' || media.length > 0) && (!promote || !!promoConfig);
  const publish = () => {
    if (!me || !canPost) return;
    if (!me.emailVerified || (me.susp && (!me.susp.until || me.susp.until > Date.now()))) {
      setError('A verified, active account is needed to post.');
      return;
    }
    const id = original?.id || uid();
    if (original) updatePost(id, { text: text.trim(), media, edited: true });
    else addPost({ id, uid: me.id, kind: stage === 'reel' ? 'reel' : 'post', text: text.trim(), media, ts: Date.now(), status: 'live' });
    if (promote && promoConfig) requestPromotion('post', id, promoConfig);
    published.current = true;
    showToast(original ? 'Post updated.' : stage === 'reel' ? 'Reel posted.' : 'Post published.');
    requestClose();
  };

  return createPortal(
    <div className={`cp-overlay ${closing ? 'closing' : ''}`} onClick={requestClose}>
      <div className={`cp-card ${stage === 'choose' ? 'cp-choose' : ''}`} ref={dialogRef} tabIndex={-1} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="composer-title" onKeyDown={e => {
        if (e.key === 'Escape') requestClose();
        if (e.key !== 'Tab') return;
        const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not([hidden]), textarea, select');
        if (!nodes?.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }}>
        <div className="cp-head">
          <b id="composer-title">{stage === 'choose' ? 'Create' : original ? 'Edit post' : stage === 'reel' ? 'Create reel' : 'Create post'}</b>
          <button type="button" className="icon-btn cp-close" onClick={requestClose} aria-label="Close composer">{IC.x}</button>
        </div>
        {!me ? <div className="cp-body"><p>Sign in to create a post or reel.</p><Link className="composer-signin" href="/login" onClick={requestClose}>Sign in</Link></div> : <>
          <input ref={fileRef} type="file" aria-label="Attach photos or video" accept="image/jpeg,image/png,image/webp,video/*" multiple hidden onChange={e => { void attach(e.target.files); e.target.value = ''; }} />
          {stage === 'choose' ? <div className="create-options">
            <button type="button" onClick={() => setStage('post')} disabled={busy}>{IC.img}<span><b>Post</b><small>Share a thought or a photo</small></span>{IC.plus}</button>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>{IC.video}<span><b>Reel</b><small>Choose a video or photo</small></span>{IC.plus}</button>
          </div> : <>
            <div className="cp-body">
              <div className="cp-author"><Avatar user={me} size={40} /><div><b>{me.name}</b><span className="cp-public">{IC.globe} Public</span></div></div>
              <textarea ref={areaRef} className="cp-text" aria-label="Post caption" placeholder={stage === 'reel' ? 'Add a caption…' : 'What would you like to share?'} value={text} maxLength={500} onChange={e => setText(e.target.value)} />
              {media.length > 0 && <div className={`cp-media n${media.length}`}>
                {media.map((item, i) => <div key={item.src || i} className="cp-thumb">
                  {item.type === 'video' ? <video src={item.src} controls playsInline preload="metadata" /> : <img src={item.src || item.gen} alt={`Attachment ${i + 1}`} />}
                  <button type="button" aria-label={`Remove attachment ${i + 1}`} onClick={() => setMedia(current => current.filter((_, j) => i !== j))}>{IC.x}</button>
                </div>)}
              </div>}
              <button type="button" className="cp-attach" disabled={busy} onClick={() => fileRef.current?.click()}>{IC.img} Add photos or video</button>
              {feature('promotion') && !original && <label className="cp-promote-toggle"><span>{t('promoteSection')}<small>Optional · paid with Coins</small></span><input type="checkbox" checked={promote} onChange={e => setPromote(e.target.checked)} /></label>}
              {promote && <PromoteForm targetType="post" confirmLabel="Use this promotion" onConfirm={cfg => setPromoConfig(cfg)} />}
              {promote && promoConfig && <small>Promotion selected. It will be requested when you post.</small>}
            </div>
            <div className="cp-foot"><span className="cp-count">{text.length}/500</span><button type="button" className="cp-publish" disabled={!canPost} onClick={publish}>{original ? 'Save changes' : stage === 'reel' ? 'Post reel' : 'Post'}</button></div>
          </>}
          {busy && <p className="cp-feedback" role="status">Preparing your attachment…</p>}
          {error && <p className="cp-feedback cp-error" role="alert">{error}</p>}
        </>}
      </div>
    </div>, document.body
  );
}

export default function CreatePostModal() {
  const { composerPostId, db } = useApp();
  if (composerPostId === undefined || typeof document === 'undefined') return null;
  const original = composerPostId ? db.posts.find(p => p.id === composerPostId) : undefined;
  return <Composer key={composerPostId || 'new'} original={original} />;
}
