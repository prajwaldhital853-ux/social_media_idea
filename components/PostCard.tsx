'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Post as PostType, User, Media } from '@/lib/types';
import { ago, esc, uid } from '@/lib/utils';
import { useApp } from '@/lib/AppContext';
import Avatar from './Avatar';
import VerifiedBadge from './VerifiedBadge';
import PostVideo from './PostVideo';
import { IC } from '@/lib/icons';

interface PostCardProps {
  post: PostType;
  author: User;
  onLike?: (postId: string) => void;
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

export default function PostCard({ post, author, onLike, featured }: PostCardProps) {
  const router = useRouter();
  const { db, me, addComment } = useApp();
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(() => 80 + (post.id.charCodeAt(1) % 40) * 120);
  const [shareHint, setShareHint] = useState('');
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState('');

  const comments = db.comments
    .filter(c => c.pid === post.id && c.status === 'live')
    .sort((a, b) => a.ts - b.ts);

  const openPost = () => router.push(`/post/${post.id}`);

  const handleLike = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLiked(!liked);
    setLikeCount(prev => (liked ? prev - 1 : prev + 1));
    if (onLike) onLike(post.id);
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const url = `${window.location.origin}/post/${post.id}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${author.name} on Chautari`,
          text: post.text.slice(0, 140),
          url
        });
        setShareHint('Shared');
      } else {
        await navigator.clipboard.writeText(url);
        setShareHint('Link copied');
      }
    } catch {
      try {
        await navigator.clipboard.writeText(url);
        setShareHint('Link copied');
      } catch {
        setShareHint('Could not share');
      }
    }
    setTimeout(() => setShareHint(''), 2000);
  };

  const handleCommentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!me) {
      router.push('/login');
      return;
    }
    if (!commentText.trim()) return;
    addComment({
      id: uid(),
      pid: post.id,
      uid: me.id,
      text: commentText.slice(0, 1000),
      ts: Date.now(),
      status: 'live'
    });
    setCommentText('');
    setShowComments(true);
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  const media = (post.media || []).filter(m => m.src || m.gen);
  const videos = media.filter(m => m.type === 'video');
  const images = media.filter(m => m.type === 'image');
  const mixed = videos.length > 0 && images.length > 0;
  const shown = mixed
    ? [...videos.slice(0, 1), ...images.slice(0, 4)]
    : media.slice(0, 4);
  const extra = media.length - shown.length;

  const onArticleClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('button, a, input, textarea, .post-video, .comment-panel, .media-mosaic')) return;
    openPost();
  };

  return (
    <article className={`post ${featured ? 'post-featured' : ''}`} onClick={onArticleClick}>
      <div className="post-top">
        <div className="post-avatar" onClick={e => { e.stopPropagation(); router.push('/profile'); }}>
          <Avatar user={author} size={40} />
        </div>
        <div className="post-content">
          <div className="post-header">
            <span className="post-name">{esc(author.name || author.username)}</span>
            {author.verified && <VerifiedBadge />}
            <span className="post-handle">@{esc(author.username)}</span>
            <span className="post-time">{ago(post.ts, db.lang)}</span>
          </div>

          {post.text && (
            <div className="post-text">
              {esc(post.text)}
            </div>
          )}
        </div>
      </div>

      {shown.length > 0 && (
        <div
          className={`media-mosaic ${mosaicClass(shown)}`}
          onClick={e => e.stopPropagation()}
        >
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
        <button
          type="button"
          className={`action-btn ${showComments ? 'on' : ''}`}
          onClick={e => {
            e.preventDefault();
            e.stopPropagation();
            setShowComments(v => !v);
          }}
        >
          {IC.comment}
          <span>{formatNumber(comments.length)}</span>
        </button>

        <button type="button" className={`action-btn ${liked ? 'liked' : ''}`} onClick={handleLike}>
          {IC.heart}
          <span>{formatNumber(likeCount)}</span>
        </button>

        <button type="button" className="action-btn" onClick={handleShare}>
          {IC.share}
          <span>{shareHint || 'Share'}</span>
        </button>
      </div>

      {showComments && typeof document !== 'undefined' && createPortal(
        <div className="comment-overlay" onClick={() => setShowComments(false)}>
        <div className="comment-sheet" onClick={e => e.stopPropagation()}>
          <div className="comment-sheet-head">
            <b>Comments</b>
            <button type="button" className="comment-close" aria-label="Close comments" onClick={() => setShowComments(false)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        <div className="comment-panel">
          {comments.length === 0 && <p className="comment-empty">No comments yet. Start the thread.</p>}
          {comments.map(c => {
            const commentAuthor = db.users.find(u => u.id === c.uid);
            if (!commentAuthor) return null;
            return (
              <div key={c.id} className="comment-row">
                <Avatar user={commentAuthor} size={28} />
                <div>
                  <div className="comment-meta">
                    <b>{esc(commentAuthor.name || commentAuthor.username)}</b>
                    {commentAuthor.verified && <VerifiedBadge size={14} />}
                    <span>@{esc(commentAuthor.username)}</span>
                    <span>{ago(c.ts, db.lang)}</span>
                  </div>
                  <p>{esc(c.text)}</p>
                </div>
              </div>
            );
          })}
          <form className="comment-form" onSubmit={handleCommentSubmit}>
            {me && <Avatar user={me} size={28} />}
            <input
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              placeholder={me ? 'Write a comment' : 'Log in to comment'}
              maxLength={1000}
              disabled={!me}
            />
            <button type="submit" disabled={!me || !commentText.trim()}>
              Reply
            </button>
          </form>
        </div>
        </div>
        </div>,
        document.body
      )}
    </article>
  );
}
