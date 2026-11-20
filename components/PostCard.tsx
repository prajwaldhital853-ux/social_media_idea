'use client';

import { useEffect, useRef, useState } from 'react';
import Comments from './Comments';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Post as PostType, User } from '@/lib/types';
import { ago, compact } from '@/lib/utils';
import { useApp } from '@/lib/AppContext';
import Avatar from './Avatar';
import VerifiedBadge from './VerifiedBadge';
import PostVideo from './PostVideo';
import MediaViewer from './MediaViewer';
import ReactionButton from './ReactionButton';
import ReportModal from './ReportModal';
import PromoteModal from './PromoteModal';
import { IC } from '@/lib/icons';

interface PostCardProps {
  post: PostType;
  author: User;
  featured?: boolean;
}

function mosaicClass(count: number) {
  if (count === 1) return 'single';
  if (count === 2) return 'two';
  if (count === 3) return 'three';
  if (count === 4) return 'stack n4';
  return 'stack n5';
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

function Caption({ text, full = false }: { text: string; full?: boolean }) {
  const [expanded, setExpanded] = useState(full);
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
  const { db, me, t, deletePost, toggleSave, isSaved, openComposer, activePromo, promoEligible, showToast } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [promoHidden, setPromoHidden] = useState(false);
  const [selectedMediaIndex, setSelectedMediaIndex] = useState<number | null>(null);

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

  const media = (post.media || []).filter(m => m.src || m.gen);
  const single = media.length === 1;
  const shown = single ? media : media.slice(0, 5);
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

          {post.text && <Caption text={post.text} full={featured} />}
          {(post.mood || post.place) && (
            <div className="post-tags">
              {post.mood && <span className="post-tag">{post.mood}</span>}
              {post.place && <span className="post-tag">{post.place}</span>}
            </div>
          )}
        </div>
      </div>

      {shown.length > 0 && (
        <div className={`media-mosaic ${mosaicClass(shown.length)}`} onClick={e => e.stopPropagation()}>
          {shown.map((item, index) => (
            <div className="mosaic-cell" key={`${item.type}-${item.src || item.gen || index}`}>
              {item.type === 'video' ? (
                <PostVideo
                  src={item.src || ''}
                  duration={item.dur}
                  autoPlay={single}
                  onOpen={single ? undefined : () => setSelectedMediaIndex(index)}
                />
              ) : (
                <img
                  src={item.src || item.gen}
                  alt=""
                  loading="lazy"
                  onClick={() => setSelectedMediaIndex(index)}
                />
              )}
              {extra > 0 && index === shown.length - 1 && (
                <button type="button" className="media-more" onClick={() => setSelectedMediaIndex(index)} aria-label={`View ${extra} more attachments`}>
                  +{extra}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {selectedMediaIndex !== null && (
        <MediaViewer media={media} initialIndex={selectedMediaIndex} onClose={() => setSelectedMediaIndex(null)} />
      )}

      <div className="post-actions" onClick={e => e.stopPropagation()}>
        <ReactionButton targetType="post" targetId={post.id} />
        <button
          type="button"
          className={`action-btn ${showComments ? 'on' : ''}`}
          aria-label="Comments"
          onClick={e => { e.preventDefault(); if (featured) document.querySelector<HTMLInputElement>('.comments-inline input')?.focus(); else setShowComments(v => !v); }}
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

      {showComments && <Comments postId={post.id} onClose={() => setShowComments(false)} />}

      {reporting && <ReportModal type="post" targetId={post.id} onClose={() => setReporting(false)} />}
      {promoting && <PromoteModal targetType="post" targetId={post.id} onClose={() => setPromoting(false)} />}
    </article>
  );

}