'use client';

import { useState } from 'react';
import PostCard from '@/components/PostCard';
import { useApp } from '@/lib/AppContext';
import Avatar from './Avatar';
import CreatePostModal from './CreatePostModal';
import { Media } from '@/lib/types';
import ThemeToggle from './ThemeToggle';
import { IC } from '@/lib/icons';
import Link from 'next/link';

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
              <svg viewBox="0 0 24 24" aria-hidden="true" className="ci"><rect x="3" y="6" width="18" height="14" rx="4" /><path d="M8.5 6l1.4-2.2h4.2L15.5 6" /><circle cx="12" cy="13" r="3.4" /><circle cx="17.6" cy="9.4" r=".6" className="dot" /></svg>
              <span>Photo</span>
            </button>
            <button type="button" className="composer-photo composer-video" aria-label="Video" onClick={() => setCreateOpen(true)}>
              <svg viewBox="0 0 24 24" aria-hidden="true" className="ci"><rect x="3" y="4" width="18" height="16" rx="4" /><path d="M3 8.5h18M8 4l-2 4.5M13.5 4l-2 4.5M19 4l-2 4.5" /><path d="M10.5 12.2v4.6l3.8-2.3z" className="fillme" /></svg>
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
