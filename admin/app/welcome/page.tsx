'use client';

import { useCallback, useEffect, useState } from 'react';
import Banner from '@/components/Banner';
import ConsoleShell from '@/components/ConsoleShell';
import { useConfirm } from '@/components/Confirm';
import { api } from '@/lib/api';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/time';
import { useSession } from '@/lib/session';
import { WelcomeDesk, WelcomeLine } from '@/lib/types';

const ADDRESS = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const LINK = /^https?:\/\/[^\s@]+\.[^\s@]{2,}$/i;
// The boxes that steer where the platform's own letters go. They are written
// beside the mail status rather than among the sentences a visitor reads.
const MAIL_FIELDS = ['report_inbox', 'request_inbox', 'console_url'];
const MAIL_PLACEHOLDERS: Record<string, string> = {
  report_inbox: 'complaints@example.com',
  request_inbox: 'payments@example.com',
  console_url: 'https://admin.exposing.app',
};

export default function WelcomePage() {
  const { noteGate } = useSession();
  const confirm = useConfirm();
  const [desk, setDesk] = useState<WelcomeDesk | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

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
  const mailOf = (field: string) => draft[field] ?? line(field)?.value ?? '';
  // A mail setting is not a sentence a visitor reads, so it stays out of the
  // wording save and is written on its own from the mail panel.
  const mailLines = desk?.lines.filter(item => MAIL_FIELDS.includes(item.field)) ?? [];
  const editable = desk?.lines.filter(item => !MAIL_FIELDS.includes(item.field)) ?? [];
  const dirty = !!desk && editable.some(item => (draft[item.field] ?? item.value) !== item.value);
  const mailDirty = mailLines.some(item => mailOf(item.field).trim() !== (item.value ?? ''));

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

  const saveMail = async () => {
    const address = mailOf('report_inbox').trim();
    if (address && !ADDRESS.test(address)) {
      setBanner({ kind: 'bad', text: 'Write a whole email address, or leave the complaints box empty to keep reports inside the console.' });
      return;
    }
    const requests = mailOf('request_inbox').trim();
    if (requests && !ADDRESS.test(requests)) {
      setBanner({ kind: 'bad', text: 'The requests inbox needs a whole email address, or leave it empty and a coin or promotion order goes to the complaints inbox.' });
      return;
    }
    const door = mailOf('console_url').trim();
    if (door && !LINK.test(door)) {
      setBanner({ kind: 'bad', text: 'The console address needs the whole link, starting with https://, or leave it empty and staff letters point at the member site.' });
      return;
    }
    const moved = mailLines.filter(item => mailOf(item.field).trim() !== (item.value ?? ''));
    const sure = await confirm({
      title: moved.length === 1 ? `Change the ${moved[0].label.toLowerCase()}?` : 'Change where the console posts?',
      body: 'These decide where the platform letters go: complaints are copied to the inbox as '
        + 'they arrive, a coin purchase and a promotion order are mailed to the requests inbox the '
        + 'moment a member files them, and a new staff seat is mailed its sign-in, its password and '
        + 'the link it opens. All of them take effect on the next letter the platform posts.',
      confirmLabel: 'Save the mail settings',
      tone: 'amber',
    });
    if (!sure) return;
    setBusy(true);
    setBanner(null);
    try {
      const body: Record<string, string> = {};
      mailLines.forEach(item => { body[item.field] = mailOf(item.field).trim(); });
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
                  A coin receipt, a promotion decision, a warning, a complaint, a new staff seat and
                  a first letter are each also an email. This is what those letters pass through, and
                  where the platform's own copies are told to go, read off the server rather than
                  guessed from an inbox that stays quiet.
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

            {mailLines.length > 0 && (
              <>
                {mailLines.map(item => (
                  <label className="field" data-mail={item.field} key={item.field}>
                    <span>
                      {item.label}{' '}
                      <em>{mailOf(item.field).length}/{item.limit}</em>
                    </span>
                    <input
                      name={item.field}
                      type={item.field.endsWith('inbox') ? 'email' : 'text'}
                      maxLength={item.limit} autoComplete="off" spellCheck={false}
                      value={mailOf(item.field)}
                      placeholder={MAIL_PLACEHOLDERS[item.field] || item.default}
                      onChange={event => setDraft({ ...draft, [item.field]: event.target.value })}
                    />
                    <em className="welcome-who">
                      {item.set
                        ? <>written by <b>{item.by}</b> {ago(item.at || '')}, {item.help}</>
                        : <>still the platform’s own value and never written here — {item.help.toLowerCase()}</>}
                    </em>
                  </label>
                ))}

                <div className="ask-actions">
                  <button
                    type="button" className={`btn primary${busy ? ' spinning' : ''}`}
                    disabled={busy || !mailDirty}
                    title={mailDirty ? 'Write where these letters go' : 'Nothing has changed yet'}
                    onClick={saveMail}
                  >
                    {IC.check}<span>{busy ? 'Working…' : 'Save the mail settings'}</span>
                  </button>
                  {mailDirty && (
                    <button
                      type="button" className="btn ghost" disabled={busy}
                      onClick={() => setDraft(current => {
                        const next = { ...current };
                        MAIL_FIELDS.forEach(field => { delete next[field]; });
                        return next;
                      })}
                    >
                      <span>Undo my typing</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </ConsoleShell>
  );
}
