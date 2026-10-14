'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Post as PostType, User } from '@/lib/types';
import { ago, esc, uid } from '@/lib/utils';
import { useApp } from '@/lib/AppContext';
import Avatar from './Avatar';
import { IC } from '@/lib/icons';

interface PostCardProps {
  post: PostType;
  author: User;
  onLike?: (postId: string) => void;
}

export default function PostCard({ post, author, onLike }: PostCardProps) {
  const router = useRouter();
  const { db, me, addComment } = useApp();
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(Math.floor(Math.random() * 5000) + 100);
  const [shareHint, setShareHint] = useState('');
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState('');

  const comments = db.comments
    .filter(c => c.pid === post.id && c.status === 'live')
    .sort((a, b) => a.ts - b.ts);

  const handleLike = (e: React.MouseEvent) => {
    e.stopPropagation();
    setLiked(!liked);
    setLikeCount(prev => (liked ? prev - 1 : prev + 1));
    if (onLike) onLike(post.id);
  };

  const handleShare = async (e: React.MouseEvent) => {
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

  const images = post.media.filter(m => m.type === 'image');
  const videos = post.media.filter(m => m.type === 'video');
  const mixed = videos.length > 0 && images.length > 0;
  const photoClass = images.length === 1 ? 'single' : images.length === 2 ? 'two' : images.length === 3 ? 'three' : 'four';

  return (
    <article className="post">
      <div className="post-avatar" onClick={() => router.push(`/post/${post.id}`)}>
        <Avatar user={author} size={40} />
      </div>
      <div className="post-content" onClick={() => router.push(`/post/${post.id}`)}>
        <div className="post-header">
          <span className="post-name">{esc(author.name || author.username)}</span>
          {author.verified && (
            <span className="post-verified">
              <svg viewBox="0 0 24 24">
                <path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.47 0-.92.084-1.336.25C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25c-.415-.165-.866-.25-1.336-.25-2.11 0-3.818 1.79-3.818 4 0 .495.083.965.238 1.4-1.272.65-2.147 2.018-2.147 3.6 0 1.495.782 2.798 1.942 3.486-.02.17-.032.34-.032.514 0 2.21 1.708 4 3.818 4 .47 0 .92-.086 1.335-.25.62 1.334 1.926 2.25 3.437 2.25 1.512 0 2.818-.916 3.437-2.25.415.163.865.248 1.336.248 2.11 0 3.818-1.79 3.818-4 0-.174-.012-.344-.033-.513 1.158-.687 1.943-1.99 1.943-3.484zm-6.616-3.334l-4.334 6.5c-.145.217-.382.334-.625.334-.143 0-.288-.04-.416-.126l-.115-.094-2.415-2.415c-.293-.293-.293-.768 0-1.06s.768-.294 1.06 0l1.77 1.767 3.825-5.74c.23-.345.696-.436 1.04-.207.346.23.44.696.21 1.04z" />
              </svg>
            </span>
          )}
          <span className="post-handle">@{esc(author.username)}</span>
          <span className="post-time">{ago(post.ts, db.lang)}</span>
        </div>

        {post.text && (
          <div className="post-text">
            {esc(post.text)}
          </div>
        )}

        {post.media && post.media.length > 0 && (
          mixed ? (
            <div className="post-media mixed">
              {videos.map((media, index) => (
                <div key={`v-${index}`} className="mixed-video">
                  <video controls playsInline preload="metadata" src={media.src} onClick={e => e.stopPropagation()} />
                  {media.dur ? (
                    <span className="video-duration">
                      {Math.floor(media.dur / 60)}:{String(Math.floor(media.dur % 60)).padStart(2, '0')}
                    </span>
                  ) : null}
                </div>
              ))}
              <div className={`mixed-photos ${photoClass}`}>
                {images.map((media, index) => (
                  <img key={`i-${index}`} src={media.src || media.gen} alt="" loading="lazy" />
                ))}
              </div>
            </div>
          ) : (
            <div className={`post-media ${post.media.length === 1 ? 'single' : 'grid'} ${photoClass}`}>
              {post.media.map((media, index) =>
                media.type === 'image' ? (
                  <img key={index} src={media.src || media.gen} alt="" loading="lazy" />
                ) : (
                  <div key={index} className="post-media video">
                    <video controls playsInline preload="metadata" src={media.src} onClick={e => e.stopPropagation()} />
                    {media.dur ? (
                      <span className="video-duration">
                        {Math.floor(media.dur / 60)}:{String(Math.floor(media.dur % 60)).padStart(2, '0')}
                      </span>
                    ) : null}
                  </div>
                )
              )}
            </div>
          )
        )}
      </div>

      <div className="post-actions">
        <button
          type="button"
          className={`action-btn ${showComments ? 'on' : ''}`}
          onClick={e => {
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

      {showComments && (
        <div className="comment-panel" onClick={e => e.stopPropagation()}>
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
      )}
    </article>
  );
}
