'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import PostCard from '@/components/PostCard';
import Avatar from '@/components/Avatar';
import { useApp } from '@/lib/AppContext';
import { canSeePost, privateIds } from '@/lib/utils';
import { postsFragment, useList, usersFragment } from '@/lib/lists';
import { IC } from '@/lib/icons';
import { goBack } from '@/lib/navStack';

function SearchResults() {
  const { db, me, serverMode, t } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const query = params.get('q') || '';
  const [input, setInput] = useState(query);
  const [history, setHistory] = useState<string[]>([]);
  const [menu, setMenu] = useState<string | null>(null);
  const key = `exposing-search-history:${me?.id || 'guest'}`;
  useEffect(() => {
    setInput(query); setMenu(null);
    let recent: string[] = [];
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) || '[]');
      if (Array.isArray(saved)) recent = saved.filter((s): s is string => typeof s === 'string' && s.length <= 128).slice(0, 20);
    } catch {}
    const term = query.trim().slice(0, 128);
    if (term) recent = [term, ...recent.filter(s => s.toLocaleLowerCase() !== term.toLocaleLowerCase())].slice(0, 20);
    setHistory(recent);
    try { localStorage.setItem(key, JSON.stringify(recent)); } catch {}
  }, [query, key]);
  const normalized = query.trim().toLocaleLowerCase();
  // Searching the whole site is the server's job: the cache only ever holds the
  // pages this session has walked through.
  const searching = normalized ? query.trim().slice(0, 128) : '';
  const peopleRows = useList('search-people', { path: '/users/', frag: usersFragment }, { q: searching }, serverMode && !!normalized);
  const postRows = useList('search-posts', { path: '/posts/', frag: postsFragment(me?.id || null) }, { q: searching }, serverMode && !!normalized);
  const peopleOf = (id: string) => db.users.find(u => u.id === id);
  const postOf = (id: string) => db.posts.find(p => p.id === id);
  const users = normalized
    ? (serverMode
      ? peopleRows.ids.map(peopleOf).filter((u): u is NonNullable<ReturnType<typeof peopleOf>> => !!u)
      : db.users.filter(u => `${u.name} ${u.username}`.toLocaleLowerCase().includes(normalized.replace(/^@/, ''))))
    : [];
  const posts = normalized
    ? (serverMode
      ? postRows.ids.map(postOf).filter((p): p is NonNullable<ReturnType<typeof postOf>> => !!p && p.status === 'live')
      : db.posts.filter(p => p.status === 'live' && canSeePost(p, me?.id ?? null, db.follows, privateIds(db.users)) && p.text.toLocaleLowerCase().includes(normalized)).sort((a, b) => b.ts - a.ts))
    : [];
  const loading = serverMode && !!normalized && (!peopleRows.loaded || !postRows.loaded);
  const failed = serverMode && !!normalized && !!(peopleRows.error || postRows.error);
  const more = serverMode && (peopleRows.hasMore || postRows.hasMore);
  const loadMore = () => {
    if (peopleRows.error) void peopleRows.reload();
    if (postRows.error) void postRows.reload();
    void peopleRows.loadMore();
    void postRows.loadMore();
  };
  const search = (value: string) => router.replace(`/explore${value.trim() ? `?q=${encodeURIComponent(value.trim())}` : ''}`);
  return <div className="search-view">
    <header className="detail-header search-detail-header">
      <div className="search-head-row">
        <button className="icon-btn" type="button" aria-label="Back" onClick={() => goBack(router, '/')}>{IC.back}</button>
        <h1>Search</h1>
        <span className="detail-header-spacer"/>
      </div>
      <form role="search" className="search-field" onSubmit={e => { e.preventDefault(); search(input); }}>
        <span className="search-field-icon">{IC.search}</span>
        <input type="search" aria-label="Search posts and people" placeholder="Search people, posts and hashtags" maxLength={128} autoComplete="off" value={input} onChange={e => { setInput(e.target.value); if (!e.target.value) search(''); }}/>
        <button type="submit" className="search-field-go" aria-label="Search">Search</button>
      </form>
    </header>
    {!normalized ? <section className="recent-searches"><h1>Recent searches</h1>
      {history.length ? history.map(term => <div className="recent-row" key={term}>
        <button className="recent-term" onClick={() => search(term)}><span className="history-icon">{IC.search}</span><span>{term}</span></button>
        <div className="recent-actions"><button type="button" className="icon-btn" aria-label={`Options for ${term}`} aria-expanded={menu === term} onClick={() => setMenu(menu === term ? null : term)}>{IC.dots}</button>
          {menu === term && <div className="recent-menu"><button onClick={() => { const next = history.filter(s => s !== term); setHistory(next); setMenu(null); try { localStorage.setItem(key, JSON.stringify(next)); } catch {} }}>Delete search</button></div>}
        </div>
      </div>) : <p className="search-empty">No recent searches. Find people, posts and hashtags here.</p>}
    </section> : <>
      <h1 className="search-results-title">Results for “{query}”</h1>
      {!loading && users.map(user => <Link className="search-person" key={user.id} href={`/u/${user.username}`}><Avatar user={user} size={36}/><span><b>{user.name}</b><small>@{user.username}</small></span></Link>)}
      {loading && <div className="people-skeleton" aria-hidden="true"><span className="sk-avatar"/><span className="sk-lines"><i/><i/></span></div>}
      {!loading && posts.map(post => { const author = db.users.find(u => u.id === post.uid); return author ? <PostCard key={post.id} post={post} author={author}/> : null; })}
      {failed
        ? <p className="feed-empty">Search could not finish. <button type="button" className="ghost-btn" onClick={loadMore}>{t('retry')}</button></p>
        : more && <div className="chat-older"><button type="button" className="chat-older-btn" disabled={peopleRows.loading || postRows.loading} onClick={loadMore}>{t('loadMore')}</button></div>}
      {!loading && !failed && !users.length && !posts.length && <p className="feed-empty">No results for “{query}”. Try another search.</p>}
    </>}
  </div>;
}

export default function ExplorePage() {
  return <AppShell><Suspense fallback={<p className="feed-empty">Loading search…</p>}><SearchResults/></Suspense></AppShell>;
}
