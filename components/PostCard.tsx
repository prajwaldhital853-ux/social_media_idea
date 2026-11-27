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
import ReactionButton from './ReactionButton';
import ReactionSummary from './ReactionSummary';
import ReportModal from './ReportModal';
import PromoteModal from './PromoteModal';
import ShareDialog from './ShareDialog';
import NoticeBanner from './NoticeBanner';
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

/**
 * The feed's one-tap follow. Anyone the reader already follows or has asked to
 * follow shows no text at all — managing that lives on their profile. A tap in
 * the window before the session finishes restoring waits instead of bouncing a
 * signed-in reader to the sign-in screen.
 */
function FeedFollow({ author }: { author: User }) {
  const { me, ready, t, followState, toggleFollow } = useApp();
  const router = useRouter();
  const state = me ? followState(author.id) : 'none';
  if (state !== 'none') return null;

  const run = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!me) {
      if (ready) router.push('/login');
      return;
    }
    void toggleFollow(author.id);
  };

  return <button type="button" className="feed-follow" onClick={run}>{t('follow')}</button>;
}

export default function PostCard({ post, author, featured }: PostCardProps) {
  const router = useRouter();
  const { db, me, t, deletePost, toggleSave, isSaved, sharePost, mayShare, openComposer, activePromo,
    promoEligible, trackPromo, showToast, showConfirm, reactionCount, serverMode, blockUser, unblockUser, isBlocked } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [promoHidden, setPromoHidden] = useState(false);
  const [sharing, setSharing] = useState(false);
  const warmed = useRef(false);

  const promo = activePromo('post', post.id);
  // The disclosure comes from the server's own answer, not only from what this cache
  // happens to hold: a card whose campaign row has not landed here yet is still a
  // post somebody paid for, and a reader is owed the line over it either way.
  const paid = !!promo || post.promoted;
  const own = me?.id === post.uid;
  const saved = isSaved(post.id);

  const comments = db.comments
    .filter(c => c.pid === post.id && c.status === 'live')
    .sort((a, b) => b.ts - a.ts);

  /** The card counts comments before the panel is ever opened, so it reads the
   *  server's aggregate when there is one and only falls back to cached rows. */
  const commentCount = post.comments ?? comments.length;

  /** Media-level likes fold into the card count: server sums in API mode, reaction rows in demo. */
  const mediaLikes = post.media?.some(m => m.likes !== undefined)
    ? post.media.reduce((n, m) => n + (m.likes || 0), 0)
    : db.reactions.filter(r => r.targetType === 'media' && r.targetId.startsWith(`${post.id}#m`)).length;

  if (promoHidden) return null;
  // Against a server the audience was settled before this row was ever written, and a
  // post the reader is allowed to read is not taken back because a campaign's target
  // moved under it — it loses the paid line, not the card. A demo build has no server
  // to settle it, so the wall is played out here instead.
  if (promo && !own && !serverMode && !promoEligible(promo)) return null;

  /** A tap that leaves the feed for the thing somebody bought. Nobody waits on the tally. */
  const answer = (kind: 'click' | 'profile') => {
    if (promo && !own) void trackPromo(promo.id, kind);
  };

  const openPost = () => { answer('click'); router.push(`/post/${post.id}`); };
  const openMedia = (index: number) => { answer('click'); router.push(`/post/${post.id}/media/${index}`); };
  const openReel = (index: number) => { answer('click'); router.push(`/video/${post.id}-${index}`); };

  // An advert is bought for an answer, not for a look. The button says the same
  // thing on every paid card and hands the reader a message already started, so
  // the step from "somebody paid for me to see this" to "I asked them about it"
  // is one tap — and that tap is the click the payer is billed for.
  const askText = (post.text || '').trim()
    ? t('promoAsk', { text: post.text.trim().slice(0, 80) })
    : t('promoAskBare');
  const askHref = `/messages/${author.username}?text=${encodeURIComponent(askText)}`;
  const openAsk = () => {
    answer('click');
    router.push(me ? askHref : '/login');
  };

  // Opening the sheet is not a share, and neither is opening another app — that
  // sheet can be cancelled with nothing sent. The counter moves only when the
  // reader sends it to a person, copies the link, or finishes the native share.
  // The desk's ceiling is asked first, so a share past it stops at the button.
  const handleShare = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    const refused = await mayShare(post.id);
    if (refused) { showToast(refused); return; }
    setSharing(true);
  };

  const copyShareLink = async () => {
    const url = `${window.location.origin}/post/${post.id}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast(t('linkCopied'));
    } catch {
      showToast(url);
    }
  };

  const firstPicture = (post.media || []).find(m => m.type === 'image' && (m.src || m.gen));
  const firstClip = (post.media || []).find(m => m.type === 'video' && m.src);

  const media = (post.media || []).filter(m => m.src || m.gen);
  const single = media.length === 1;
  const shown = single ? media : media.slice(0, 5);
  const extra = media.length - shown.length;

  const onArticleClick = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest('button, a, input, textarea, select, .post-video, .comment-panel, .media-mosaic, .post-menu')) return;
    openPost();
  };

  const warmRoutes = () => {
    if (warmed.current) return;
    warmed.current = true;
    router.prefetch(`/post/${post.id}`);
    router.prefetch(`/u/${author.username}`);
    if (media.length > 0) router.prefetch(`/post/${post.id}/media/0`);
    if (single && media[0]?.type === 'video') router.prefetch(`/video/${post.id}-0`);
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
    <article className={`post ${featured ? 'post-featured' : ''}`} onClick={onArticleClick} onPointerEnter={warmRoutes} onTouchStart={warmRoutes}>
      {paid && (
        <div className="promoted-row">
          <span className="promoted-chip">{IC.chart}{t('promoted')}</span>
          {promo && (
            <button type="button" className="promoted-why" onClick={e => { e.stopPropagation(); setWhyOpen(v => !v); }}>
              {t('whySee')}
            </button>
          )}
          {whyOpen && promo && (
            <div className="promoted-pop" onClick={e => e.stopPropagation()}>
              <p>{me ? t('promoWhy') : t('promoWhyGuest')}</p>
              <p className="promoted-target">
                {[promo.category && `#${promo.category}`, `${promo.ageMin}–${promo.ageMax}`,
                  promo.country || t('allLocations')].filter(Boolean).join(' · ')}
                {(promo.cities || []).length ? `: ${(promo.cities || []).join(', ')}` : ''}
              </p>
              {!own && menuItem(t('hidePromo'), () => { setPromoHidden(true); showToast(t('promoHidden')); })}
            </div>
          )}
        </div>
      )}

      <div className="post-top">
        <Link href={`/u/${author.username}`} className="post-avatar" onClick={e => { e.stopPropagation(); answer('profile'); }}>
          <Avatar user={author} size={40} />
        </Link>
        <div className="post-content">
          <div className="post-header">
            <Link href={`/u/${author.username}`} className="post-name" onClick={e => { e.stopPropagation(); answer('profile'); }}>
              <span className="post-name-pencil" aria-hidden="true">{IC.edit}</span>
              {author.name || author.username}
            </Link>
            {author.verified && <VerifiedBadge />}
            {post.activity && (
              <span className="post-activity">{t(post.activity === 'cover' ? 'updatedCover' : 'updatedProfile')}</span>
            )}
            {(post.place || post.mood) && (
              <span className="post-context">
                {post.place && (
                  <Link href={`/explore?q=${encodeURIComponent(post.place)}`} className="post-place" onClick={e => e.stopPropagation()}>at {post.place}</Link>
                )}
                {post.place && post.mood ? ' ' : ''}
                {post.mood && <span className="post-feeling">feeling {post.mood}</span>}
              </span>
            )}
            {!own && (
              <FeedFollow author={author} />
            )}
            <span className="post-time">{ago(post.ts, db.lang)}</span>
            {post.audience === 'followers' && <span className="post-audience" title="Followers only">{IC.users}</span>}
            {post.edited && <span className="post-edited">· {t('edited')}</span>}
            <div className="post-menu-wrap">
              <button type="button" className="icon-btn post-menu-btn" aria-label="More" onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}>
                {IC.dots}
              </button>
              {menuOpen && (
                <div className="post-menu" onClick={e => e.stopPropagation()}>
                  {menuItem(t('copyLink'), () => { void copyShareLink(); })}
                  {own && !me?.private && db.settings.features.promotion && menuItem(t('promote'), () => setPromoting(true))}
                  {own && menuItem(t('edit'), () => openComposer(post.id))}
                  {own && menuItem(t('del'), () => showConfirm(t('confirmDelete'), () => deletePost(post.id)), true)}
                  {!own && me && menuItem(t('report'), () => setReporting(true))}
                  {!own && !me && menuItem(t('report'), () => router.push('/login'))}
                  {!own && me && !isBlocked(author.id) && menuItem(t('block'), () => void blockUser(author.id), true)}
                  {!own && me && isBlocked(author.id) && menuItem(t('unblock'), () => void unblockUser(author.id))}
                </div>
              )}
            </div>
          </div>

          {post.status === 'hidden' && <p className="post-state-note">{t('hidden')}</p>}
          {post.status === 'removed' && <p className="post-state-note">{t('removed')}</p>}

          {post.text && <Caption text={post.text} full={featured} />}
        </div>
      </div>

      <NoticeBanner notices={post.notices} full={featured}/>

      {shown.length > 0 && (
        <div className={`media-mosaic ${mosaicClass(shown.length)}${single && media[0]?.type === 'image' ? ' single-photo' : ''}`} onClick={e => e.stopPropagation()}>
          {shown.map((item, index) => (
            <div className="mosaic-cell" key={`${item.type}-${item.src || item.gen || index}`}>
              {item.type === 'video' ? (
                <PostVideo
                  src={item.src || ''}
                  duration={item.dur}
                  preview={!single}
                  onOpen={() => (single ? openReel(index) : openMedia(index))}
                />
              ) : (
                <img
                  src={item.src || item.gen}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onClick={() => openMedia(index)}
                />
              )}
              {extra > 0 && index === shown.length - 1 && (
                <button type="button" className="media-more" onClick={() => openMedia(index)} aria-label={`View ${extra} more attachments`}>
                  +{extra}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {paid && !own && (
        <div className="promo-cta" onClick={e => e.stopPropagation()}>
          <button type="button" className="promo-cta-btn" onClick={openAsk}>
            {IC.msg}
            <span>{t('messageNow')}</span>
          </button>
        </div>
      )}

      {(reactionCount('post', post.id) + mediaLikes) > 0 && (
        <div className="reaction-row" onClick={e => e.stopPropagation()}>
          <ReactionSummary postId={post.id} extraCount={mediaLikes} />
        </div>
      )}

      <div className="post-actions" onClick={e => e.stopPropagation()}>
        <ReactionButton targetType="post" targetId={post.id} extraCount={mediaLikes} />
        <button
          type="button"
          className={`action-btn ${showComments ? 'on' : ''}`}
          aria-label="Comments"
          onClick={e => { e.preventDefault(); if (featured) document.querySelector<HTMLInputElement>('.comments-inline input')?.focus(); else setShowComments(v => !v); }}
        >
          {IC.comment}
          <span>{commentCount > 0 ? compact(commentCount) : ''}</span>
        </button>

        <button type="button" className="action-btn" aria-label="Share post" onClick={handleShare}>
          {IC.share}
          <span>{(post.shares ?? 0) > 0 ? compact(post.shares ?? 0) : ''}</span>
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

      {reactionCount('post', post.id) + mediaLikes === 0 && <small className="first-like">Be first one to like this.</small>}

      {showComments && <Comments postId={post.id} onClose={() => setShowComments(false)} />}

      {reporting && <ReportModal type="post" targetId={post.id} onClose={() => setReporting(false)} />}
      {promoting && <PromoteModal targetType="post" targetId={post.id} onClose={() => setPromoting(false)} />}
      <ShareDialog
        open={sharing}
        url={`${typeof window === 'undefined' ? '' : window.location.origin}/post/${post.id}`}
        title={`${author.name || author.username} on Exposing`}
        text={post.text.slice(0, 140)}
        preview={{
          title: author.name || author.username,
          subtitle: post.text.slice(0, 120),
          image: firstPicture ? (firstPicture.src || firstPicture.gen) : undefined,
          video: !firstPicture && firstClip ? firstClip.src : undefined,
        }}
        onShared={() => { void sharePost(post.id); }}
        onClose={() => setSharing(false)}
      />
    </article>
  );

}