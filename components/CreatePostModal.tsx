'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Media, Post } from '@/lib/types';
import { useApp, PromoConfig } from '@/lib/AppContext';
import { uid, videoDuration } from '@/lib/utils';
import { imageFromFile } from '@/lib/mediaFile';
import { uploadFile, Progress } from '@/lib/upload';
import { API_ENABLED } from '@/lib/api';
import { IC } from '@/lib/icons';
import Avatar from './Avatar';
import PromoteForm from './PromoteForm';
import BlockedEcho from './BlockedEcho';

function Composer({ original }: { original?: Post }) {
  const { me, t, closeComposer, addPost, updatePost, showToast, requestPromotion, featureLock, db, pendingPromo } = useApp();
  const promoOff = featureLock('promotion');
  // The console's post limits desk decides what one post may hold.
  const limits = db.settings.limits;
  const [stage, setStage] = useState<'choose' | 'post' | 'reel'>(original ? original.kind || 'post' : 'choose');
  const [text, setText] = useState(original?.text || '');
  const [media, setMedia] = useState<Media[]>(original?.media || []);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState<{ name: string; pct: number } | null>(null);
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
    // The bar stops at 99 until the server answers with the URL it stored.
    const send = (file: File): Progress => (sent, total) => {
      if (alive.current) setSending({ name: file.name, pct: total > 0 ? Math.min(99, Math.round((sent / total) * 100)) : 0 });
    };
    try {
      for (const file of Array.from(files)) {
        const video = file.type.startsWith('video/');
        if (!video && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG, WebP photo or a video.');
        if (file.size > (video ? limits.videoMb : limits.photoMb) * 1024 * 1024) throw new Error(video ? `Videos must be under ${limits.videoMb} MB.` : `Photos must be under ${limits.photoMb} MB.`);
        if (video && next.filter(m => m.type === 'video').length >= limits.videoCount) throw new Error(`Up to ${limits.videoCount} videos per post.`);
        if (!video && next.filter(m => m.type === 'image').length >= limits.photoCount) throw new Error(`You can attach up to ${limits.photoCount} photos.`);
        if (video) {
          const src = URL.createObjectURL(file);
          urls.current.push(src);
          const dur = await videoDuration(src);
          if (!Number.isFinite(dur) || dur > limits.videoSeconds) throw new Error(`Choose a video up to ${limits.videoSeconds} seconds long.`);
          next.push(API_ENABLED ? { type: 'video', src: (await uploadFile(file, undefined, send(file))).url, dur } : { type: 'video', src, dur });
        } else {
          next.push(await imageFromFile(file, send(file)));
        }
      }
      if (alive.current) {
        setMedia(next);
        if (stage === 'choose') setStage('reel');
      }
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : 'This file could not be opened. Try another file.');
    } finally {
      if (alive.current) {
        setBusy(false);
        setSending(null);
      }
    }
  };

  const canPost = !busy && (text.trim().length > 0 || media.length > 0) && (stage !== 'reel' || media.length > 0) && (!promote || !!promoConfig);
  const publish = async () => {
    if (!me || !canPost) return;
    if (!me.emailVerified || (me.susp && (!me.susp.until || me.susp.until > Date.now()))) {
      setError('A verified, active account is needed to post.');
      return;
    }
    setBusy(true);
    try {
      let id = original?.id || '';
      if (original) {
        await updatePost(id, { text: text.trim(), media, edited: true });
      } else {
        id = (await addPost({ id: uid(), uid: me.id, kind: stage === 'reel' ? 'reel' : 'post', text: text.trim(), media, ts: Date.now(), status: 'live' })).id;
      }
      if (promote && promoConfig && id) await requestPromotion('post', id, promoConfig);
      published.current = true;
      setBlocked([]);
      showToast(original ? 'Post updated.' : stage === 'reel' ? 'Reel posted.' : 'Post published.');
      requestClose();
    } catch (err) {
      const data = (err as { data?: { blocked?: string[] } })?.data;
      if (data?.blocked?.length) setBlocked(data.blocked);
      // What the site decided is not a fault in the form, so it arrives as the
      // same dark bar every other answer from the server arrives in. The draft
      // stays on the screen either way.
      showToast(err instanceof Error ? err.message : 'This post could not be published. Try again.');
    } finally {
      setBusy(false);
    }
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
              <div className="field-echo-wrap">
                <textarea ref={areaRef} className="cp-text" aria-label="Post caption" placeholder={stage === 'reel' ? 'Add a caption…' : 'What would you like to share?'} value={text} maxLength={limits.textChars} onChange={e => setText(e.target.value)} />
                <BlockedEcho text={text} words={blocked} fieldRef={areaRef} fieldClass="cp-text" />
              </div>
              {media.length > 0 && <div className={`cp-media n${media.length}`}>
                {media.map((item, i) => <div key={item.src || i} className="cp-thumb">
                  {item.type === 'video' ? <video src={item.src} controls playsInline preload="metadata" /> : <img src={item.src || item.gen} alt={`Attachment ${i + 1}`} />}
                  <button type="button" aria-label={`Remove attachment ${i + 1}`} onClick={() => setMedia(current => current.filter((_, j) => i !== j))}>{IC.x}</button>
                </div>)}
              </div>}
              {sending && (
                <div className="create-upload" role="status">
                  <span className="create-upload-name">{sending.name}</span>
                  <span className="create-upload-track"><i style={{ width: `${sending.pct}%` }} /></span>
                  <b className="create-upload-pct">{sending.pct}%</b>
                </div>
              )}
              <button type="button" className="cp-attach" disabled={busy} onClick={() => fileRef.current?.click()}>{IC.img} Add photos or video</button>
              {!original && !me?.private && <label className={`cp-promote-toggle${promoOff ? ' f-off' : ''}`} {...(promoOff ? promoOff.props : {})}><span>{t('promoteSection')}<small>{promoOff ? promoOff.msg : 'Optional · paid with Coins'}</small></span><input type="checkbox" checked={promote} onChange={e => {
                // Ticking the box is where a member finds out the desk is still reading
                // an earlier order, not after the post is already published.
                if (e.target.checked && pendingPromo()) { showToast(t('promoQueueHold')); return; }
                setPromote(e.target.checked);
              }} /></label>}
              {promote && <PromoteForm targetType="post" confirmLabel="Use this promotion" onConfirm={cfg => setPromoConfig(cfg)} />}
              {promote && promoConfig && <small>Promotion selected. It will be requested when you post.</small>}
            </div>
            <div className="cp-foot"><span className="cp-count">{text.length}/{limits.textChars}</span><button type="button" className="cp-publish" disabled={!canPost} onClick={publish}>{original ? 'Save changes' : stage === 'reel' ? 'Post reel' : 'Post'}</button></div>
          </>}
          {busy && !sending && <p className="cp-feedback" role="status">Preparing your attachment…</p>}
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
