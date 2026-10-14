'use client';

import { useState } from 'react';
import PostCard from '@/components/PostCard';
import { useApp } from '@/lib/AppContext';
import Avatar from './Avatar';

export default function Feed() {
  const { db, me, addPost } = useApp();
  const [composerText, setComposerText] = useState('');

  const visiblePosts = db.posts
    .slice()
    .sort((a, b) => b.ts - a.ts)
    .filter(p => {
      return p.status === 'live' || (me && (me.id === p.uid || me.role === 'admin'));
    });

  const handlePost = () => {
    if (!composerText.trim() || !me) return;

    addPost({
      id: Math.random().toString(36).slice(2, 10),
      uid: me.id,
      text: composerText,
      media: [],
      ts: Date.now(),
      status: 'live'
    });

    setComposerText('');
  };

  return (
    <>
      <header className="header">
        <div className="header-title">Home</div>
      </header>

      <div className="tabs">
        <div className="tab active">For you</div>
      </div>

      {me && (
        <div className="composer">
          <div className="composer-avatar">
            <Avatar user={me} size={40} />
          </div>
          <div className="composer-content">
            <textarea
              className="composer-input"
              placeholder="What is happening?!"
              value={composerText}
              onChange={e => setComposerText(e.target.value)}
              rows={2}
            />
            <div className="composer-actions">
              <div className="composer-tools">
                <button className="tool-btn">
                  <svg viewBox="0 0 24 24">
                    <path d="M3 5.5C3 4.12 4.12 3 5.5 3h13C19.88 3 21 4.12 21 5.5v13c0 1.38-1.12 2.5-2.5 2.5h-13C4.12 21 3 19.88 3 18.5v-13zM5.5 5c-.28 0-.5.22-.5.5v13c0 .28.22.5.5.5h13c.28 0 .5-.22.5-.5v-13c0-.28-.22-.5-.5-.5h-13zM19 10.5V8.5h-2.91l-1.27-1.27c-.188-.188-.443-.293-.71-.293h-3.23c-.266 0-.52.105-.708.293L8.91 8.5H6v2h2.09l1.27 1.27c.188.188.443.293.71.293h3.23c.266 0 .52-.105.708-.293L17.91 10.5H19zM12 9.5c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1z" />
                  </svg>
                </button>
                <button className="tool-btn">
                  <svg viewBox="0 0 24 24">
                    <path d="M3 5.5C3 4.12 4.12 3 5.5 3h13C19.88 3 21 4.12 21 5.5v13c0 1.38-1.12 2.5-2.5 2.5h-13C4.12 21 3 19.88 3 18.5v-13zM5.5 5c-.28 0-.5.22-.5.5v13c0 .28.22.5.5.5h13c.28 0 .5-.22.5-.5v-13c0-.28-.22-.5-.5-.5h-13zM8 10h8v2H8v-2zm0 4h8v2H8v-2z" />
                  </svg>
                </button>
                <button className="tool-btn">
                  <svg viewBox="0 0 24 24">
                    <path d="M8 9.5C8 8.12 9.12 7 10.5 7h3c.83 0 1.5.67 1.5 1.5S14.33 10 13.5 10h-3c-.28 0-.5.22-.5.5s.22-.5.5-.5h3c.28 0 .5-.22.5-.5s-.22-.5-.5-.5h-3C9.12 7 8 8.12 8 9.5zm1.5 2.5c-.28 0-.5.22-.5.5s.22-.5.5-.5h5c.28 0 .5.22.5.5s-.22.5-.5.5h-5c-.28 0-.5-.22-.5-.5zm-1.5 3.5c0-.83.67-1.5 1.5-1.5h5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-5c-.83 0-1.5-.67-1.5-1.5z" />
                  </svg>
                </button>
                <button className="tool-btn">
                  <svg viewBox="0 0 24 24">
                    <path d="M8 10c0-2.21 1.79-4 4-4s4 1.79 4 4-1.79 4-4 4-4-1.79-4-4zm2 0c0 1.1.9 2 2 2s2-.9 2-2-.9-2-2-2-2 .9-2 2zm-2 8c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                  </svg>
                </button>
              </div>
              <button
                className={`post-submit ${composerText.trim() ? 'active' : ''}`}
                onClick={handlePost}
                disabled={!composerText.trim()}
              >
                Post
              </button>
            </div>
          </div>
        </div>
      )}

      {visiblePosts.map(post => {
        const author = db.users.find(u => u.id === post.uid);
        if (!author) return null;
        return <PostCard key={post.id} post={post} author={author} />;
      })}
    </>
  );
}
