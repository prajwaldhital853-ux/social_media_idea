'use client';

import { ReactNode, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import NavRail from './NavRail';
import TopBar from './TopBar';
import SuggestCard from './SuggestCard';
import Drawer from './Drawer';
import MobileNav from './MobileNav';
import SiteFooter from './SiteFooter';
import Toast from './Toast';
import PullToRefresh from './PullToRefresh';
import CreatePostModal from './CreatePostModal';
import CreateChooser from './CreateChooser';
import { useApp } from '@/lib/AppContext';
import { refreshHeldLists, refreshPullers } from '@/lib/lists';

const WARM_ROUTES = ['/explore', '/video', '/marketplace', '/create', '/notifications', '/messages', '/wallet', '/saved', '/settings', '/signup', '/login'];

// Every page mounts its own shell, so a shell that paints nothing until an
// effect has run drops the top bar, the rail and the page for a frame on each
// navigation — which reads as a refresh. One boot per session is all that
// hydration needs, because the server bundle never runs the effect.
let booted = false;

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const focusedPage = pathname.startsWith('/post/') || pathname === '/explore' || pathname === '/create';
  const postPage = pathname.startsWith('/post/');
  const inChat = /^\/messages\/[^/]+/.test(pathname);
  const profilePage = pathname.startsWith('/u/');
  // Only the feed is a column of cards on the gray canvas; every other screen
  // keeps its own white sheet, so a shared background cannot wash out a page.
  const feedPage = pathname === '/';
  // The inbox and a thread are one messenger surface, so the calm column steps
  // aside and the chat owns the whole width behind the top bar.
  const messengerPage = pathname === '/messages' || pathname.startsWith('/messages/');
  // Browsing listings is a grid, not a column: it reads better edge to edge.
  const marketPage = pathname === '/marketplace' || pathname.startsWith('/marketplace/');
  const [mounted, setMounted] = useState(booted);
  const { serverMode, resync } = useApp();
  useEffect(() => {
    booted = true;
    setMounted(true);
  }, []);

  // A chat thread and the composer own the vertical drag: on a thread a downward
  // pull is "read the older messages", and the sheet has nothing to re-pull.
  const pullable = !inChat && pathname !== '/create';

  // One gesture for the whole page. The reader is lifted to the top, every list
  // this screen reads is re-pulled from page one — and because a rebuild empties
  // the rows first, each section draws its own skeleton and then the new data.
  // The session rides along, so a screen with no list (a profile header, a
  // balance, the badges) still answers with something fresher.
  const refresh = async () => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    try {
      if (serverMode) await Promise.all([refreshHeldLists(), refreshPullers(), resync()]);
      // A demo build has no server to ask, but the gesture still has to land
      // somewhere: a spinner that snaps straight back reads as a broken control.
      else await new Promise(resolve => setTimeout(resolve, 500));
    } catch { /* each list reports its own failure; the pull only has to unwind */ }
  };

  useEffect(() => {
    if (!mounted) return;
    const idle = window.requestIdleCallback ?? ((fn: IdleRequestCallback) => setTimeout(fn, 300));
    const handle = idle(() => WARM_ROUTES.forEach(route => router.prefetch(route)));
    return () => {
      if (window.cancelIdleCallback) window.cancelIdleCallback(handle as number);
      else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
    };
  }, [mounted, router]);

  if (!mounted) return null;

  return (
    <div className={`shell ${focusedPage ? 'focused-page' : ''} ${postPage ? 'post-page' : ''} ${inChat ? 'chat-page' : ''} ${feedPage ? 'feed-page' : ''} ${messengerPage ? 'messenger-page' : ''} ${marketPage ? 'market-page' : ''}`}>
      {!focusedPage && <TopBar />}
      <NavRail />
      <main className="main">
        <div className="page-enter" key={pathname}>
          {children}
          {!focusedPage && profilePage && <SiteFooter />}
        </div>
      </main>
      {/* The people page is itself a column of suggested faces; a second
          "Suggested for you" beside it only pushed the list down — and an empty
          calm band is still a band, so the whole column goes. */}
      {pathname !== '/people' && (
        <aside className="side-calm">
          <SuggestCard />
        </aside>
      )}
      <Drawer />
      <MobileNav />
      <CreatePostModal />
      <CreateChooser />
      {pullable && <PullToRefresh onRefresh={refresh} />}
      <Toast />
    </div>
  );
}