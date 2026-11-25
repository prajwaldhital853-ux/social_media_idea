'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import ConsoleShell from '@/components/ConsoleShell';
import { IC } from '@/lib/icons';
import { ago, stamp } from '@/lib/time';
import { useSession } from '@/lib/session';
import { PermissionEntry } from '@/lib/types';

const ROLE_TEXT: Record<string, string> = {
  superadmin: 'The Client seat. Every screen, and the only role that can appoint or remove an Admin.',
  admin: 'Every staff screen, settings, users, the roster, Coin Requests, Coin and Promotion settings, but roster changes stop at Moderator level.',
  moderator: 'Reports, content, listings, warning notices and user actions. Coins, payments and every staff screen appear only when they are granted.',
};

export default function MePage() {
  const { session, can, signOut } = useSession();
  const router = useRouter();

  const groups = useMemo(() => {
    const entries = session?.permission_keys || [];
    const ordered: { label: string; items: PermissionEntry[] }[] = [];
    entries.forEach(entry => {
      const label = entry.group_label || entry.group;
      const bucket = ordered.find(candidate => candidate.label === label);
      if (bucket) bucket.items.push(entry);
      else ordered.push({ label, items: [entry] });
    });
    return ordered;
  }, [session]);

  // No early return while the seat is missing: the shell is what notices the
  // session has ended and walks the person back to the door.

  return (
    <ConsoleShell
      title="My seat"
      subtitle="What this account is, how it unlocks, and exactly which screens it can open."
    >
      {!session ? null : (
      <div className="me-grid">
        <section className="panel">
          <h2>Who is at the desk</h2>
          <dl className="facts">
            <div><dt>Name</dt><dd>{session.user.name}</dd></div>
            <div><dt>Username</dt><dd>@{session.user.username}</dd></div>
            <div><dt>Email</dt><dd>{session.user.email || '-'}</dd></div>
            <div>
              <dt>Role</dt>
              <dd><span className={`role-chip role-${session.role}`}>{session.role}</span></dd>
            </div>
          </dl>
          <p className="note">{ROLE_TEXT[session.role] || ROLE_TEXT.moderator}</p>
          {can('staff_view') && (
            <Link className="btn ghost" href="/access">{IC.users}<span>Staff and access</span></Link>
          )}
        </section>

        <section className="panel">
          <h2>Second factor</h2>
          <dl className="facts">
            <div>
              <dt>Authenticator</dt>
              <dd>{session.enrolled
                ? <span className="pill good">{IC.key}<span>Enrolled</span></span>
                : <span className="pill warn">{IC.alert}<span>Not set up</span></span>}</dd>
            </div>
            <div><dt>Recovery codes left</dt><dd>{session.recovery_left}</dd></div>
            <div><dt>Last admin sign-in</dt><dd>{stamp(session.last_admin_login_at || null)}</dd></div>
            <div><dt>That was</dt><dd>{ago(session.last_admin_login_at || null)}</dd></div>
          </dl>

          <p className="note">
            This seat has no clock on it. It ends when you sign out below, or when this tab or the
            machine closes, not while you are working. Nothing you were typing is thrown away if the
            browser is restarted: the code box opens again, you confirm, and the screen carries on.
            If the phone is gone, one recovery code gets you back in.
          </p>
          <button
            type="button" className="btn danger outline"
            onClick={() => signOut().then(() => router.replace('/login'))}
          >
            {IC.logout}<span>Sign out of the console</span>
          </button>
        </section>

        <section className="panel wide">
          <h2>Screens this seat opens <em>{session.permissions.length}</em></h2>
          {groups.length === 0 ? (
            <p className="note">Nothing yet, a Superadmin or Admin has to grant screens to this seat.</p>
          ) : (
            <div className="me-groups">
              {groups.map(group => (
                <div key={group.label} className="me-group">
                  <h3>{group.label}</h3>
                  <div className="key-list">
                    {group.items.map(entry => (
                      <span key={entry.key} className="key on" title={entry.key}>{IC.check}<span>{entry.label}</span></span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="note">
            Your own role and screens are changed by another staff account, from Staff and access ,
            deliberately, so a wrong click cannot shut the door you are standing in.
          </p>
        </section>
      </div>
      )}
    </ConsoleShell>
  );
}
