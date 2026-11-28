'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import Avatar from '@/components/Avatar';
import ThemeToggle from '@/components/ThemeToggle';
import ListingForm from '@/components/ListingForm';
import { useApp } from '@/lib/AppContext';
import { listingsFragment, useList } from '@/lib/lists';
import { useWindowed } from '@/lib/useWindowed';
import { closeLayerWithoutBack } from '@/lib/useBackClose';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/utils';
import { Listing } from '@/lib/types';

export default function MarketplacePage() {
  const router = useRouter();
  const { db, me, t, featureLock, activePromo, promoEligible, trackPromo, serverMode } = useApp();
  const off = featureLock('marketplace');
  const lang = db.lang;
  const [tab, setTab] = useState<'browse' | 'mine'>('browse');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('all');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [creating, setCreating] = useState(false);

  // Typing is immediate; the server is asked a beat later, so a whole word
  // costs one query instead of one per keystroke.
  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 350);
    return () => clearTimeout(id);
  }, [q]);

  const market = useList(
    'market',
    { path: '/marketplace/', frag: listingsFragment },
    {
      mine: tab === 'mine' ? 1 : undefined,
      q: query || undefined,
      category: cat !== 'all' ? cat : undefined,
      min: min === '' ? undefined : min,
      max: max === '' ? undefined : max,
    },
    serverMode,
  );

  const listings = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const lo = min === '' ? null : Number(min);
    const hi = max === '' ? null : Number(max);
    if (serverMode) {
      // Filters were applied where the rows are: the server already chose them,
      // newest first, and the cursor is the only thing that decides the order.
      const index = new Map(db.listings.map(l => [l.id, l] as [string, Listing]));
      return market.ids
        .map(id => index.get(id))
        .filter((l): l is Listing => !!l && (tab === 'mine' ? l.status !== 'removed' : l.status === 'active'));
    }
    const visible = db.listings.filter(l => {
      if (tab === 'mine') {
        if (l.uid !== me?.id || l.status === 'removed') return false;
      } else if (l.status !== 'active') {
        return false;
      }
      if (needle && !`${l.title} ${l.desc} ${l.location}`.toLowerCase().includes(needle)) return false;
      if (cat !== 'all' && l.category !== cat) return false;
      if (lo !== null && Number.isFinite(lo) && l.price < lo) return false;
      if (hi !== null && Number.isFinite(hi) && l.price > hi) return false;
      return true;
    });
    const boosted = (l: Listing) => {
      const p = activePromo('listing', l.id);
      return p && promoEligible(p) ? 1 : 0;
    };
    return visible.sort((a, b) => boosted(b) - boosted(a) || b.ts - a.ts);
  }, [db.listings, market.ids, serverMode, tab, q, cat, min, max, me?.id, activePromo, promoEligible]);

  const filtersOn = q !== '' || cat !== 'all' || min !== '' || max !== '';
  const clearFilters = () => { setQ(''); setCat('all'); setMin(''); setMax(''); };
  const { limit, pending, sentinel, hasMore } = useWindowed(listings.length, 10, `${tab}|${query}|${cat}|${min}|${max}`,
    serverMode ? {
      hasMore: market.hasMore, loading: market.loading, load: market.loadMore,
      loaded: market.loaded, error: market.error, retry: market.reload,
    } : undefined);

  return <AppShell>
    <div className="market-view">
      <header className="header home-header">
        <div className="home-header-row">
          <div className="home-header-copy">
            <h1 className="header-title">{t('marketplace')}</h1>
            <p className="header-sub">{t('marketSub')}</p>
          </div>
          <div className="header-actions">
            {me && (
              <button type="button" className={`ghost-btn${off ? ' f-off' : ''}`} onClick={() => setCreating(true)} {...(off ? off.props : {})}>
                {IC.plus}<span>{t('createListing')}</span>
              </button>
            )}
            <ThemeToggle compact/>
          </div>
        </div>
      </header>

      {off && <p className="feature-off-note">{off.msg}</p>}

      {me && (
        <div className="tabs market-tabs">
          <button type="button" className={`tab ${tab === 'browse' ? 'active' : ''}`} onClick={() => setTab('browse')}>{t('marketplace')}</button>
          <button type="button" className={`tab ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>{t('myListings')}</button>
        </div>
      )}

      <div className="market-filters">
        <div className="market-search">
          {IC.search}
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('search')} aria-label={t('search')}/>
        </div>
        <select value={cat} onChange={e => setCat(e.target.value)} aria-label={t('category')}>
          <option value="all">{t('allCategories')}</option>
          {db.settings.categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="number" min={0} value={min} onChange={e => setMin(e.target.value)} placeholder={t('minPrice')} aria-label={t('minPrice')}/>
        <input type="number" min={0} value={max} onChange={e => setMax(e.target.value)} placeholder={t('maxPrice')} aria-label={t('maxPrice')}/>
        {filtersOn && (
          <button type="button" className="market-clear" onClick={clearFilters}>{IC.x}<span>{t('clearFilters')}</span></button>
        )}
      </div>

      {listings.length === 0 && serverMode && market.error ? (
        <div className="empty-state">
          <h2>{t('listFailed')}</h2>
          <button type="button" className="empty-state-cta" onClick={() => void market.reload()}>{t('retry')}</button>
        </div>
      ) : listings.length === 0 && serverMode && !market.loaded ? (
        <div className="market-grid" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div className="market-card skeleton" key={i}>
              <span className="market-card-media sk-block" />
              <span className="market-card-body"><span className="sk-lines wide"><i /><i /></span></span>
            </div>
          ))}
        </div>
      ) : listings.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">{IC.store}</span>
          <h2>{t('noListings')}</h2>
          {filtersOn ? (
            <button type="button" className="empty-state-cta" onClick={clearFilters}>{t('clearFilters')}</button>
          ) : me ? (
            <button type="button" className={`empty-state-cta${off ? ' f-off' : ''}`} onClick={() => setCreating(true)} {...(off ? off.props : {})}>{t('createListing')}</button>
          ) : (
            <button type="button" className="empty-state-cta" onClick={() => router.push('/login')}>{t('signIn')}</button>
          )}
        </div>
      ) : (
        <div className="market-grid">
          {listings.slice(0, limit).map(l => {
            const seller = db.users.find(u => u.id === l.uid);
            const img = l.media.find(m => m.type === 'image' && m.src);
            const promo = activePromo('listing', l.id);
            // Against a server the line comes from the row itself, so an advert whose
            // campaign has not reached this cache yet is still disclosed as one.
            const boosted = !!l.promoted || (!!promo && promoEligible(promo));
            // The row knows which campaign bought it even when this reader's cache
            // never saw that campaign, so the tap still lands on the payer's figures.
            const promoId = promo?.id || l.promoId;
            const open = () => {
              if (promoId && me?.id !== l.uid) void trackPromo(promoId, 'click');
              router.push(`/marketplace/${l.id}`);
            };
            return (
              <button type="button" key={l.id} className="market-card" onClick={open}>
                <span className="market-card-media">
                  {img ? <img src={img.src} alt={l.title} loading="lazy"/> : <span className="market-card-noimg">{IC.store}</span>}
                  {l.status === 'sold' && <span className="market-sold">{t('sold')}</span>}
                  {l.status === 'hidden' && <span className="market-sold hidden">{t('pending')}</span>}
                  {boosted && l.status === 'active' && <span className="market-promoted">{IC.chart}{t('promoted')}</span>}
                </span>
                <span className="market-card-body">
                  <b className="market-card-price">NPR {l.price.toLocaleString('en-US')}</b>
                  <span className="market-card-title">{l.title}</span>
                  <span className="market-card-loc">{IC.globe}{l.location} · {ago(l.ts, lang)}</span>
                  {seller && (
                    <span className="market-card-seller">
                      <Avatar user={seller} size={22}/>
                      <span>{seller.name}</span>
                    </span>
                  )}
                </span>
              </button>
            );
          })}
          {pending && hasMore && (
            <div className="market-card skeleton" aria-hidden="true">
              <span className="market-card-media sk-block" />
              <span className="market-card-body"><span className="sk-lines wide"><i /><i /></span></span>
            </div>
          )}
        </div>
      )}
      {hasMore && listings.length > 0 && <div ref={sentinel} className="feed-sentinel" aria-hidden="true" />}

      {creating && me && (
        <ListingForm
          onClose={() => setCreating(false)}
          onSaved={id => { closeLayerWithoutBack(); setTab('mine'); router.push(`/marketplace/${id}`); }}
        />
      )}
    </div>
  </AppShell>;
}