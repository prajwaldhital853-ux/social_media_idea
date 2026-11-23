'use client';

import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { crumbsFor, navFor, requires } from '@/lib/nav';
import { IC } from '@/lib/icons';
import { left } from '@/lib/time';
import { useSession } from '@/lib/session';

// Every screen renders its own shell, so switching screens rebuilds this drawer
// from nothing. A moderator working down a long list would lose their place on
// every click, so the offset outlives the element that was scrolled.
let navScroll = 0;

export default function ConsoleShell({
  title, subtitle, actions, children,
}: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, session, lapsed, error, verify, signOut, busy, can } = useSession();
  const [tick, setTick] = useState(0);
  const [jump, setJump] = useState('');
  const navRef = useRef<HTMLElement>(null);

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

  // The window closes on its own; the top bar counts it down so nobody is
  // surprised mid-task, and the minute it empties the prompt opens by itself.
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 15000);
    return () => clearInterval(id);
  }, []);

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
  void tick;

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
                      className={`side-item ${pathname === item.href ? 'active' : ''}`}>
                  <span className="side-item-icon">{IC[item.icon]}</span>
                  <span className="side-item-label">{item.label}</span>
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
          <button type="button" className="side-signout" onClick={() => signOut().then(() => router.replace('/login'))}>
            {IC.logout}<span>Sign out</span>
          </button>
        </div>
      </aside>

      <div className="console-main">
        <div className="bar">
          <label className="bar-query">
            {IC.search}
            <input
              value={jump} onChange={event => setJump(event.target.value)}
              placeholder="Jump to a screen" aria-label="Jump to a screen"
            />
          </label>
          <span className="bar-spacer" />
          <span className="window-meter" title="Your second factor is good for 30 minutes">
            {IC.lock}<span>{left(session.admin_expires_at)}</span>
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
            : 'Your 30-minute admin window closed. Nothing you typed is lost — enter the code your authenticator shows.'}
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
