'use client';

import { useState } from 'react';
import { Post as PostType, User } from '@/lib/types';
import { ago, esc } from '@/lib/utils';
import Avatar from './Avatar';

interface PostCardProps {
  post: PostType;
  author: User;
  onLike?: (postId: string) => void;
}

export default function PostCard({ post, author, onLike }: PostCardProps) {
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(Math.floor(Math.random() * 5000) + 100);
  const [commentCount, setCommentCount] = useState(Math.floor(Math.random() * 200) + 10);

  const handleLike = () => {
    setLiked(!liked);
    setLikeCount(prev => liked ? prev - 1 : prev + 1);
    if (onLike) onLike(post.id);
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  return (
    <article className="post">
      <div className="post-avatar">
        <Avatar user={author} size={40} />
      </div>
      <div className="post-content">
        <div className="post-header">
          <span className="post-name">{esc(author.name || author.username)}</span>
          <span className="post-verified">
            <svg viewBox="0 0 24 24">
              <path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.47 0-.92.084-1.336.25C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25c-.415-.165-.866-.25-1.336-.25-2.11 0-3.818 1.79-3.818 4 0 .495.083.965.238 1.4-1.272.65-2.147 2.018-2.147 3.6 0 1.495.782 2.798 1.942 3.486-.02.17-.032.34-.032.514 0 2.21 1.708 4 3.818 4 .47 0 .92-.086 1.335-.25.62 1.334 1.926 2.25 3.437 2.25 1.512 0 2.818-.916 3.437-2.25.415.163.865.248 1.336.248 2.11 0 3.818-1.79 3.818-4 0-.174-.012-.344-.033-.513 1.158-.687 1.943-1.99 1.943-3.484zm-6.616-3.334l-4.334 6.5c-.145.217-.382.334-.625.334-.143 0-.288-.04-.416-.126l-.115-.094-2.415-2.415c-.293-.293-.293-.768 0-1.06s.768-.294 1.06 0l1.77 1.767 3.825-5.74c.23-.345.696-.436 1.04-.207.346.23.44.696.21 1.04z" />
            </svg>
          </span>
          <span className="post-handle">@{esc(author.username)}</span>
          <span className="post-time">{ago(post.ts, 'en')}</span>
        </div>

        {post.text && (
          <div className="post-text">
            {esc(post.text)}
          </div>
        )}

        {post.media && post.media.length > 0 && (
          <div className={`post-media ${post.media.length === 1 ? 'single' : 'grid'} ${post.media.length === 2 ? 'two' : post.media.length === 3 ? 'three' : 'four'}`}>
            {post.media.map((media, index) => (
              media.type === 'image' ? (
                <img
                  key={index}
                  src={media.src || media.gen}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <div key={index} className="post-media video">
                  <video controls playsInline preload="metadata" src={media.src} />
                  {media.dur && <span className="video-duration">{Math.floor(media.dur / 60)}:{String(Math.floor(media.dur % 60)).padStart(2, '0')}</span>}
                </div>
              )
            ))}
          </div>
        )}

        <div className="post-actions">
          <button className="action-btn" onClick={() => setCommentCount(prev => prev + 1)}>
            <svg viewBox="0 0 24 24">
              <path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z" />
            </svg>
            <span>{formatNumber(commentCount)}</span>
          </button>

          <button className={`action-btn ${liked ? 'liked' : ''}`} onClick={handleLike}>
            <svg viewBox="0 0 24 24">
              <path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z" />
            </svg>
            <span>{formatNumber(likeCount)}</span>
          </button>
        </div>
      </div>
    </article>
  );
}
