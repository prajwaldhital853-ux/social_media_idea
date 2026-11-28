'use client';

import { useCallback, useEffect, useState } from 'react';
import Banner from '@/components/Banner';
import ConsoleShell from '@/components/ConsoleShell';
import { useConfirm } from '@/components/Confirm';
import { api } from '@/lib/api';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/time';
import { useSession } from '@/lib/session';
import { FeaturesDesk, FeatureLine } from '@/lib/types';

/**
 * The features desk: five doors of the member site a seat can close.
 *
 * Each switch is a `feature_*` settings row, and the row is read again by the endpoint
 * that owns the door before it writes anything. That is the whole point of the screen:
 * a button the site greys out is site code, and a tab from yesterday or a request typed
 * by hand still knows the URL. So the refusal lives behind the URL, and what you see
 * here is the sentence a person gets whether or not their browser ever loaded the switch.
 *
 * Nothing here deletes. A closed marketplace still shows the offers it had, a closed
 * wallet still shows the balance somebody paid for, a closed thread still reads. What
 * closes is the ability to make a thing happen.
 */

const BLURBS: Record<string, string> = {
  marketplace: 'No listing, edit, sold mark, removal or saved offer.',
  video: 'No clip uploads and no new reel. Reels already posted still play.',
  wallet: 'No new coin purchase and no answer to a proof request.',
  messages: 'Nobody can send a message. Every thread stays readable.',
  promotion: 'No campaign can be bought. Campaigns already running keep running.',
};

export default function FeaturesScreen() {
  const { noteGate } = useSession();
  const confirm = useConfirm();
  const [desk, setDesk] = useState<FeaturesDesk | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDesk(await api<FeaturesDesk>('admin/features/'));
    } catch (err) {
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    }
  }, [noteGate]);

  useEffect(() => {
    load();
  }, [load]);

  const lines = desk?.lines || [];
  const baseOf = (item: FeatureLine) => (item.on ? '1' : '0');
  const valueOf = (item: FeatureLine) => draft[item.key] ?? baseOf(item);
  const touched = lines.filter(item => valueOf(item) !== baseOf(item));
  const dirty = touched.length > 0;
  const closed = lines.filter(item => !item.on);

  const save = async () => {
    const shutting = touched.filter(item => valueOf(item) === '0');
    const sure = await confirm({
      title: shutting.length
        ? `Turn ${shutting.map(item => item.label.toLowerCase()).join(', ')} off?`
        : 'Save these switches?',
      body: shutting.length
        ? 'Members keep what is already on the site and keep reading it, but every button for these '
          + 'features goes grey and says it is turned off. Anyone mid-way through is stopped on their next '
          + 'try, including a tab that has not reloaded. Nothing is deleted and no campaign is ended.'
        : 'These doors open again for everybody from the next page they load.',
      confirmLabel: 'Save and enforce',
      tone: 'amber',
    });
    if (!sure) return;
    setBusy(true);
    try {
      const body = touched.reduce(
        (all, item) => ({ ...all, [item.key]: valueOf(item) }), {} as Record<string, string>);
      const out = await api<{ detail: string; lines: FeatureLine[] }>('admin/features/', {
        method: 'POST', body,
      });
      setBanner({ kind: 'ok', text: out.detail });
      setDraft({});
      setDesk(prev => (prev ? { ...prev, lines: out.lines, live: {} } : prev));
      load();
    } catch (err) {
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConsoleShell
      title="Site features"
      subtitle="Five doors of the member site, and whether they are open right now. Closing one leaves the section where it is and makes it say it is closed, rather than vanishing from the page."
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
          <section className="panel" data-features="switches">
            <div className="panel-head">
              <div>
                <h2>The five doors</h2>
                <p>
                  On means the feature works as it always has. Off stops a member making anything
                  happen in it, at the endpoint as well as on the page, and says so in one sentence.
                </p>
              </div>
            </div>

            {desk.lines.map(item => (
              <div className="field algo-switch" data-knob={item.key} key={item.key}>
                <span>{item.label}</span>
                <div className="moves" role="group" aria-label={item.label}>
                  {[['1', 'On'], ['0', 'Off']].map(([value, label]) => (
                    <button
                      key={value} type="button" data-switch={value === '1' ? 'on' : 'off'}
                      className={`fchip${valueOf(item) === value ? ' on' : ''}`}
                      aria-pressed={valueOf(item) === value} disabled={busy || !desk.can_write}
                      onClick={() => setDraft({ ...draft, [item.key]: value })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="desk-plain">{BLURBS[item.feature] || item.help}</p>
                <em className="desk-who">
                  {item.set
                    ? <>turned {item.on ? 'on' : 'off'} by <b>{item.by}</b> {ago(item.at || '')}</>
                    : <>never moved from the platform’s own answer, which is on</>}
                  . {item.help}
                </em>
              </div>
            ))}

            <div className="ask-actions">
              <button
                type="button" className="btn primary" data-features-save
                disabled={busy || !dirty || !desk.can_write} onClick={save}
                title={dirty ? 'Write these to the site' : 'Nothing has changed yet'}
              >
                {IC.check}<span>{busy ? 'Working…' : 'Save the switches'}</span>
              </button>
              {dirty && (
                <button type="button" className="btn ghost" disabled={busy} onClick={() => setDraft({})}>
                  <span>Undo my typing</span>
                </button>
              )}
            </div>

            {!desk.can_write && (
              <p className="note row">
                {IC.lock}
                <span>
                  This seat may read the switches but not move them. The door is the <b>Site features</b>{' '}
                  permission, and it is granted from Staff and access.
                </span>
              </p>
            )}
          </section>

          <section className="panel" data-features="live">
            <div className="panel-head">
              <div>
                <h2>What the site runs right now</h2>
                <p>
                  Read the way the endpoints read it, so this is the answer a member is being held to
                  on their next request, not the number last typed into a box.
                </p>
              </div>
            </div>

            <ul className="terms" data-live-features>
              {lines.map(item => (
                <li className={`term${item.on ? '' : ' moved'}`} key={item.key} data-live={item.feature}>
                  <div className="term-body">
                    <b className="term-text">{item.label}</b>
                    <em className="term-note">
                      {item.on ? 'open, every door works' : 'closed, the buttons are grey and the API refuses'}
                    </em>
                  </div>
                </li>
              ))}
            </ul>

            {closed.length > 0 && (
              <p className="note row" data-closed>
                {IC.alert}
                <span>
                  <b>{closed.length === 1 ? 'One door is closed' : `${closed.length} doors are closed`}</b>{' '}
                  on the live site: {closed.map(item => item.label.toLowerCase()).join(', ')}. A member who
                  tries any of it is told it is turned off by the admin, and nothing is written.
                </span>
              </p>
            )}

            <p className="panel-foot">
              {IC.disk}
              <span>
                Closing a door does not end a campaign, take down a listing or lock a wallet. It stops new
                things happening in that section until a seat turns it back on.
              </span>
            </p>
          </section>
        </div>
      )}
    </ConsoleShell>
  );
}
