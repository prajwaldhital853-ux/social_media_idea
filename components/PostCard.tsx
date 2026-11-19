'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Post as PostType, User, Media } from '@/lib/types';
import { ago, uid, compact } from '@/lib/utils';
import { useApp } from '@/lib/AppContext';
import Avatar from './Avatar';
import VerifiedBadge from './VerifiedBadge';
import PostVideo from './PostVideo';
import ReactionButton from './ReactionButton';
import ReportModal from './ReportModal';
import PromoteModal from './PromoteModal';
import { IC } from '@/lib/icons';

interface PostCardProps {
  post: PostType;
  author: User;
  featured?: boolean;
}

function mosaicClass(media: Media[]) {
  const n = media.length;
  const hasVideo = media.some(m => m.type === 'video');
  const hasImage = media.some(m => m.type === 'image');
  if (n === 1) return 'single';
  if (hasVideo && hasImage) return `mixed n${n}`;
  if (n === 2) return 'two';
  if (n === 3) return 'three';
  return 'four';
}

function RichText({ text }: { text: string }) {
  const parts = text.split(new RegExp('(#[\\p{L}\\p{N}_]+|@[\\w]+)', 'gu'));
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('#')) {
          return <Link key={i} className="hashtag" href={`/explore?q=${encodeURIComponent(part)}`} onClick={e => e.stopPropagation()}>{part}</Link>;
        }
        if (part.startsWith('@')) {
          return <Link key={i} className="mention" href={`/u/${part.slice(1)}`} onClick={e => e.stopPropagation()}>{part}</Link>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function Caption({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (!expanded) setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, [text, expanded]);
  return <div className="post-caption">
    <div ref={ref} className={`post-text ${expanded ? '' : 'caption-clamped'}`}><RichText text={text} /></div>
    {overflows && <button type="button" className="caption-toggle" aria-expanded={expanded} onClick={e => { e.stopPropagation(); setExpanded(value => !value); }}>{expanded ? 'See less' : 'See more'}</button>}
  </div>;
}

export default function PostCard({ post, author, featured }: PostCardProps) {
  const router = useRouter();
  const { db, me, t, addComment, deleteComment, deletePost, toggleSave, isSaved, openComposer, activePromo, promoEligible, showToast } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [reporting, setReporting] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [promoHidden, setPromoHidden] = useState(false);

  const promo = activePromo('post', post.id);
  const own = me?.id === post.uid;
  const saved = isSaved(post.id);

  const comments = db.comments
    .filter(c => c.pid === post.id && c.status === 'live')
    .sort((a, b) => b.ts - a.ts);

  if (promoHidden) return null;
  if (promo && !own && !promoEligible(promo)) return null;

  const openPost = () => router.push(`/post/${post.id}`);

  const handleShare = async (e?: React.MouseEvent, copyOnly = false) => {
    e?.preventDefault();
    e?.stopPropagation();
    const url = `${window.location.origin}/post/${post.id}`;
    try {
      if (navigator.share && !copyOnly) {
        await navigator.share({ title: `${author.name} on Exposing`, text: post.text.slice(0, 140), url });
        return;
      }
    } catch { /* fall through to clipboard */ }
    try {
      await navigator.clipboard.writeText(url);
      showToast(t('linkCopied'));
    } catch {
      showToast(url);
    }
  };

  const handleCommentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!me) {
      router.push('/login');
      return;
    }
    if (!commentText.trim()) return;
    addComment({ id: uid(), pid: post.id, uid: me.id, text: commentText.slice(0, 1000), ts: Date.now(), status: 'live' });
    setCommentText('');
  };

  const media = (post.media || []).filter(m => m.src || m.gen);
  const videos = media.filter(m => m.type === 'video');
  const images = media.filter(m => m.type === 'image');
  const mixed = videos.length > 0 && images.length > 0;
  const shown = mixed ? [...videos.slice(0, 1), ...images.slice(0, 4)] : media.slice(0, 4);
  const extra = media.length - shown.length;

  const onArticleClick = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest('button, a, input, textarea, select, .post-video, .comment-panel, .media-mosaic, .post-menu')) return;
    openPost();
  };

  const menuItem = (label: string, fn: () => void, danger = false) => (
    <button
      type="button"
      className={`post-menu-item ${danger ? 'danger' : ''}`}
      onClick={e => { e.stopPropagation(); setMenuOpen(false); fn(); }}
    >
      {label}
    </button>
  );

  return (
    <article className={`post ${featured ? 'post-featured' : ''}`} onClick={onArticleClick}>
      {promo && (
        <div className="promoted-row">
          <span className="promoted-chip">{IC.chart}{t('promoted')}</span>
          <button type="button" className="promoted-why" onClick={e => { e.stopPropagation(); setWhyOpen(v => !v); }}>
            {t('whySee')}
          </button>
          {whyOpen && (
            <div className="promoted-pop" onClick={e => e.stopPropagation()}>
              <p>{me ? t('promoWhy') : t('promoWhyGuest')}</p>
              <p className="promoted-target">
                {promo.category} · {promo.ageMin}–{promo.ageMax} · {promo.country || t('allLocations')}{promo.city ? `, ${promo.city}` : ''}
              </p>
              {!own && menuItem(t('hidePromo'), () => { setPromoHidden(true); showToast(t('promoHidden')); })}
            </div>
          )}
        </div>
      )}

      <div className="post-top">
        <Link href={`/u/${author.username}`} className="post-avatar" onClick={e => e.stopPropagation()}>
          <Avatar user={author} size={40} />
        </Link>
        <div className="post-content">
          <div className="post-header">
            <Link href={`/u/${author.username}`} className="post-name" onClick={e => e.stopPropagation()}>
              {author.name || author.username}
            </Link>
            {author.verified && <VerifiedBadge />}
            <span className="post-handle">@{author.username}</span>
            <span className="post-time">{ago(post.ts, db.lang)}</span>
            {post.edited && <span className="post-edited">· {t('edited')}</span>}
            <div className="post-menu-wrap">
              <button type="button" className="icon-btn post-menu-btn" aria-label="More" onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}>
                {IC.dots}
              </button>
              {menuOpen && (
                <div className="post-menu" onClick={e => e.stopPropagation()}>
                  {menuItem(t('copyLink'), () => { void handleShare(undefined, true); })}
                  {own && db.settings.features.promotion && menuItem(t('promote'), () => setPromoting(true))}
                  {own && menuItem(t('edit'), () => openComposer(post.id))}
                  {own && menuItem(t('del'), () => { if (window.confirm(t('confirmDelete'))) deletePost(post.id); }, true)}
                  {!own && me && menuItem(t('report'), () => setReporting(true))}
                  {!own && !me && menuItem(t('report'), () => router.push('/login'))}
                </div>
              )}
            </div>
          </div>

          {post.status === 'hidden' && <p className="post-state-note">{t('hidden')}</p>}
          {post.status === 'removed' && <p className="post-state-note">{t('removed')}</p>}

          {post.text && <Caption text={post.text} />}
          {(post.mood || post.place) && (
            <div className="post-tags">
              {post.mood && <span className="post-tag">{post.mood}</span>}
              {post.place && <span className="post-tag">{post.place}</span>}
            </div>
          )}
        </div>
      </div>

      {shown.length > 0 && (
        <div className={`media-mosaic ${mosaicClass(shown)}`} onClick={e => e.stopPropagation()}>
          {mixed ? (
            <>
              {videos.slice(0, 1).map((item, index) => (
                <PostVideo key={`v-${index}`} src={item.src || ''} duration={item.dur} />
              ))}
              <div className={`mosaic-photos n${Math.min(images.length, 4)}`}>
                {images.slice(0, 4).map((item, index) => (
                  <img key={`i-${index}`} src={item.src || item.gen} alt="" loading="lazy" />
                ))}
              </div>
            </>
          ) : (
            shown.map((item, index) =>
              item.type === 'video' ? (
                <PostVideo key={`v-${index}`} src={item.src || ''} duration={item.dur} />
              ) : (
                <img key={`i-${index}`} src={item.src || item.gen} alt="" loading="lazy" />
              )
            )
          )}
          {extra > 0 && <span className="media-more">+{extra}</span>}
        </div>
      )}

      <div className="post-actions" onClick={e => e.stopPropagation()}>
        <ReactionButton targetType="post" targetId={post.id} />
        <button
          type="button"
          className={`action-btn ${showComments ? 'on' : ''}`}
          aria-label="Comments"
          onClick={e => { e.preventDefault(); setShowComments(v => !v); }}
        >
          {IC.comment}
          <span>{comments.length > 0 ? compact(comments.length) : ''}</span>
        </button>

        <button type="button" className="action-btn" aria-label="Share post" onClick={handleShare}>
          {IC.share}
        </button>

        <button
          type="button"
          className={`action-btn save-action ${saved ? 'on' : ''}`}
          aria-label={saved ? t('unsave') : t('savePost')}
          onClick={e => {
            e.preventDefault();
            if (!me) { router.push('/login'); return; }
            toggleSave(post.id);
          }}
        >
          {saved ? IC.bookmarkFill : IC.bookmark}
        </button>
      </div>

      {!db.reactions.some(r => r.targetType === 'post' && r.targetId === post.id) && <small className="first-like">Be first one to like this.</small>}

      {showComments && typeof document !== 'undefined' && createPortal(
        <div className="comment-overlay" onClick={() => setShowComments(false)}>
          <div className="comment-sheet" onClick={e => e.stopPropagation()}>
            <div className="comment-sheet-head">
              <b>{t('comment')} · {comments.length}</b>
              <button type="button" className="comment-close" aria-label={t('close')} onClick={() => setShowComments(false)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <div className="comment-panel">
              {comments.length === 0 && <p className="comment-empty">{t('noComments')}</p>}
              {comments.map(c => {
                const commentAuthor = db.users.find(u => u.id === c.uid);
                if (!commentAuthor) return null;
                return (
                  <div key={c.id} className="comment-row">
                    <Avatar user={commentAuthor} size={28} />
                    <div className="comment-body">
                      <div className="comment-meta">
                        <b>{commentAuthor.name || commentAuthor.username}</b>
                        {commentAuthor.verified && <VerifiedBadge size={14} />}
                        <span>@{commentAuthor.username}</span>
                        <span>{ago(c.ts, db.lang)}</span>
                        {me?.id === c.uid && (
                          <button type="button" className="comment-del" onClick={() => deleteComment(c.id)} aria-label={t('del')}>{IC.x}</button>
                        )}
                      </div>
                      <p>{c.text}</p>
                      <ReactionButton targetType="comment" targetId={c.id} small />
                    </div>
                  </div>
                );
              })}
              <form className="comment-form" onSubmit={handleCommentSubmit}>
                {me && <Avatar user={me} size={28} />}
                <input
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  placeholder={me ? t('commentPh') : t('needLogin')}
                  maxLength={1000}
                  disabled={!me}
                />
                <button type="submit" disabled={!me || !commentText.trim()}>
                  {t('send')}
                </button>
              </form>
            </div>
          </div>
        </div>,
        document.body
      )}

      {reporting && <ReportModal type="post" targetId={post.id} onClose={() => setReporting(false)} />}
      {promoting && <PromoteModal targetType="post" targetId={post.id} onClose={() => setPromoting(false)} />}
    </article>
  );

}