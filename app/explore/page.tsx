'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import PostCard from '@/components/PostCard';
import Avatar from '@/components/Avatar';
import { useApp } from '@/lib/AppContext';

function SearchResults() {
  const { db } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const query = params.get('q') || '';
  const [input, setInput] = useState(query);
  useEffect(() => setInput(query), [query]);
  const normalized = query.trim().toLocaleLowerCase();
  const users = normalized ? db.users.filter(u => `${u.name} ${u.username}`.toLocaleLowerCase().includes(normalized.replace(/^@/, ''))) : [];
  const posts = normalized ? db.posts.filter(p => p.status === 'live' && p.text.toLocaleLowerCase().includes(normalized)).sort((a, b) => b.ts - a.ts) : [];
  return <>
    <header className="header search-page-header">
      <h1 className="header-title">Search</h1>
      <form onSubmit={e => { e.preventDefault(); router.push(`/explore?q=${encodeURIComponent(input.trim())}`); }}>
        <input className="search-input" type="search" aria-label="Search posts and people" placeholder="Search posts, people or hashtags" value={input} onChange={e => setInput(e.target.value)} />
      </form>
    </header>
    {!normalized ? <p className="feed-empty">Search for a person, a hashtag or something that interests you.</p> : <>
      {users.map(user => <Link className="search-person" key={user.id} href={`/u/${user.username}`}><Avatar user={user} size={36} /><span><b>{user.name}</b><small>@{user.username}</small></span></Link>)}
      {posts.map(post => { const author = db.users.find(u => u.id === post.uid); return author ? <PostCard key={post.id} post={post} author={author} /> : null; })}
      {!users.length && !posts.length && <p className="feed-empty">No results for “{query}”. Try another search.</p>}
    </>}
  </>;
}

export default function ExplorePage() {
  return <AppShell><Suspense fallback={<p className="feed-empty">Loading search…</p>}><SearchResults /></Suspense></AppShell>;
}
