'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import Avatar from '@/components/Avatar';
import ThemeToggle from '@/components/ThemeToggle';
import ListingForm from '@/components/ListingForm';
import { useApp } from '@/lib/AppContext';
import { useWindowed } from '@/lib/useWindowed';
import { closeLayerWithoutBack } from '@/lib/useBackClose';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/utils';
import { Listing } from '@/lib/types';

export default function MarketplacePage() {
  const router = useRouter();
  const { db, me, t, feature, activePromo, promoEligible } = useApp();
  const lang = db.lang;
  const [tab, setTab] = useState<'browse' | 'mine'>('browse');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [creating, setCreating] = useState(false);

  const listings = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const lo = min === '' ? null : Number(min);
    const hi = max === '' ? null : Number(max);
    const visible = db.listings.filter(l => {
      if (tab === 'mine') {
        if (l.uid !== me?.id || l.status === 'removed') return false;
      } else if (l.status !== 'active' && l.status !== 'sold') {
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
  }, [db.listings, tab, me?.id, q, cat, min, max, activePromo, promoEligible]);

  const filtersOn = q !== '' || cat !== 'all' || min !== '' || max !== '';
  const clearFilters = () => { setQ(''); setCat('all'); setMin(''); setMax(''); };
  const { limit, pending, sentinel, hasMore } = useWindowed(listings.length, 10, `${tab}|${q}|${cat}|${min}|${max}`);

  if (!feature('marketplace')) {
    return <AppShell>
      <header className="header home-header">
        <div className="home-header-row">
          <div className="home-header-copy">
            <h1 className="header-title">{t('marketplace')}</h1>
            <p className="header-sub">{t('marketSub')}</p>
          </div>
          <div className="header-actions"><ThemeToggle compact/></div>
        </div>
      </header>
      <div className="empty-state">
        <span className="empty-state-icon">{IC.store}</span>
        <h2>{t('marketOff')}</h2>
        <button type="button" className="empty-state-cta" onClick={() => router.push('/')}>{t('backFeed')}</button>
      </div>
    </AppShell>;
  }

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
              <button type="button" className="ghost-btn" onClick={() => setCreating(true)}>
                {IC.plus}<span>{t('createListing')}</span>
              </button>
            )}
            <ThemeToggle compact/>
          </div>
        </div>
      </header>

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

      {listings.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">{IC.store}</span>
          <h2>{t('noListings')}</h2>
          {filtersOn ? (
            <button type="button" className="empty-state-cta" onClick={clearFilters}>{t('clearFilters')}</button>
          ) : me ? (
            <button type="button" className="empty-state-cta" onClick={() => setCreating(true)}>{t('createListing')}</button>
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
            const boosted = promo && promoEligible(promo);
            return (
              <button type="button" key={l.id} className="market-card" onClick={() => router.push(`/marketplace/${l.id}`)}>
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