'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Banner from '@/components/Banner';
import ConsoleShell from '@/components/ConsoleShell';
import { useConfirm } from '@/components/Confirm';
import { api } from '@/lib/api';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/time';
import { useSession } from '@/lib/session';
import { SettingLine, SpamConfig, SpamDesk } from '@/lib/types';

/**
 * Contract 6.9, the spam desk. How often one person may act, what an account a day
 * old is not allowed to do yet, which links a post may not carry, and how many
 * people have to say a post is bad before the platform takes it out of the feed
 * without waiting for a person.
 *
 * Every number on this desk is read again by the door that answers the request, so
 * a save moves the site within one request rather than at the next deploy. The
 * answer that door gives is printed beside the boxes, because a limit nobody reads
 * is a number in a screen, and a save banner that promises enforcement is how a
 * seat ends up believing a rule that no view ever checks.
 */

/** What the desk means by a knob being live: the door refuses on this number now. */
const ENFORCED_NOTE = 'the site refuses this at its own door';

export default function SpamScreen() {
  const { noteGate } = useSession();
  const confirm = useConfirm();
  const [desk, setDesk] = useState<SpamDesk | null>(null);
  const [quote, setQuote] = useState<SpamConfig | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [back, open] = await Promise.all([
        api<SpamDesk>('admin/spam/'),
        api<SpamConfig>('spam/config/').catch(() => null),
      ]);
      setDesk(back);
      setQuote(open);
    } catch (err) {
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    }
  }, [noteGate]);

  useEffect(() => {
    load();
  }, [load]);

  const lines = (desk?.blocks || []).reduce((all, block) => [...all, ...block.lines], [] as SettingLine[]);
  const baseOf = (item: SettingLine) => (item.type === 'bool' ? (item.value ? '1' : '') : String(item.value ?? ''));
  const valueOf = (item: SettingLine) => draft[item.key] ?? baseOf(item);
  // Only what moved is posted, so the audit row names the two rules a seat turned
  // instead of every rule the desk happened to have open.
  const touched = lines.filter(item => valueOf(item) !== baseOf(item));
  const dirty = touched.length > 0;
  const held = (key: string) => lines.find(item => item.key === key);

  const save = async () => {
    const sure = await confirm({
      title: `Save ${touched.length} spam control(s)?`,
      body: 'These take effect on the next request, not on a restart: whatever is typed here is what the site hides, rate-limits or refuses from now on, including for people already posting this minute.',
      confirmLabel: 'Save and enforce',
      tone: 'amber',
    });
    if (!sure) return;
    setBusy(true);
    setBanner(null);
    try {
      const body = touched.reduce((all, item) => ({ ...all, [item.key]: valueOf(item) }), {} as Record<string, string>);
      const out = await api<{ detail: string; changed: string[]; config: SpamConfig }>('admin/spam/', { method: 'POST', body });
      setBanner({ kind: 'ok', text: out.detail });
      setDraft({});
      // Read the desk and the open door back rather than guessing what they now say:
      // this screen's whole promise is that the answer a stranger gets is the number
      // that was typed here.
      const [again, open] = await Promise.all([
        api<SpamDesk>('admin/spam/'),
        api<SpamConfig>('spam/config/').catch(() => null),
      ]);
      setDesk(again);
      setQuote(open);
    } catch (err) {
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const auto = held('spam_autohide');
  const pulling = !!auto && valueOf(auto) === '1';

  return (
    <ConsoleShell
      title="Spam and auto-hide rules"
      subtitle="How often one account may act, what a new account may not do yet, which links a post may not carry, and how many reporters pull a post out of the feed before anybody reads it, every one of them a rule you can turn without a deploy."
      actions={(
        <button
          type="button" className={`btn ghost${busy ? ' spinning' : ''}`}
          onClick={() => { load(); setDraft({}); }} title="Reload the desk"
        >
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
          <section className="panel" data-spam="rules">
            <div className="panel-head">
              <div>
                <h2>The rules</h2>
                <p>
                  A ceiling of zero switches the rule off rather than blocking everything, so the boxes
                  say what they mean. Every one of these is answered where the request is made: a post
                  past its ceiling, a comment past its own or a post carrying a blocked link is refused
                  on the way in, and a pile of reporters reaches the number set here without waiting for
                  a person.
                </p>
              </div>
            </div>

            {desk.blocks.map(block => (
              <div className="algo-block" data-block={block.id} key={block.id}>
                <h3 className="desk-sub">{block.label}</h3>
                <div className="desk-grid">
                  {block.lines.map(item => (item.type === 'bool' ? (
                    <div className="field algo-switch" data-knob={item.key} key={item.key}>
                      <span>{item.label}</span>
                      <div className="moves" role="group" aria-label={item.label}>
                        {[['1', 'On'], ['', 'Off']].map(([value, label]) => (
                          <button
                            key={value || 'off'} type="button" data-switch={value || 'off'}
                            className={`fchip${valueOf(item) === value ? ' on' : ''}`}
                            aria-pressed={valueOf(item) === value} disabled={busy}
                            onClick={() => setDraft({ ...draft, [item.key]: value })}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <p className="desk-plain">{item.help}</p>
                      <em className="desk-who">
                        {item.set
                          ? <>turned by <b>{item.by}</b> {ago(item.at || '')}</>
                          : <>never moved from the platform’s own answer</>}
                      </em>
                    </div>
                  ) : (
                    <label className="field" data-knob={item.key} key={item.key}>
                      <span>{item.label}</span>
                      <input
                        name={item.key} value={valueOf(item)} autoComplete="off" maxLength={8}
                        inputMode="numeric" placeholder={String(item.default)}
                        data-enforced={item.enforced ? '1' : undefined}
                        onChange={event => setDraft({ ...draft, [item.key]: event.target.value.replace(/[^\d]/g, '') })}
                      />
                      <p className="desk-plain">{item.help}</p>
                      <em className="desk-who">
                        {item.set
                          ? <>written by <b>{item.by}</b> {ago(item.at || '')}</>
                          : <>the number the site was built with, still untouched</>}
                        {item.enforced && <b className="desk-live">, {ENFORCED_NOTE}</b>}
                      </em>
                    </label>
                  )))}
                </div>
              </div>
            ))}

            {!pulling && (
              <p className="note row" data-autohide-off>
                {IC.alert}
                <span>
                  <b>Auto-hide is off.</b> Nothing is pulled out of the feed on report counts any more ,
                  every report waits for a person in the review queue, and a pile of {desk.threshold}{' '}
                  reporters on one post sits there unread until somebody opens it.
                </span>
              </p>
            )}

            <div className="ask-actions">
              <button
                type="button" className="btn primary" data-spam-save
                disabled={busy || !dirty} onClick={save}
                title={dirty ? 'Write these to the platform' : 'Nothing has changed yet'}
              >
                {IC.check}<span>{busy ? 'Working…' : 'Save the rules'}</span>
              </button>
              {dirty && (
                <button type="button" className="btn ghost" disabled={busy} onClick={() => setDraft({})}>
                  <span>Undo my typing</span>
                </button>
              )}
            </div>
          </section>

          <section className="panel" data-spam="live">
            <div className="panel-head">
              <div>
                <h2>What the site is told</h2>
                <p>
                  This is the answer <b>GET /api/spam/config/</b> gives with nobody signed in, the rules a
                  member’s request is measured against the next time the site reads them.
                </p>
              </div>
            </div>

            {quote ? (
              <ul className="terms" data-live-config>
                <li className="term" data-live="auto_hide">
                  <div className="term-body">
                    <b className="term-text">Content pulled on reports alone</b>
                    <em className="term-note">
                      {quote.auto_hide.enabled
                        ? <>on <b>{quote.auto_hide.reports}</b> distinct reporters</>
                        : 'off, every report waits for a person'}
                    </em>
                  </div>
                </li>
                <li className="term" data-live="new_account">
                  <div className="term-body">
                    <b className="term-text">A new account</b>
                    <em className="term-note">
                      {quote.new_account.hold_hours
                        ? <>waits {quote.new_account.hold_hours} h before it may post</>
                        : 'may post the moment it signs up'}
                      {quote.new_account.posts_per_day
                        ? <> and gets {quote.new_account.posts_per_day} posts in its first day</>
                        : ', then posts as freely as anybody else'}
                      {quote.new_account.verify_first ? ', and must verify its email first' : ''}
                    </em>
                  </div>
                </li>
                <li className="term" data-live="link_block">
                  <div className="term-body">
                    <b className="term-text">Blocked links are refused</b>
                    <em className="term-note">
                      {quote.link_block
                        ? <>yes, {quote.blocked_links.length} domain{quote.blocked_links.length === 1 ? '' : 's'} on the list</>
                        : 'no, the list is kept but a post is not stopped by it'}
                    </em>
                  </div>
                </li>
                <li className="term" data-live="words">
                  <div className="term-body">
                    <b className="term-text">Blocked words the site scans for</b>
                    <em className="term-note">{quote.blocked_words.length}</em>
                  </div>
                </li>
              </ul>
            ) : (
              <p className="empty-note">
                {IC.x}<span>The open door did not answer, so nothing can be promised about what a request is measured against.</span>
              </p>
            )}

            <h3 className="desk-sub">Every number the door carries</h3>
            <ul className="terms">
              {Object.entries(quote?.limits || {}).map(([key, value]) => (
                <li className="term" key={key} data-live-limit={key}>
                  <div className="term-body">
                    <b className="term-text">{desk.blocks.flatMap(block => block.lines).find(item => item.key === key)?.label || key}</b>
                    <em className="term-note">{typeof value === 'boolean' ? (value ? 'on' : 'off') : String(value)}</em>
                  </div>
                </li>
              ))}
            </ul>

            <h3 className="desk-sub">The links a post may not carry</h3>
            {desk.links.length === 0 ? (
              <p className="empty-note">{IC.x}<span>No domain is blocked yet.</span></p>
            ) : (
              <ul className="terms">
                {desk.links.map(link => (
                  <li className={`term${link.is_active ? '' : ' off'}`} key={link.id} data-link={link.id}>
                    <div className="term-body">
                      <b className="term-text">{link.text}</b>
                      <em className="term-note">{link.note || (link.is_active ? 'blocked' : 'kept, not blocking')}</em>
                      <span className="term-meta">
                        {link.created_by ? <>by <b>{link.created_by}</b> {ago(link.created_at)}</> : ago(link.created_at)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <p className="panel-foot">
              {IC.rule}
              <span>
                A link, a word and a prohibited item are all one table, so this list is written from{' '}
                <Link href="/policy">Platform rules</Link>, one place to decide what is not allowed, one
                audit verb to record it.
              </span>
            </p>

            <p className="panel-foot">
              {IC.alert}
              <span>
                All {desk.enforced.length} rules here are {ENFORCED_NOTE}: the door that answers a post, a
                comment, a follow or a sign-up reads this desk on the request itself, so a save changes
                what a member meets within one action and a restart is not part of it. A zero on a
                ceiling is that rule switched off, not everybody blocked.
              </span>
            </p>
          </section>
        </div>
      )}
    </ConsoleShell>
  );
}
