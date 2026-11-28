'use client';

import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { crumbsFor, drawerFor, navFor, requires } from '@/lib/nav';
import { IC } from '@/lib/icons';
import { useBell } from '@/lib/bell';
import { cameFrom, Stop, visit } from '@/lib/trail';
import { announceSeat, autoPush } from '@/lib/push';
import { useSession } from '@/lib/session';

// Every screen renders its own shell, so switching screens rebuilds this drawer
// from nothing. A moderator working down a long list would lose their place on
// every click, so the offset outlives the element that was scrolled.
let navScroll = 0;

function ago(minutes: number): string {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** The tray mixes six kinds of arrival; the two words in front of each line say
 *  which queue it came from, the same way the drawer names the desk it opens. */
const KIND_LABEL: Record<string, string> = {
  alert: 'Alert',
  report: 'Report',
  coin_request: 'Coins',
  coin_proof: 'Proof',
  signup: 'Joined',
  promotion: 'Campaign',
  autohide: 'Auto-hide',
};

/**
 * The list a nested page belongs to, for the seat that opened it in a fresh tab
 * or reloaded it and has no history to walk back into. A user's page is still
 * under the directory and a report case is still under the queue, so the drawer
 * row that stays lit is the door Back can point at.
 */
function parentScreen(pathname: string): Stop | null {
  const href = drawerFor(pathname);
  if (!href || href === (pathname || '/').replace(/\/$/, '')) return null;
  const crumbs = crumbsFor(pathname);
  return { href, label: crumbs[crumbs.length - 1] || 'the list' };
}

export default function ConsoleShell({
  title, subtitle, actions, children,
}: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, session, lapsed, error, verify, signOut, busy, can } = useSession();
  const bell = useBell();
  const [jump, setJump] = useState('');
  const [back, setBack] = useState<{ href: string; label: string } | null>(null);
  const [theme, setTheme] = useState('light');
  const [full, setFull] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);

  // The trail is stamped before anything below it reads, so a detail page opened
  // from a list can name that list on the same paint.
  useLayoutEffect(() => {
    visit({ href: pathname, label: title });
    setBack(cameFrom() || parentScreen(pathname));
  }, [pathname, title]);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    nav.scrollTop = navScroll;
    const remember = () => { navScroll = nav.scrollTop; };
    nav.addEventListener('scroll', remember, { passive: true });
    return () => nav.removeEventListener('scroll', remember);
  }, [status]);

  useEffect(() => {
    if (status === 'out') router.replace('/login');
  }, [status, router]);

  // A push card is drawn by the worker, which cannot navigate a window it did
  // not open — so the screen moves itself when the worker tells it where to go.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
    const wake = (event: MessageEvent) => {
      const url = event.data && event.data.url;
      if (typeof url === 'string' && url.startsWith('/')) router.push(url);
    };
    navigator.serviceWorker.addEventListener('message', wake);
    return () => navigator.serviceWorker.removeEventListener('message', wake);
  }, [router]);

  // Whoever is at the desk now owns this browser's address, so a seat that
  // signed out of one console and into another does not keep waking the person
  // who left — and a browser nobody has ever asked is asked as the console
  // opens, rather than by a seat that has to find the button on its own page.
  // Each screen also names itself to the worker, because one browser runs one
  // worker for every seat signed in on it.
  useEffect(() => {
    if (status !== 'in') return;
    const seat = () => announceSeat(session?.user.username || '');
    void autoPush().then(seat);
    seat();
    document.addEventListener('visibilitychange', seat);
    return () => document.removeEventListener('visibilitychange', seat);
  }, [status, session?.user.username]);

  // The drawer row this screen sits under, a user's page is still the directory.
  const here = drawerFor(pathname);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme || 'light');
    const tracked = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', tracked);
    return () => document.removeEventListener('fullscreenchange', tracked);
  }, []);

  // Walking into the queue is the same answer as opening the bell about it: a seat
  // who is already reading the report pile has read what was waiting there, and a
  // badge left standing over their shoulder only teaches them to ignore badges.
  // Alerts are not in that bargain — the desk they point at is usually the one this
  // seat is already sitting on, so they stay until the row itself is clicked.
  useEffect(() => {
    if (status !== 'in' || !here || !(bell.walked[here] > 0)) return;
    bell.readRoute(here);
  }, [status, here, bell.walked, bell]);

  useEffect(() => {
    if (!bell.open) return undefined;
    const away = (event: MouseEvent) => {
      if (trayRef.current && !trayRef.current.contains(event.target as Node)) bell.setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') bell.setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [bell]);

  const flipTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    // A console open at two in the morning should stay the colour it was left.
    try { localStorage.setItem('exposing-admin-theme', next); } catch { /* private window: this visit only */ }
  };

  const flipFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else document.documentElement.requestFullscreen().catch(() => undefined);
  };

  const openTray = (href: string, id: number) => {
    bell.read(id);
    bell.setOpen(false);
    router.push(href);
  };

  if (status === 'loading') {
    return (
      <div className="console">
        <aside className="side" aria-hidden="true" />
        <div className="console-main">
          <div className="console-body">
            <div className="skeleton-stack">
              <div className="skeleton skeleton-title" />
              <div className="skeleton" />
              <div className="skeleton skeleton-short" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!session) return null;

  const needed = requires(pathname);
  const blocked = !!needed && !can(needed);
  const crumb = crumbsFor(pathname);

  // Twenty-odd screens is too many to find by scrolling, and a staff member who
  // knows the word they need should not have to know where it lives.
  const want = jump.trim().toLowerCase();
  const groups = navFor(session.permissions, session.role)
    .map(group => ({ ...group, items: want
      ? group.items.filter(item => item.label.toLowerCase().includes(want)
          || item.href.includes(want) || group.label.toLowerCase().includes(want))
      : group.items }))
    .filter(group => group.items.length > 0);

  return (
    <div className="console">
      <aside className="side">
        <Link href="/" className="side-brand">
          <span className="side-brand-mark">{IC.shield}</span>
          <span>
            <b>Exposing</b>
            <em>admin console</em>
          </span>
        </Link>

        <nav className="side-nav" ref={navRef}>
          {groups.map(group => (
            <div key={group.id} className="side-group">
              <span className="side-group-label">{group.label}</span>
              {group.items.map(item => (
                <Link key={item.href} href={item.href}
                      className={`side-item ${here === item.href ? 'active' : ''}`}>
                  <span className="side-item-icon">{IC[item.icon]}</span>
                  <span className="side-item-label">{item.label}</span>
                  {bell.routes[item.href] > 0 && (
                    <span className="side-item-count" aria-label={`${bell.routes[item.href]} waiting`}>
                      {bell.routes[item.href] > 9 ? '9+' : bell.routes[item.href]}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          ))}
          {groups.length === 0 && <p className="note">No screen is called “{jump.trim()}”.</p>}
        </nav>

        <div className="side-foot">
          <div className="side-seat">
            <span className="avatar blank">{session.user.name.slice(0, 1).toUpperCase()}</span>
            <span>
              <b>{session.user.name}</b>
              <em>@{session.user.username} · {session.role}</em>
            </span>
          </div>
          <button type="button" className="side-signout" aria-label="Sign out"
                  onClick={() => signOut().then(() => router.replace('/login'))}>
            {IC.logout}<span>Sign out</span>
          </button>
        </div>
      </aside>

      <div className="console-main">
        <div className="bar">
          {back && (
            <Link
              href={back.href} className="btn ghost tiny bar-back"
              title={`Back to ${back.label}`}
            >
              {IC.chevron}<span>Back</span>
            </Link>
          )}
          <label className="bar-query">
            {IC.search}
            <input
              value={jump} onChange={event => setJump(event.target.value)}
              placeholder="Jump to a screen" aria-label="Jump to a screen"
            />
          </label>
          <span className="bar-spacer" />
          <div className="bar-tools">
            <button type="button" className="icon-btn" onClick={flipTheme}
                    aria-label={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
                    title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}>
              {theme === 'dark' ? IC.sun : IC.moon}
            </button>
            <button type="button" className="icon-btn" onClick={flipFull}
                    aria-label={full ? 'Leave full screen' : 'Show the console full screen'}
                    title={full ? 'Leave full screen (Esc in most browsers)' : 'Full screen'}>
              {full ? IC.collapse : IC.expand}
            </button>
            <div className="bell" ref={trayRef}>
              <button type="button"
                      className={`icon-btn ${bell.total > 0 ? 'armed' : ''}`}
                      aria-label={bell.total > 0 ? `${bell.total} unread notices` : 'No unread notices'}
                      aria-expanded={bell.open}
                      onClick={() => { bell.setOpen(!bell.open); if (!bell.open) bell.refresh(); }}>
                {IC.bell}
                {bell.total > 0 && (
                  <span className="bell-count">{bell.total > 99 ? '99+' : bell.total}</span>
                )}
              </button>
              {bell.open && (
                <div className="bell-tray" role="dialog" aria-label="Notices for this seat">
                  <div className="bell-tray-head">
                    <b>What arrived</b>
                    {bell.total > 0 && (
                      <button type="button" className="link" onClick={() => bell.readAll()}>Mark all read</button>
                    )}
                  </div>
                  {bell.items.length === 0 ? (
                    <p className="bell-empty">Nothing is waiting. New reports, payment proofs and alerts land here
                      as they arrive, and only for the screens your seat can open.</p>
                  ) : (
                    <ul className="bell-list">
                      {bell.items.map(item => (
                        <li key={item.id}>
                          <button type="button" className={`bell-item kind-${item.kind}`}
                                  onClick={() => openTray(item.href, item.id)}>
                            <span className="bell-item-kind">{KIND_LABEL[item.kind] || item.kind}</span>
                            <span className="bell-item-text">{item.text}</span>
                            <span className="bell-item-ago">{ago(item.age_minutes)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
          <span className="window-meter" title="This seat ends when you sign out or close the tab, not on a clock">
            {IC.lock}<span>Signed in</span>
          </span>
        </div>

        <header className="console-head">
          <p className="crumb">
            <Link href="/">Exposing</Link>
            {crumb.map((part, index) => (
              <span key={part}>{IC.chevron}<b>{part}</b></span>
            ))}
          </p>
          <div className="console-head-row">
            <div>
              <h1>{title}</h1>
              {subtitle && <p>{subtitle}</p>}
            </div>
            <div className="console-head-right">{actions}</div>
          </div>
        </header>

        <div className="console-body">
          {blocked ? (
            <section className="panel blocked">
              <span className="blocked-icon">{IC.lock}</span>
              <h2>Not on your seat</h2>
              <p>This screen needs a permission your role does not hold. A Superadmin or Admin can grant it from Staff and access.</p>
              <Link className="btn ghost" href="/me">{IC.key}See what you can open</Link>
            </section>
          ) : children}
        </div>
      </div>

      {lapsed && <CodePrompt onDone={() => undefined} verify={verify} signOut={signOut} busy={busy} error={error}/>}
    </div>
  );
}

function CodePrompt({ verify, signOut, busy, error, onDone }: {
  verify: (code: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  busy: boolean;
  error: string | null;
  onDone: () => void;
}) {
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (await verify(code.trim())) onDone();
  };

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label="Confirm your authenticator code">
      <form className="prompt" onSubmit={submit}>
        <h2>{recovery ? 'Recovery code' : 'Confirm it is still you'}</h2>
        <p>
          {recovery
            ? 'One of your ten codes. Each works once, and a spent code is gone.'
            : 'This seat was locked or its proof was dropped while the screen was open. Nothing you typed is lost, enter the code your authenticator shows.'}
        </p>
        <input
          autoFocus inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code"
          value={code} onChange={event => setCode(event.target.value)}
          placeholder={recovery ? 'XXXX-XXXX-XXXX' : '123456'} aria-label="Authenticator code"
        />
        {error && <p className="prompt-error">{error}</p>}
        <div className="prompt-actions">
          <button type="button" className="link" onClick={() => setRecovery(!recovery)}>
            {recovery ? 'Use the app code' : 'Use a recovery code'}
          </button>
          <div className="prompt-right">
            <button type="button" className="btn ghost" onClick={() => signOut()}>Sign out</button>
            <button type="submit" className="btn primary" disabled={busy || code.trim().length < 6}>
              {busy ? 'Checking…' : 'Continue'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
