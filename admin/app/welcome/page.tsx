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
  const dirty = !!desk && desk.lines.some(item => (draft[item.field] ?? item.value) !== item.value);

  const save = async () => {
    if (!desk) return;
    const moved = desk.lines.filter(item => (draft[item.field] ?? item.value) !== item.value);
    const sure = await confirm({
      title: `Save the first-load wording${moved.length ? ` (${moved.length} line(s) changed)` : ''}?`,
      body: 'This is what every visitor reads before they have an account, and the numbers in it are the only way a stranger can reach the person running the site. It goes live on the next page load.',
      confirmLabel: 'Save the wording',
      tone: 'amber',
    });
    if (!sure) return;
    const body: Record<string, string> = {};
    desk.lines.forEach(item => { body[item.field] = valueOf(item.field).trim(); });
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

  const card = desk?.card;

  return (
    <ConsoleShell
      title="First-load wording"
      subtitle="The sentence, the tagline and the contact details a visitor reads the first time the site loads — before they have an account, so this is the only place they get written."
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

            {desk.lines.map(item => (
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
                    ? <>written by <b>{item.by}</b> {ago(item.at || '')} — {item.help}</>
                    : <>the platform’s own line, still unwritten — {item.help}</>}
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
                  This is what <b>GET /api/welcome/</b> hands the website, with nobody signed in —
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
        </div>
      )}
    </ConsoleShell>
  );
}
