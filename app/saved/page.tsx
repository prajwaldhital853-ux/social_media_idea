'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import AppShell from '@/components/AppShell';
import PostCard from '@/components/PostCard';
import ThemeToggle from '@/components/ThemeToggle';
import { useApp } from '@/lib/AppContext';
import { listingsFragment, postsFragment, useList } from '@/lib/lists';
import { useWindowed } from '@/lib/useWindowed';
import { canSeePost, privateIds, ago } from '@/lib/utils';
import { IC } from '@/lib/icons';
import { Listing, Post } from '@/lib/types';

export default function SavedPage() {
  const { db, me, t, serverMode, ready } = useApp();

  // Saving is a keyset list of its own: the rows arrive already resolved to
  // posts and listings, in the order they were saved.
  const savedPosts = useList(
    'saved-posts',
    { path: '/saved/posts/', frag: postsFragment(me?.id || null) },
    undefined,
    serverMode && !!me,
  );
  const savedListings = useList(
    'saved-listings',
    { path: '/saved/listings/', frag: listingsFragment },
    undefined,
    serverMode && !!me,
  );

  const posts = useMemo<Post[]>(() => {
    if (serverMode) {
      const index = new Map(db.posts.map(p => [p.id, p] as [string, Post]));
      // The server already applied the audience rule to this page; re-applying a
      // local one here — over a follow graph that is only ever a slice — hides
      // rows the list promised and makes the count disagree with the API.
      return savedPosts.ids.map(id => index.get(id)).filter((p): p is Post => !!p && p.status === 'live');
    }
    if (!me) return [];
    return db.saves
      .filter(s => s.uid === me.id)
      .sort((a, b) => b.ts - a.ts)
      .map(s => db.posts.find(p => p.id === s.pid))
      .filter((p): p is Post => !!p && p.status === 'live' && canSeePost(p, me.id, db.follows, privateIds(db.users)));
  }, [db.posts, db.saves, db.follows, me, savedPosts.ids, serverMode]);

  const listings = useMemo<Listing[]>(() => {
    if (serverMode) {
      const index = new Map(db.listings.map(l => [l.id, l] as [string, Listing]));
      return savedListings.ids
        .map(id => index.get(id))
        .filter((l): l is Listing => !!l && l.status !== 'removed');
    }
    if (!me) return [];
    return (db.listingSaves || [])
      .filter(s => s.uid === me.id)
      .sort((a, b) => b.ts - a.ts)
      .map(s => db.listings.find(l => l.id === s.lid))
      .filter((l): l is Listing => !!l && l.status !== 'removed');
  }, [db.listings, db.listingSaves, me, savedListings.ids, serverMode]);

  const {
    limit: postLimit, pending: postsPending, sentinel: postsSentinel, hasMore: morePosts,
  } = useWindowed(posts.length, 10, 'saved-posts',
    serverMode ? { hasMore: savedPosts.hasMore, loading: savedPosts.loading, load: savedPosts.loadMore } : undefined);
  const {
    limit: listingLimit, pending: listingsPending, sentinel: listingsSentinel, hasMore: moreListings,
  } = useWindowed(listings.length, 8, 'saved-listings',
    serverMode ? { hasMore: savedListings.hasMore, loading: savedListings.loading, load: savedListings.loadMore } : undefined);

  return (
    <AppShell>
      <header className="header home-header">
        <div className="home-header-row">
          <div className="home-header-copy">
            <div className="header-title">{t('savedPosts')}</div>
            <p className="header-sub">{t('savedSub')}</p>
          </div>
          <div className="header-actions"><ThemeToggle compact /></div>
        </div>
      </header>

      {!me ? (ready ? (
        <div className="feed-empty">
          <p>{t('needLogin')}</p>
          <Link href="/login">{t('signIn')}</Link>
        </div>
      ) : null) : posts.length === 0 && listings.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">{IC.bookmark}</span>
          <h2>{t('noSaved')}</h2>
          <p>{t('savedSub')}</p>
          <Link className="empty-state-cta" href="/">{t('backFeed')}</Link>
        </div>
      ) : (
        <>
          {listings.length > 0 && (
            <section className="saved-section">
              <h2 className="saved-section-title">{IC.store}{t('savedListings')}</h2>
              <div className="market-grid">
                {listings.slice(0, listingLimit).map(l => {
                  const img = l.media.find(m => m.type === 'image' && m.src);
                  return (
                    <Link href={`/marketplace/${l.id}`} key={l.id} className="market-card">
                      <span className="market-card-media">
                        {img ? <img src={img.src} alt={l.title} loading="lazy" /> : <span className="market-card-noimg">{IC.store}</span>}
                        {l.status === 'sold' && <span className="market-sold">{t('sold')}</span>}
                      </span>
                      <span className="market-card-body">
                        <b className="market-card-price">NPR {l.price.toLocaleString('en-US')}</b>
                        <span className="market-card-title">{l.title}</span>
                        <span className="market-card-loc">{IC.globe}{l.location} · {ago(l.ts, db.lang)}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
              {listingsPending && moreListings && (
                <div className="market-grid">
                  {[0, 1, 2].map(i => (
                    <div className="market-card skeleton" key={i} aria-hidden="true">
                      <span className="market-card-media" />
                      <span className="market-card-body"><b className="market-card-price" /><span className="market-card-title" /></span>
                    </div>
                  ))}
                </div>
              )}
              {moreListings && <div ref={listingsSentinel} className="feed-sentinel" aria-hidden="true" />}
            </section>
          )}
          {posts.length > 0 && (
            <div className="saved-list">
              {posts.slice(0, postLimit).map(post => {
                const author = db.users.find(u => u.id === post.uid);
                return author ? <PostCard key={post.id} post={post} author={author} /> : null;
              })}
              {postsPending && morePosts && (
                <div className="feed-skeleton" aria-hidden="true">
                  <div className="feed-skeleton-head"><span className="sk-avatar" /><span className="sk-lines"><i /><i /></span></div>
                  <div className="sk-block" />
                  <div className="sk-lines wide"><i /><i /></div>
                </div>
              )}
              {morePosts && <div ref={postsSentinel} className="feed-sentinel" aria-hidden="true" />}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}