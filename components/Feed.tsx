'use client';

import { useState } from 'react';
import PostCard from '@/components/PostCard';
import { useApp } from '@/lib/AppContext';
import Avatar from './Avatar';
import ThemeToggle from './ThemeToggle';
import { IC } from '@/lib/icons';

export default function Feed() {
  const { db, me, addPost, openDrawer } = useApp();
  const [composerText, setComposerText] = useState('');
  const [tab, setTab] = useState<'foryou' | 'following'>('foryou');

  const followingIds = new Set(['u1', 'u2', 'u3', 'u5', 'u6']);

  const visiblePosts = db.posts
    .slice()
    .sort((a, b) => b.ts - a.ts)
    .filter(p => {
      const allowed = p.status === 'live' || (me && (me.id === p.uid || me.role === 'admin'));
      if (!allowed) return false;
      if (tab === 'following') return followingIds.has(p.uid) || (me && p.uid === me.id);
      return true;
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
      <header className="header home-header">
        <div className="home-header-row">
          <button type="button" className="header-menu" onClick={openDrawer} aria-label="Open menu">
            {me ? <Avatar user={me} size={32} /> : IC.menu}
          </button>
          <div className="home-header-copy">
            <div className="header-title">Home</div>
            <p className="header-sub">Stories, photos, and clips from around Chautari</p>
          </div>
          <div className="header-actions">
            <ThemeToggle compact />
            <button type="button" className="icon-btn desktop-only" aria-label="Search">
              {IC.search}
            </button>
          </div>
        </div>
        <div className="tabs">
          <button type="button" className={`tab ${tab === 'foryou' ? 'active' : ''}`} onClick={() => setTab('foryou')}>
            For you
          </button>
          <button type="button" className={`tab ${tab === 'following' ? 'active' : ''}`} onClick={() => setTab('following')}>
            Following
          </button>
        </div>
      </header>

      {me && (
        <div className="composer">
          <div className="composer-avatar">
            <Avatar user={me} size={40} />
          </div>
          <div className="composer-content">
            <textarea
              className="composer-input"
              placeholder={`What's happening, ${me.name.split(' ')[0] || me.username}?`}
              value={composerText}
              onChange={e => setComposerText(e.target.value)}
              rows={2}
            />
            <div className="composer-actions">
              <div className="composer-tools">
                <button type="button" className="tool-btn" aria-label="Photo">
                  <svg viewBox="0 0 24 24">
                    <path d="M3 5.5C3 4.12 4.12 3 5.5 3h13C19.88 3 21 4.12 21 5.5v13c0 1.38-1.12 2.5-2.5 2.5h-13C4.12 21 3 19.88 3 18.5v-13zM5.5 5c-.28 0-.5.22-.5.5v13c0 .28.22.5.5.5h13c.28 0 .5-.22.5-.5v-13c0-.28-.22-.5-.5-.5h-13zM19 10.5V8.5h-2.91l-1.27-1.27c-.188-.188-.443-.293-.71-.293h-3.23c-.266 0-.52.105-.708.293L8.91 8.5H6v2h2.09l1.27 1.27c.188.188.443.293.71.293h3.23c.266 0 .52-.105.708.293L17.91 10.5H19zM12 9.5c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1z" />
                  </svg>
                </button>
                <button type="button" className="tool-btn" aria-label="Video">
                  <svg viewBox="0 0 24 24">
                    <path d="M21 6.5v11l-5-2.8V16.5c0 1.38-1.12 2.5-2.5 2.5h-9C3.12 19 2 17.88 2 16.5v-9C2 6.12 3.12 5 4.5 5h9C14.88 5 16 6.12 16 7.5v1.8L21 6.5z" />
                  </svg>
                </button>
              </div>
              <button
                type="button"
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
