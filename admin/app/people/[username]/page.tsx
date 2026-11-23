'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Banner from '@/components/Banner';
import ConsoleShell from '@/components/ConsoleShell';
import { useConfirm } from '@/components/Confirm';
import { api } from '@/lib/api';
import { num } from '@/lib/format';
import { IC } from '@/lib/icons';
import { ago, stamp } from '@/lib/time';
import { useSession } from '@/lib/session';
import { PersonDetail, PersonOutcome, PersonRow, PersonVerbs } from '@/lib/types';

type Verb = 'suspend' | 'reinstate' | 'verify' | 'warn' | 'clear_flags' | 'delete';

const PATH: Record<Verb, (username: string) => string> = {
  suspend: username => `admin/people/${username}/suspend/`,
  reinstate: username => `admin/people/${username}/reinstate/`,
  verify: username => `admin/people/${username}/verify/`,
  warn: username => `admin/people/${username}/warn/`,
  clear_flags: username => `admin/people/${username}/clear-flags/`,
  delete: username => `admin/people/${username}/delete/`,
};

const SPEC: Record<Verb, { label: string; tone: string; icon: keyof typeof IC; help: string }> = {
  suspend: {
    label: 'Suspend', tone: 'danger', icon: 'lock',
    help: 'They stop being able to sign in at their next request, lose every open session, and are emailed the reason with the Client contact details.',
  },
  reinstate: {
    label: 'Reinstate', tone: 'primary', icon: 'check',
    help: 'The bar is lifted right now and they are told in the app. Nothing else about the account changes.',
  },
  verify: {
    label: 'Verified tick', tone: 'amber', icon: 'key',
    help: 'The grey tick on their profile. Putting it on needs a reason, and it goes on the audit row.',
  },
  warn: {
    label: 'Private warning', tone: 'ghost', icon: 'chat',
    help: 'Lands in their notification bell, and their inbox unless they turned warning emails off. Always written to the record.',
  },
  clear_flags: {
    label: 'Clear spam flags', tone: 'primary', icon: 'refresh',
    help: 'Closes every open report on the account and its content and clears a sign-in lockout. It does not undo a takedown somebody decided.',
  },
  delete: {
    label: 'Delete account', tone: 'danger', icon: 'x',
    help: 'Destroys the account, their posts, comments, listings, follows, messages and wallet. Refused while anything is running or owed.',
  },
};

const ORDER: Verb[] = ['warn', 'suspend', 'reinstate', 'verify', 'clear_flags', 'delete'];

const STATE_LABEL: Record<string, string> = {
  live: 'In the feed', hidden: 'Taken down', pending: 'Waiting', removed: 'Removed',
  active: 'For sale', sold: 'Sold', expired: 'Expired', draft: 'Draft',
};

/**
 * One account, opened as a page of its own. The directory row says how big the
 * problem is; this says what the person actually did, in the order a decision
 * needs it — what they are, what they posted, what is piled on it, and only then
 * what the seat can sign.
 */
export default function PersonRecordPage({ params }: { params: { username: string } }) {
  const { status, noteGate, session } = useSession();
  const [detail, setDetail] = useState<PersonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [askFor, setAskFor] = useState<Verb | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setDetail(await api<PersonDetail>(`admin/people/${params.username}/`));
      setError(null);
    } catch (err) {
      if (!noteGate(err)) setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [noteGate, params.username]);

  useEffect(() => {
    if (status === 'in') load();
  }, [load, status]);

  // A pen clicked at the end of a directory row arrives here with the ask it
  // means, so the reason box is already open on arrival.
  useEffect(() => {
    const verb = new URLSearchParams(window.location.search).get('act');
    if (verb && verb in SPEC) setAskFor(verb as Verb);
  }, []);

  const done = (out: PersonOutcome) => {
    setBanner({ kind: 'ok', text: out.detail });
    setAskFor(null);
    if (out.action === 'delete') window.location.href = '/people';
    else load();
  };

  const person = detail?.person;
  const mine = person?.username === session?.user.username;
  // A backend that has not shipped these three lists yet answers without the key at
  // all. The count above comes from holdings, so an empty list here is named as the
  // missing list it is rather than claimed as an account that never posted.
  const feed = detail?.posts || [];
  const remarks = detail?.comments || [];
  const wares = detail?.listings || [];

  return (
    <ConsoleShell
      title={person ? `@${person.username}` : `@${params.username}`}
      subtitle={person
        ? `${person.name} · joined ${ago(person.joined)} · ${num(person.posts)} posts, ${num(person.followers)} followers`
        : 'The whole record of one account, section by section.'}
      actions={(
        <>
          <Link href="/people" className="btn ghost">{IC.chevron}<span>All accounts</span></Link>
          <button type="button" className={`btn ghost${busy ? ' spinning' : ''}`} onClick={load} title="Reload this account">
            {IC.refresh}<span>Refresh</span>
          </button>
        </>
      )}
    >
      <Banner banner={banner} />

      {!detail && !error && (
        <div className="skeleton-stack">
          <div className="skeleton"/><div className="skeleton"/><div className="skeleton skeleton-short"/>
        </div>
      )}

      {error && !detail && (
        <section className="panel empty">
          <h2>This account is not here</h2>
          <p>{error}</p>
        </section>
      )}

      {detail && person && (
        <div className="record">
          <div className="record-main">
            <Section title="Account">
              <dl className="facts">
                <div><dt>Name</dt><dd>{person.name}</dd></div>
                <div><dt>Username</dt><dd>@{person.username}</dd></div>
                <div><dt>Email</dt><dd>{person.email || '—'}</dd></div>
                <div><dt>Email verified</dt><dd>{person.email_verified ? 'Yes' : 'No'}</dd></div>
                <div><dt>Signed up</dt><dd>{stamp(person.joined)} · {person.provider_label}</dd></div>
                <div><dt>Seat</dt><dd>{person.role || 'Member'}</dd></div>
                <div><dt>Location</dt><dd>{[person.city, person.country].filter(Boolean).join(', ') || '—'}</dd></div>
                <div><dt>Private account</dt><dd>{person.is_private ? 'Yes — followers only' : 'No'}</dd></div>
                <div><dt>Warning emails</dt><dd>{person.notify_email ? 'On' : 'Off'}</dd></div>
                <div><dt>Bio</dt><dd>{person.bio || '—'}</dd></div>
              </dl>
            </Section>

            <Section title="Standing">
              <div className="person-flags">
                {person.verified && <span className="pill good">Verified tick</span>}
                {person.suspension ? (
                  <span className="pill dead" title={person.suspension.reason || undefined}>
                    {IC.lock}
                    <span>
                      {person.suspension.permanent ? 'Suspended for good' : `Suspended to ${person.suspension.until.slice(0, 10)}`}
                      {person.suspension.reason ? ` — ${person.suspension.reason}` : ''}
                    </span>
                  </span>
                ) : <span className="pill good">In good standing</span>}
                {person.locked_until && Date.parse(person.locked_until) > Date.now() && (
                  <span className="pill warn">{person.failed_attempts} failed sign-ins, locked</span>
                )}
                {!person.is_active && <span className="pill mute">Deactivated</span>}
                <span className="pill mute">
                  {person.flags.on_account + person.flags.on_content} open report(s) · {person.flags.reporters} reporter(s)
                </span>
              </div>
            </Section>

            <Section title={`Posts (${detail.holdings.posts})`}>
              {feed.length === 0 ? (
                <p className="note">
                  {detail.holdings.posts ? 'This backend does not send the post list to the console yet.' : 'This account has never posted.'}
                </p>
              ) : (
                <ul className="record-list">
                  {feed.map(item => (
                    <li key={item.id} className="record-item">
                      <span>
                        <span className="record-text">{item.text || '(no text — media only)'}</span>
                        <span className="record-meta">
                          {ago(item.created_at)} · {item.audience} · {item.likes} likes · {item.comments} comments
                        </span>
                      </span>
                      <span className={`state ${item.state === 'live' ? 'good' : 'mute'}`}>
                        {STATE_LABEL[item.state] || item.state}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {detail.holdings.posts > feed.length && feed.length > 0 && (
                <p className="fineprint">Newest {feed.length} of {detail.holdings.posts}.</p>
              )}
            </Section>

            <Section title={`Comments (${detail.holdings.comments})`}>
              {remarks.length === 0 ? (
                <p className="note">
                  {detail.holdings.comments ? 'This backend does not send the comment list to the console yet.' : 'No comments from this account.'}
                </p>
              ) : (
                <ul className="record-list">
                  {remarks.map(item => (
                    <li key={item.id} className="record-item">
                      <span>
                        <span className="record-text">{item.text}</span>
                        <span className="record-meta">on post {item.post} · {ago(item.created_at)}</span>
                      </span>
                      <span className={`state ${item.state === 'live' ? 'good' : 'mute'}`}>
                        {STATE_LABEL[item.state] || item.state}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={`Marketplace listings (${detail.holdings.listings})`}>
              {wares.length === 0 ? (
                <p className="note">
                  {detail.holdings.listings ? 'This backend does not send the listing list to the console yet.' : 'Nothing for sale.'}
                </p>
              ) : (
                <ul className="record-list">
                  {wares.map(item => (
                    <li key={item.id} className="record-item">
                      <span>
                        <span className="record-text">{item.title}</span>
                        <span className="record-meta">
                          {item.currency} {item.price} · {ago(item.created_at)}
                        </span>
                      </span>
                      <span className="state mute">{STATE_LABEL[item.state] || item.state}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="What is reported">
              {detail.reports.length === 0 && detail.content.length === 0
                ? <p className="note">Nothing is reported against this account or anything it has posted.</p>
                : (
                  <>
                    <ul className="chips">
                      {detail.content.map(item => (
                        <li key={item.target} className="chip">
                          {item.target} · {item.state}
                          {item.open > 0 ? ` · ${item.open} open (${item.reporters} reporters)` : ''}
                        </li>
                      ))}
                    </ul>
                    <ReportList reports={detail.reports}/>
                  </>
                )}
            </Section>

            <Section title="Public notices">
              {detail.notices.length === 0
                ? <p className="note">No public notice has ever been put on this account.</p>
                : (
                  <ul className="reporters">
                    {detail.notices.map(item => (
                      <li key={item.id}>
                        <b>{item.text}</b>
                        <em>{item.is_live ? 'standing' : 'withdrawn'} · on {item.target} · {ago(item.created_at)}</em>
                        {item.reason && <span className="ctext">{item.reason}</span>}
                      </li>
                    ))}
                  </ul>
                )}
            </Section>

            <Section title="Private warnings sent">
              {detail.warnings.length === 0
                ? <p className="note">No private warning on record.</p>
                : (
                  <ul className="reporters">
                    {detail.warnings.map((entry, index) => (
                      <li key={`${entry.created_at}-${index}`}>
                        <b>{entry.text}</b>
                        <em>{entry.actor ? `@${entry.actor}` : 'staff'} · {ago(entry.created_at)}</em>
                      </li>
                    ))}
                  </ul>
                )}
            </Section>

            <Section title="Wallet">
              <dl className="facts">
                <div><dt>Balance</dt><dd>{detail.holdings.balance} coins</dd></div>
                <div><dt>Running campaigns</dt><dd>{detail.holdings.campaigns}</dd></div>
                <div><dt>Payment proofs waiting</dt><dd>{detail.holdings.pending_requests}</dd></div>
              </dl>
              {detail.ledger.length === 0
                ? <p className="note">Nothing has ever moved through their wallet.</p>
                : (
                  <ul className="reporters">
                    {detail.ledger.map(move => (
                      <li key={move.id}>
                        <b>{move.kind} {move.amount}</b>
                        <em>{ago(move.created_at)}</em>
                        {move.note && <span className="ctext">{move.note}</span>}
                      </li>
                    ))}
                  </ul>
                )}
            </Section>

            <Section title="Staff record">
              {detail.audit.length === 0
                ? <p className="note">No staff decision has touched this account yet.</p>
                : (
                  <ul className="reporters">
                    {detail.audit.map(entry => (
                      <li key={entry.id}>
                        <b>{entry.action}</b>
                        <em title={stamp(entry.created_at)}>
                          {entry.actor ? `@${entry.actor}` : 'system'} · {ago(entry.created_at)}
                        </em>
                        <span className="ctext">{entry.detail}</span>
                      </li>
                    ))}
                  </ul>
                )}
            </Section>
          </div>

          <aside className="record-acts">
            <h3>Act on this account</h3>
            {!detail.can.actions && !detail.can.warn ? (
              <p className="note">
                This seat may read the directory but holds neither <b>Suspend, reinstate, verify,
                delete</b> nor <b>Private warnings to users</b>, so there is nothing to sign here.
              </p>
            ) : (
              <div className="verbs">
                {ORDER.filter(verb => {
                  if (verb === 'reinstate') return !!person.suspension;
                  if (verb === 'suspend') return !person.suspension;
                  return true;
                }).map(verb => (
                  <VerbButton
                    key={verb} verb={verb} person={person} detail={detail}
                    allowed={(verb === 'warn' ? detail.can.warn : detail.can.actions) && !mine}
                    opened={askFor === verb}
                    onDone={done} noteGate={noteGate}
                  />
                ))}
              </div>
            )}
            {mine && (
              <p className="note row">
                {IC.lock}
                <span>
                  This is the account you are signed in with. Nothing can be suspended or deleted
                  from the seat doing it, which is why the buttons are off.
                </span>
              </p>
            )}
            <p className="fineprint">
              A deletion takes {detail.holdings.posts} post(s), {detail.holdings.comments} comment(s),{' '}
              {detail.holdings.listings} listing(s) and the wallet with its ledger. It is refused while
              a campaign runs, a payment proof waits, or the balance is not zero.
            </p>
          </aside>
        </div>
      )}
    </ConsoleShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel record-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function ReportList({ reports }: { reports: PersonDetail['reports'] }) {
  if (reports.length === 0) return null;
  return (
    <ul className="reporters">
      {reports.map(report => (
        <li key={report.id}>
          <b>{report.reason}</b>
          <em>
            {report.reporter ? `@${report.reporter.username}` : 'unknown'} · {ago(report.created_at)} · {report.status}
          </em>
          {report.details && <span className="ctext">{report.details}</span>}
        </li>
      ))}
    </ul>
  );
}

function VerbButton({
  verb, person, allowed, detail, opened, onDone, noteGate,
}: {
  verb: Verb;
  person: PersonRow;
  allowed: boolean;
  detail: PersonDetail;
  opened: boolean;
  onDone: (out: PersonOutcome) => void;
  noteGate: (err: unknown) => boolean;
}) {
  const confirm = useConfirm();
  const [form, setForm] = useState(false);
  const [kind, setKind] = useState<'days' | 'until' | 'permanent'>('days');
  const [days, setDays] = useState('7');
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  const [usernameConfirm, setUsernameConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (opened) { setForm(true); setError(null); }
  }, [opened]);

  const spec = SPEC[verb];
  const label = verb === 'verify'
    ? (person.verified ? 'Take the tick off' : 'Give the verified tick')
    : spec.label;

  const needsReason = verb === 'suspend' || verb === 'clear_flags'
    || (verb === 'verify' && !person.verified) || verb === 'delete';

  const canSend = (() => {
    if (verb === 'warn') return text.trim().length > 0;
    if (verb === 'delete') return reason.trim().length > 0 && usernameConfirm.trim() === person.username;
    if (verb === 'verify') return person.verified ? true : reason.trim().length > 0;
    if (verb === 'clear_flags') return reason.trim().length > 0;
    if (verb === 'suspend') return reason.trim().length > 0
      && (kind === 'permanent' || (kind === 'days' ? Number(days) >= 1 : until.length > 0));
    return true;
  })();

  const send = async (body: Record<string, unknown>) => {
    // Nothing is signed onto an account without one more click saying what it does.
    const sure = await confirm({
      title: `${label} @${person.username}?`,
      body: verb === 'delete'
        ? `This destroys the account, its ${detail.holdings.posts} post(s), ${detail.holdings.comments} comment(s), ${detail.holdings.listings} listing(s) and its wallet. It cannot be undone.`
        : spec.help,
      confirmLabel: label,
      tone: spec.tone === 'danger' ? 'danger' : 'primary',
    });
    if (!sure) return;
    setBusy(true);
    setError(null);
    try {
      const out = await api<PersonOutcome>(PATH[verb](person.username), { method: 'POST', body });
      setForm(false);
      setReason('');
      setText('');
      setUsernameConfirm('');
      onDone(out);
    } catch (err) {
      // A lapsed admin window or an ended seat is the shell's business, not this card's error line.
      if (!noteGate(err)) setError((err as Error).message || 'That did not go through.');
    } finally {
      setBusy(false);
    }
  };

  const start = () => {
    setError(null);
    if (verb === 'reinstate') {
      send({});
      return;
    }
    setForm(!form);
  };

  const confirmAsk = () => {
    if (verb === 'suspend') {
      send(kind === 'permanent'
        ? { permanent: true, reason: reason.trim() }
        : kind === 'until'
          ? { until, reason: reason.trim() }
          : { days: Number(days), reason: reason.trim() });
      return;
    }
    if (verb === 'verify') {
      send({ verified: !person.verified, reason: reason.trim() });
      setReason('');
      return;
    }
    if (verb === 'warn') {
      send({ text: text.trim(), reason: reason.trim() });
      setText('');
      setReason('');
      return;
    }
    if (verb === 'clear_flags') {
      send({ reason: reason.trim() });
      setReason('');
      return;
    }
    if (verb === 'delete') {
      send({ reason: reason.trim(), confirm: usernameConfirm.trim() });
    }
  };

  return (
    <>
      <button
        type="button" data-verb={verb}
        className={`btn ${spec.tone} tiny`}
        disabled={busy || !allowed}
        title={allowed ? spec.help : `This seat does not hold ${verb === 'warn' ? 'Private warnings to users' : 'Suspend, reinstate, verify, delete'}`}
        onClick={start}
      >
        {IC[spec.icon]}
        <span>{busy && !form ? 'Working…' : label}</span>
      </button>

      {form && (
        <div className="ask">
          <p className="note row">{IC.alert}<span>{spec.help}</span></p>

          {verb === 'suspend' && (
            <div className="suspend-kind">
              <label className="field">
                <span>For how long</span>
                <select value={kind} onChange={event => setKind(event.target.value as typeof kind)}>
                  <option value="days">A number of days</option>
                  <option value="until">Until a date</option>
                  <option value="permanent">Permanently, until staff put it back</option>
                </select>
              </label>
              {kind === 'days' && (
                <label className="field">
                  <span>Days</span>
                  <input
                    type="number" min={1} max={3650} value={days}
                    onChange={event => setDays(event.target.value)} aria-label="Days of suspension"
                  />
                </label>
              )}
              {kind === 'until' && (
                <label className="field">
                  <span>Ends on</span>
                  <input type="date" value={until} onChange={event => setUntil(event.target.value)} aria-label="Suspension end date"/>
                </label>
              )}
              {kind === 'permanent' && (
                <p className="fineprint">
                  A permanent bar is the same column set far ahead, so only a reinstate lifts it.
                  The account keeps everything it has — suspending is not deleting.
                </p>
              )}
            </div>
          )}

          {verb === 'warn' && (
            <label className="field">
              <span>The warning they read</span>
              <textarea
                rows={3} name="warn_text" value={text} maxLength={240} autoFocus
                placeholder="e.g. Third harassment report. Do not post other people's photographs."
                onChange={event => setText(event.target.value)}
              />
            </label>
          )}

          {verb === 'delete' && (
            <label className="field">
              <span>Type the username to confirm</span>
              <input
                value={usernameConfirm} onChange={event => setUsernameConfirm(event.target.value)}
                placeholder={person.username} autoComplete="off" aria-label="Type the username to confirm"
              />
            </label>
          )}

          {verb !== 'warn' && (
            <label className="field">
              <span>Reason {needsReason ? '— required, and kept on the record' : '(optional)'}</span>
              <textarea
                rows={2} name="reason" value={reason} maxLength={500}
                placeholder={verb === 'verify' && !person.verified
                  ? 'What made this account worth a tick'
                  : 'The sentence the audit row keeps'}
                onChange={event => setReason(event.target.value)}
              />
            </label>
          )}

          {verb === 'warn' && (
            <label className="field">
              <span>Reason (optional — written next to the warning)</span>
              <textarea rows={1} name="reason" value={reason} maxLength={240} onChange={event => setReason(event.target.value)}/>
            </label>
          )}

          <div className="ask-actions">
            <button type="button" className={`btn ${spec.tone} tiny`} disabled={busy || !canSend} onClick={confirmAsk}>
              {IC.go}<span>{busy ? 'Working…' : `Confirm — ${label}`}</span>
            </button>
            <button type="button" className="btn ghost tiny" disabled={busy} onClick={() => setForm(false)}>
              <span>Cancel</span>
            </button>
          </div>

          {error && <p className="card-error" role="status">{IC.alert}<span>{error}</span></p>}
        </div>
      )}
    </>
  );
}
