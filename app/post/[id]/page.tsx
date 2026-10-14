'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import TwitterLayout from '@/components/TwitterLayout';
import PostCard from '@/components/PostCard';
import { useApp } from '@/lib/AppContext';
import { esc, ago } from '@/lib/utils';
import Avatar from '@/components/Avatar';
import { IC } from '@/lib/icons';

export default function PostPage() {
  const params = useParams();
  const router = useRouter();
  const { db, me, addComment, deleteComment, isAuthenticated } = useApp();
  const [commentText, setCommentText] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, router, mounted]);

  if (!mounted) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div style={{ color: 'var(--muted)' }}>Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const post = db.posts.find(p => p.id === params.id);
  const comments = db.comments.filter(c => c.pid === params.id).sort((a, b) => a.ts - b.ts);

  if (!post || (post.status !== 'live' && !(me && (me.id === post.uid || me.role === 'admin')))) {
    return (
      <TwitterLayout>
        <header className="header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '16px' }}>
            <button onClick={() => router.push('/')}>
              {IC.x}
            </button>
            <div className="header-title">Post</div>
          </div>
        </header>
        <p style={{ padding: '32px', textAlign: 'center', color: 'var(--muted)' }}>This post is not available</p>
      </TwitterLayout>
    );
  }

  const author = db.users.find(u => u.id === post.uid) || {
    id: 'deleted',
    email: '',
    username: 'deleted',
    name: '',
    role: 'user' as const,
    verified: false,
    susp: null
  };

  const handleCommentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!me) {
      router.push('/login');
      return;
    }
    if (!commentText.trim()) return;

    addComment({
      id: Math.random().toString(36).slice(2, 10),
      pid: post.id,
      uid: me.id,
      text: commentText.slice(0, 1000),
      ts: Date.now(),
      status: 'live'
    });

    setCommentText('');
  };

  const handleDeleteComment = (commentId: string) => {
    deleteComment(commentId);
  };

  return (
    <TwitterLayout>
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '16px' }}>
          <button onClick={() => router.push('/')} style={{ padding: '8px', borderRadius: '50%' }}>
            {IC.x}
          </button>
          <div className="header-title">Post</div>
        </div>
      </header>

      <PostCard post={post} author={author} />

      <div style={{ padding: '16px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ marginBottom: '16px', color: 'var(--muted)', fontSize: '15px' }}>
          Replying to <span style={{ color: 'var(--blue)' }}>@{author.username}</span>
        </div>

        {me ? (
          <form onSubmit={handleCommentSubmit} style={{ display: 'flex', gap: '12px' }}>
            <Avatar user={me} size={40} />
            <div style={{ flex: 1 }}>
              <textarea
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                maxLength={1000}
                placeholder="Post your reply"
                style={{
                  width: '100%',
                  padding: '12px 0',
                  fontSize: '20px',
                  fontFamily: 'inherit',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--ink)',
                  resize: 'none',
                  outline: 'none',
                  minHeight: '80px'
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button type="button" className="tool-btn">
                    <svg viewBox="0 0 24 24">
                      <path d="M3 5.5C3 4.12 4.12 3 5.5 3h13C19.88 3 21 4.12 21 5.5v13c0 1.38-1.12 2.5-2.5 2.5h-13C4.12 21 3 19.88 3 18.5v-13zM5.5 5c-.28 0-.5.22-.5.5v13c0 .28.22.5.5.5h13c.28 0 .5-.22.5-.5v-13c0-.28-.22-.5-.5-.5h-13zM19 10.5V8.5h-2.91l-1.27-1.27c-.188-.188-.443-.293-.71-.293h-3.23c-.266 0-.52.105-.708.293L8.91 8.5H6v2h2.09l1.27 1.27c.188.188.443.293.71.293h3.23c.266 0 .52-.105.708-.293L17.91 10.5H19zM12 9.5c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1z" />
                    </svg>
                  </button>
                  <button type="button" className="tool-btn">
                    <svg viewBox="0 0 24 24">
                      <path d="M8 10c0-2.21 1.79-4 4-4s4 1.79 4 4-1.79 4-4 4-4-1.79-4-4zm2 0c0 1.1.9 2 2 2s2-.9 2-2-.9-2-2-2-2 .9-2 2zm-2 8c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                    </svg>
                  </button>
                </div>
                <button
                  type="submit"
                  className={`post-submit ${commentText.trim() ? 'active' : ''}`}
                  disabled={!commentText.trim()}
                >
                  Reply
                </button>
              </div>
            </div>
          </form>
        ) : (
          <button
            onClick={() => router.push('/login')}
            className="post-submit active"
            style={{ width: '100%' }}
          >
            Sign in to reply
          </button>
        )}
      </div>

      {comments.map(c => {
        const commentAuthor = db.users.find(u => u.id === c.uid) || {
          id: 'deleted',
          email: '',
          username: 'deleted',
          name: '',
          role: 'user' as const,
          verified: false,
          susp: null
        };
        return (
          <article key={c.id} className="post">
            <div className="post-avatar">
              <Avatar user={commentAuthor} size={40} />
            </div>
            <div className="post-content">
              <div className="post-header">
                <span className="post-name">{esc(commentAuthor.name || commentAuthor.username)}</span>
                <span className="post-handle">@{esc(commentAuthor.username)}</span>
                <span className="post-time">{ago(c.ts, 'en')}</span>
              </div>
              {c.status === 'live' ? (
                <div className="post-text">{esc(c.text)}</div>
              ) : (
                <div className="post-text" style={{ color: 'var(--muted)' }}>This comment was removed</div>
              )}
              {c.status === 'live' && me && me.id === c.uid && (
                <button
                  onClick={() => handleDeleteComment(c.id)}
                  style={{ marginTop: '12px', color: 'var(--red)', fontSize: '13px', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  Delete
                </button>
              )}
            </div>
          </article>
        );
      })}
    </TwitterLayout>
  );
}
