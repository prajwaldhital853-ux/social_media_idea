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
import CreatePostModal from './CreatePostModal';
import CreateChooser from './CreateChooser';

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
  useEffect(() => {
    booted = true;
    setMounted(true);
  }, []);

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
      <aside className="side-calm">
        <SuggestCard />
      </aside>
      <Drawer />
      <MobileNav />
      <CreatePostModal />
      <CreateChooser />
      <Toast />
    </div>
  );
}