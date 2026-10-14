'use client';

import { useState } from 'react';
import PostCard from '@/components/PostCard';
import { useApp } from '@/lib/AppContext';
import Avatar from './Avatar';
import CreatePostModal from './CreatePostModal';
import { Media } from '@/lib/types';
import ThemeToggle from './ThemeToggle';
import { IC } from '@/lib/icons';

export default function Feed() {
  const { db, me, addPost, openDrawer } = useApp();
  const [composerText, setComposerText] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [tab, setTab] = useState<'foryou' | 'following'>('foryou');

  const followingIds = new Set(['u1', 'u2', 'u3', 'u5', 'u6', 'u8', 'u9', 'u10']);

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

  const publishFromModal = (text: string, media: Media[]) => {
    if (!me) return;
    addPost({
      id: Math.random().toString(36).slice(2, 10),
      uid: me.id,
      text,
      media,
      ts: Date.now(),
      status: 'live'
    });
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
          <div className="composer-content composer-row">
            <button type="button" className="composer-trigger" onClick={() => setCreateOpen(true)}>
              {`Pull up a seat, ${me.name.split(' ')[0] || me.username}. What's the story today?`}
            </button>
            <button type="button" className="composer-photo" aria-label="Photo" onClick={() => setCreateOpen(true)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 13.5V19h14v-3l-4-4.5-4.5 5-2.5-2.5L5 16.5zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
              </svg>
              <span>Photo</span>
            </button>
            <button type="button" className="composer-photo composer-video" aria-label="Video" onClick={() => setCreateOpen(true)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4.5 5h9A2.5 2.5 0 0 1 16 7.5v1.8L21 6.5v11l-5-2.8v1.8a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 2 16.5v-9A2.5 2.5 0 0 1 4.5 5z" />
              </svg>
              <span>Video</span>
            </button>
          </div>
        </div>
      )}

      {me && <CreatePostModal me={me} open={createOpen} onClose={() => setCreateOpen(false)} onPublish={publishFromModal} />}

      {visiblePosts.map(post => {
        const author = db.users.find(u => u.id === post.uid);
        if (!author) return null;
        return <PostCard key={post.id} post={post} author={author} />;
      })}
    </>
  );
}
