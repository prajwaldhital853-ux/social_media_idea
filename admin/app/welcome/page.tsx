'use client';

import { useCallback, useEffect, useState } from 'react';
import Banner from '@/components/Banner';
import ConsoleShell from '@/components/ConsoleShell';
import { useConfirm } from '@/components/Confirm';
import { api } from '@/lib/api';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/time';
import { useSession } from '@/lib/session';
import { WelcomeDesk, WelcomeLine, WelcomeMail } from '@/lib/types';

const ADDRESS = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function WelcomePage() {
  const { noteGate } = useSession();
  const confirm = useConfirm();
  const [desk, setDesk] = useState<WelcomeDesk | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [to, setTo] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      setDesk(await api<WelcomeDesk>('admin/welcome/'));
    } catch (err) {
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    }
  }, [noteGate]);

  useEffect(() => {
    load();
  }, [load]);

  const line = (field: string): WelcomeLine | undefined => desk?.lines.find(item => item.field === field);
  const valueOf = (field: string) => draft[field] ?? line(field)?.value ?? '';
  const inbox = line('report_inbox');
  // The inbox is a mail setting, not a sentence a visitor reads, so it is written
  // on its own and stays out of the wording save.
  const editable = desk?.lines.filter(item => item.field !== 'report_inbox') ?? [];
  const dirty = !!desk && editable.some(item => (draft[item.field] ?? item.value) !== item.value);
  const inboxDraft = draft.report_inbox ?? inbox?.value ?? '';
  const inboxDirty = !!inbox && inboxDraft.trim() !== (inbox.value ?? '');

  const save = async () => {
    if (!desk) return;
    const moved = editable.filter(item => (draft[item.field] ?? item.value) !== item.value);
    const sure = await confirm({
      title: `Save the first-load wording${moved.length ? ` (${moved.length} line(s) changed)` : ''}?`,
      body: 'This is what every visitor reads before they have an account, and the numbers in it are the only way a stranger can reach the person running the site. It goes live on the next page load.',
      confirmLabel: 'Save the wording',
      tone: 'amber',
    });
    if (!sure) return;
    const body: Record<string, string> = {};
    editable.forEach(item => { body[item.field] = valueOf(item.field).trim(); });
    setBusy(true);
    setBanner(null);
    try {
      const out = await api<WelcomeDesk>('admin/welcome/', { method: 'POST', body });
      setDesk(out);
      setDraft({});
      setBanner({ kind: 'ok', text: out.detail || 'Saved.' });
    } catch (err) {
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    const address = to.trim().toLowerCase();
    if (!ADDRESS.test(address)) {
      setBanner({ kind: 'bad', text: 'Write the address the test letter goes to.' });
      return;
    }
    setSending(true);
    setBanner(null);
    try {
      const out = await api<{ detail: string; mail?: WelcomeMail }>('admin/welcome/mail-test/', {
        method: 'POST', body: { to: address },
      });
      if (out.mail) setDesk(current => (current ? { ...current, mail: out.mail } : current));
      setBanner({ kind: 'ok', text: out.detail });
    } catch (err) {
      // A refused letter is the answer this button exists for, so it is shown whole.
      setBanner({ kind: 'bad', text: (err as Error).message });
    } finally {
      setSending(false);
    }
  };

  const saveInbox = async () => {
    const address = inboxDraft.trim();
    if (address && !ADDRESS.test(address)) {
      setBanner({ kind: 'bad', text: 'Write a whole email address, or leave the box empty to keep complaints inside the console.' });
      return;
    }
    const sure = await confirm({
      title: address ? 'Move the complaints inbox?' : 'Close the complaints inbox?',
      body: address
        ? `Every report a member files is copied to ${address} as it arrives, with the reporter, the thing reported and their words. Nobody else is told the address.`
        : 'Reports stop being emailed and are only visible in the console review queue.',
      confirmLabel: address ? 'Save the inbox' : 'Stop the copies',
      tone: 'amber',
    });
    if (!sure) return;
    setBusy(true);
    setBanner(null);
    try {
      const out = await api<WelcomeDesk>('admin/welcome/', { method: 'POST', body: { report_inbox: address } });
      setDesk(out);
      setDraft({});
      setBanner({ kind: 'ok', text: out.detail || 'Saved.' });
    } catch (err) {
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const card = desk?.card;

  return (
    <ConsoleShell
      title="First-load wording"
      subtitle="The sentence, the tagline and the contact details a visitor reads the first time the site loads, before they have an account, so this is the only place they get written."
      actions={(
        <button type="button" className={`btn ghost${busy ? ' spinning' : ''}`} onClick={() => load()} title="Reload the wording">
          {IC.refresh}<span>Refresh</span>
        </button>
      )}
    >
      <Banner banner={banner} />

      {!desk ? (
        <div className="skeleton-stack">
          <div className="skeleton"/><div className="skeleton"/><div className="skeleton skeleton-short"/>
        </div>
      ) : (
        <div className="policy-grid">
          <section className="panel" data-welcome="editor">
            <div className="panel-head">
              <div>
                <h2>What the visitor is told</h2>
                <p>
                  Every line is written by the Client. Left empty, it falls back to the platform’s own
                  wording rather than showing a card with nothing on it.
                </p>
              </div>
            </div>

            {editable.map(item => (
              <label className="field" key={item.field} data-line={item.field}>
                <span>
                  {item.label}{' '}
                  <em>{(valueOf(item.field) || '').length}/{item.limit}</em>
                </span>
                {item.field === 'message' ? (
                  <textarea
                    name={item.field} rows={3} maxLength={item.limit}
                    value={valueOf(item.field)}
                    placeholder={item.default}
                    onChange={event => setDraft({ ...draft, [item.field]: event.target.value })}
                  />
                ) : (
                  <input
                    name={item.field} maxLength={item.limit} autoComplete="off"
                    value={valueOf(item.field)}
                    placeholder={item.default}
                    onChange={event => setDraft({ ...draft, [item.field]: event.target.value })}
                  />
                )}
                <em className="welcome-who">
                  {item.set
                    ? <>written by <b>{item.by}</b> {ago(item.at || '')}, {item.help}</>
                    : <>the platform’s own line, still unwritten, {item.help}</>}
                </em>
              </label>
            ))}

            <div className="ask-actions">
              <button
                type="button" className="btn primary" disabled={busy || !dirty} onClick={save}
                title={dirty ? 'Write these lines to the platform' : 'Nothing has changed yet'}
              >
                {IC.check}<span>{busy ? 'Working…' : 'Save the wording'}</span>
              </button>
              {dirty && (
                <button type="button" className="btn ghost" disabled={busy} onClick={() => setDraft({})}>
                  <span>Undo my typing</span>
                </button>
              )}
            </div>
          </section>

          <section className="panel" data-welcome="card">
            <div className="panel-head">
              <div>
                <h2>The card as it is read</h2>
                <p>
                  This is what <b>GET /api/welcome/</b> hands the website, with nobody signed in ,
                  the card appears on the first load and then never again.
                </p>
              </div>
            </div>

            <div className="verdict">
              <p className="notice-text">{card?.message}</p>
              <p className="note">{card?.tagline}</p>
              {card && card.contact.length > 0 ? (
                <ul className="terms">
                  {card.contact.map(entry => (
                    <li className="term" key={entry.label}>
                      <div className="term-body">
                        <b className="term-text">{entry.label}</b>
                        <em className="term-note">{entry.value}</em>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-note">{IC.x}<span>No contact details filled in yet.</span></p>
              )}
            </div>

            <p className="note row">
              {IC.alert}
              <span>
                The Client has seven days from the Agreement Date to send the wording. Until it
                arrives the platform’s own lines stand, and every save here is written to the audit
                log with who changed which line and when.
              </span>
            </p>
          </section>

          <section className="panel" data-welcome="mail">
            <div className="panel-head">
              <div>
                <h2>Mail as this deployment can send it</h2>
                <p>
                  A coin receipt, a promotion decision, a warning, a complaint and a first letter are
                  each also an email. This is what those letters pass through, read off the server
                  rather than guessed from an inbox that stays quiet.
                </p>
              </div>
            </div>

            <ul className="terms">
              {[
                ['Provider', desk.mail?.provider || 'reading…'],
                ['Sent from', desk.mail?.sender || 'reading…'],
                ['Replies go to', desk.mail?.reply_to || 'not filled in'],
                ['Links point at', desk.mail?.site || 'reading…'],
                ['Posting', desk.mail
                  ? (desk.mail.dispatch === 'queue'
                    ? 'handed to the Celery queue'
                    : 'on its own thread, after the request returns')
                  : 'reading…'],
              ].map(([label, value]) => (
                <li className="term" key={label}>
                  <div className="term-body">
                    <b className="term-text">{label}</b>
                    <em className="term-note">{value}</em>
                  </div>
                </li>
              ))}
            </ul>

            {desk.mail?.problem && (
              <div className="notice-line">
                <p className="notice-copy"><span className="notice-text">{desk.mail.problem}</span></p>
              </div>
            )}

            {inbox && (
              <>
                <label className="field" data-mail="inbox">
                  <span>
                    {inbox.label}{' '}
                    <em>{inboxDraft.length}/{inbox.limit}</em>
                  </span>
                  <input
                    name="report_inbox" type="email" maxLength={inbox.limit} autoComplete="off"
                    value={inboxDraft}
                    placeholder="complaints@example.com"
                    onChange={event => setDraft({ ...draft, report_inbox: event.target.value })}
                  />
                  <em className="welcome-who">
                    {inbox.set
                      ? <>written by <b>{inbox.by}</b> {ago(inbox.at || '')}, {inbox.help}</>
                      : <>never written, so nothing is mailed — {inbox.help.toLowerCase()}</>}
                  </em>
                </label>

                <div className="ask-actions">
                  <button
                    type="button" className={`btn primary${busy ? ' spinning' : ''}`}
                    disabled={busy || !inboxDirty}
                    title={inboxDirty ? 'Write the complaints inbox' : 'The address has not changed'}
                    onClick={saveInbox}
                  >
                    {IC.check}<span>{busy ? 'Working…' : 'Save the inbox'}</span>
                  </button>
                  {inboxDirty && (
                    <button
                      type="button" className="btn ghost" disabled={busy}
                      onClick={() => setDraft(current => {
                        const next = { ...current };
                        delete next.report_inbox;
                        return next;
                      })}
                    >
                      <span>Undo my typing</span>
                    </button>
                  )}
                </div>
              </>
            )}

            <label className="field" data-mail="to">
              <span>Send a test letter to</span>
              <input
                name="mailtest" value={to} autoComplete="off" placeholder="you@example.com"
                onChange={event => setTo(event.target.value)}
              />
              <em className="welcome-who">
                It is posted through the provider named above and comes back with that
                provider’s own answer, so the check takes a few seconds and proves more than this
                screen can.
              </em>
            </label>

            <div className="ask-actions">
              <button
                type="button" className={`btn primary${sending ? ' spinning' : ''}`}
                disabled={sending || !ADDRESS.test(to.trim().toLowerCase())}
                title={ADDRESS.test(to.trim().toLowerCase())
                  ? 'Post one real letter and report the answer'
                  : 'An address first'}
                onClick={sendTest}
              >
                {IC.check}<span>{sending ? 'Sending…' : 'Send the test letter'}</span>
              </button>
            </div>
          </section>
        </div>
      )}
    </ConsoleShell>
  );
}
