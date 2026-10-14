'use client';

import { ReactNode } from 'react';
import TwitterSidebar from './TwitterSidebar';
import Drawer from './Drawer';
import MobileNav from './MobileNav';

interface TwitterLayoutProps {
  children: ReactNode;
}

export default function TwitterLayout({ children }: TwitterLayoutProps) {
  return (
    <div className="shell">
      <TwitterSidebar />
      <main className="main">{children}</main>
      <aside className="widgets">
        <div className="search-box">
          <svg className="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10.25 3.75c-3.59 0-6.5 2.91-6.5 6.5s2.91 6.5 6.5 6.5c1.795 0 3.419-.726 4.596-1.904 1.178-1.177 1.904-2.801 1.904-4.596 0-3.59-2.91-6.5-6.5-6.5zm-8.5 6.5c0-4.694 3.806-8.5 8.5-8.5s8.5 3.806 8.5 8.5c0 1.986-.682 3.815-1.824 5.262l4.781 4.781-1.414 1.414-4.781-4.781c-1.447 1.142-3.276 1.824-5.262 1.824-4.694 0-8.5-3.806-8.5-8.5z" />
          </svg>
          <input type="text" className="search-input" placeholder="Search Chautari" />
        </div>

        <div className="widget">
          <div className="widget-header">What&apos;s happening</div>
          <div className="trend-item">
            <div className="trend-meta">Technology · Trending</div>
            <div className="trend-name">#ArtificialIntelligence</div>
            <div className="trend-count">125K posts</div>
          </div>
          <div className="trend-item">
            <div className="trend-meta">Travel · Trending</div>
            <div className="trend-name">Pokhara</div>
            <div className="trend-count">18.4K posts</div>
          </div>
          <div className="trend-item">
            <div className="trend-meta">Business · Trending</div>
            <div className="trend-name">Tech Stocks</div>
            <div className="trend-count">45.1K posts</div>
          </div>
          <div className="trend-item">
            <div className="trend-meta">Science · Trending</div>
            <div className="trend-name">#ClimateChange</div>
            <div className="trend-count">32.8K posts</div>
          </div>
        </div>

        <div className="widget">
          <div className="widget-header">Who to follow</div>
          <div className="trend-item">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--line)' }} />
              <div>
                <div style={{ fontWeight: 700 }}>Tech News</div>
                <div style={{ color: 'var(--muted)', fontSize: '13px' }}>@technews</div>
              </div>
            </div>
            <button type="button" className="follow-chip">Follow</button>
          </div>
          <div className="trend-item">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--line)' }} />
              <div>
                <div style={{ fontWeight: 700 }}>Space Updates</div>
                <div style={{ color: 'var(--muted)', fontSize: '13px' }}>@spaceupdates</div>
              </div>
            </div>
            <button type="button" className="follow-chip">Follow</button>
          </div>
        </div>
      </aside>
      <Drawer />
      <MobileNav />
    </div>
  );
}
