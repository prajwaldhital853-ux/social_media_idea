'use client';

import AppShell from '@/components/AppShell';
import PostCard from '@/components/PostCard';
import { useApp } from '@/lib/AppContext';
import { canSeePost } from '@/lib/utils';

export default function VideoPage() {
  const { db, me, feature } = useApp();
  const posts = db.posts.filter(p => p.status === 'live' && canSeePost(p, me?.id ?? null, db.follows) && (p.kind === 'reel' || p.media.some(m => m.type === 'video'))).sort((a, b) => b.ts - a.ts);
  return <AppShell>
    <header className="header search-page-header"><h1 className="header-title">Video</h1></header>
    {!feature('video') ? <p className="feed-empty">Video is currently unavailable.</p> : posts.map(post => {
      const author = db.users.find(u => u.id === post.uid);
      return author ? <PostCard key={post.id} post={post} author={author} /> : null;
    })}
  </AppShell>;
}
