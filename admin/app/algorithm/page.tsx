'use client';

import { useCallback, useEffect, useState } from 'react';
import Banner from '@/components/Banner';
import ConsoleShell from '@/components/ConsoleShell';
import { useConfirm } from '@/components/Confirm';
import { api } from '@/lib/api';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/time';
import { useSession } from '@/lib/session';
import { AlgorithmDesk, ReachConfig, SettingLine } from '@/lib/types';

/**
 * Contract 6.8, the reach dials. How a campaign is ranked into a feed, how often
 * one payer may appear, how many ordinary posts go between two paid cards, and the
 * one switch that stops paid reach platform-wide. Every one of them was a constant
 * in the site's code, which meant the only way to make the feed less pushy was a
 * deploy; now the feed reads them from an open door on each page it builds.
 *
 * The numbers the member site is quoted sit beside the boxes on purpose. A dial that
 * saves but is not read is the failure this screen exists to prevent, so the answer
 * a stranger gets from `GET /api/promotions/config/` is printed here as soon as the
 * desk is saved.
 */

const ORDER = [
  'algo_weight_like', 'algo_weight_comment', 'algo_weight_save', 'algo_weight_share',
  'algo_weight_watch', 'algo_weight_follow', 'promo_weight_target', 'algo_relevance_floor',
  'promo_daily_cap', 'promo_repeat_limit', 'promo_organic_gap',
];

const GROUPS: Record<string, string> = {
  weight: 'What a campaign scores on',
  gate: 'What has to be true before it is shown',
  switch: 'The whole platform',
};

const isWeight = (key: string) => key.startsWith('algo_weight_') || key === 'promo_weight_target';

const groupOf = (key: string) => (key === 'promo_global_pause' ? 'switch' : isWeight(key) ? 'weight' : 'gate');

export default function AlgorithmScreen() {
  const { noteGate } = useSession();
  const confirm = useConfirm();
  const [desk, setDesk] = useState<AlgorithmDesk | null>(null);
  const [quote, setQuote] = useState<ReachConfig | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [back, open] = await Promise.all([
        api<AlgorithmDesk>('admin/promotions/algorithm/'),
        api<ReachConfig>('promotions/config/').catch(() => null),
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

  const shown = (desk?.lines || []).slice().sort((a, b) => {
    const rank = (item: SettingLine) => (item.key === 'promo_global_pause' ? 99 : ORDER.indexOf(item.key));
    return rank(a) - rank(b);
  });
  /** What the desk holds for a knob right now, the box, or the switch's on/off. */
  const baseOf = (item: SettingLine) => (item.type === 'bool' ? (item.value ? '1' : '') : String(item.value ?? ''));
  const valueOf = (item: SettingLine) => draft[item.key] ?? baseOf(item);
  // Only the dials that moved are posted, so the audit row names the two the seat
  // turned instead of everything the desk had open.
  const touched = (desk?.lines || []).filter(item => valueOf(item) !== baseOf(item));
  const dirty = touched.length > 0;
  const stop = (desk?.lines || []).find(item => item.key === 'promo_global_pause');
  const pausedAll = !!stop && valueOf(stop) === '1';
  const labelFor = (key: string) => (desk?.lines || []).find(item => item.key === key)?.label || key;

  const save = async () => {
    if (!desk) return;
    const sure = await confirm({
      title: `Rewrite what the feed is built from (${touched.length} line(s))?`,
      body: 'The next feed any member opens is ranked with these numbers. If Global pause is on, nothing is ranked at all until it is put back, these dials change what everyone sees, with no warning to them.',
      confirmLabel: 'Save the dials',
      tone: 'amber',
    });
    if (!sure) return;
    setBusy(true);
    setBanner(null);
    try {
      const body = touched.reduce((all, item) => ({ ...all, [item.key]: valueOf(item) }), {} as Record<string, string>);
      const out = await api<{ detail: string; changed: string[] }>('admin/promotions/algorithm/', { method: 'POST', body });
      setBanner({ kind: 'ok', text: out.detail });
      setDraft({});
      // The dials are read back rather than guessed at, because the desk's whole
      // promise is that what the open door answers is what was written here.
      const [again, open] = await Promise.all([
        api<AlgorithmDesk>('admin/promotions/algorithm/'),
        api<ReachConfig>('promotions/config/').catch(() => null),
      ]);
      setDesk(again);
      setQuote(open);
    } catch (err) {
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConsoleShell
      title="Promotion reach controls"
      subtitle="What a campaign scores on, the score that is worth showing, how often one payer may appear in a feed, how much ordinary content goes between two paid cards, and the switch that stops paid reach entirely."
      actions={(
        <button
          type="button" className={`btn ghost${busy ? ' spinning' : ''}`}
          onClick={() => { load(); setDraft({}); }} title="Reload the dials"
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
          <section className="panel" data-algo="dials">
            <div className="panel-head">
              <div>
                <h2>The dials</h2>
                <p>
                  {desk.running} campaign{desk.running === 1 ? '' : 's'} are running against these numbers
                  and {desk.started_today} started today. Nothing here ends a campaign: the ranking changes
                  the next page the feed builds.
                </p>
              </div>
            </div>

            {(['weight', 'gate', 'switch'] as const).map(which => {
              const lines = shown.filter(item => groupOf(item.key) === which);
              if (lines.length === 0) return null;
              return (
                <div className="algo-block" data-block={which} key={which}>
                  <h3 className="desk-sub">{GROUPS[which]}</h3>
                  <div className="desk-grid">
                    {lines.map(item => (item.type === 'bool' ? (
                      <div className="field algo-switch" data-knob={item.key} key={item.key}>
                        <span>{item.label}</span>
                        <div className="moves" role="group" aria-label={item.label}>
                          {[['1', 'Show paid reach'], ['', 'Pause every promotion']].map(([value, label]) => (
                            <button
                              key={value || 'off'} type="button" data-pause={value || 'off'}
                              className={`fchip${valueOf(item) === value ? ' on' : ''}`}
                              aria-pressed={valueOf(item) === value} disabled={busy}
                              onClick={() => setDraft({ ...draft, [item.key]: value })}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <em className="desk-who">
                          {item.set
                            ? <>turned by <b>{item.by}</b> {ago(item.at || '')}, {item.help}</>
                            : <>never moved from the platform’s own answer, {item.help}</>}
                        </em>
                      </div>
                    ) : (
                      <label className="field" data-knob={item.key} key={item.key}>
                        <span>{item.label}</span>
                        <input
                          name={item.key} value={valueOf(item)} autoComplete="off" maxLength={8}
                          inputMode="numeric" placeholder={String(item.default)}
                          onChange={event => setDraft({ ...draft, [item.key]: event.target.value.replace(/[^\d.]/g, '') })}
                        />
                        <em className="desk-who">
                          {item.set
                            ? <>written by <b>{item.by}</b> {ago(item.at || '')}, {item.help}</>
                            : <>the number the site was built with, still untouched, {item.help}</>}
                        </em>
                      </label>
                    )))}
                  </div>
                </div>
              );
            })}

            {pausedAll && (
              <p className="note row" data-paused-all>
                {IC.alert}
                <span>
                  <b>Paid reach is stopped platform-wide.</b> Campaigns keep their status and their
                  reservation, and none of them is being shown. This is the switch for a spam wave or a
                  billing mistake, it is not a pause button for one payer.
                </span>
              </p>
            )}

            <div className="ask-actions">
              <button
                type="button" className="btn primary" data-algo-save
                disabled={busy || !dirty} onClick={save}
                title={dirty ? 'Write these to the platform' : 'Nothing has changed yet'}
              >
                {IC.check}<span>{busy ? 'Working…' : 'Save the dials'}</span>
              </button>
              {dirty && (
                <button type="button" className="btn ghost" disabled={busy} onClick={() => setDraft({})}>
                  <span>Undo my typing</span>
                </button>
              )}
            </div>
          </section>

          <section className="panel" data-algo="live">
            <div className="panel-head">
              <div>
                <h2>What the feed is told</h2>
                <p>
                  This is the answer <b>GET /api/promotions/config/</b> gives with nobody signed in, the
                  numbers a feed page is ranked with the next time anybody opens the site.
                </p>
              </div>
            </div>

            {quote ? (
              <div data-live-config>
                <ul className="terms">
                  {Object.entries(quote.weights).map(([key, value]) => (
                    <li className="term" key={key} data-live-weight={key}>
                      <div className="term-body">
                        <b className="term-text">{labelFor(key)}</b>
                        <em className="term-note">{value} points</em>
                      </div>
                    </li>
                  ))}
                  <li className="term" data-live="target">
                    <div className="term-body">
                      <b className="term-text">{labelFor('promo_weight_target')}</b>
                      <em className="term-note">{quote.target} points per filter matched</em>
                    </div>
                  </li>
                  <li className="term" data-live="floor">
                    <div className="term-body">
                      <b className="term-text">Lowest score worth showing</b>
                      <em className="term-note">{quote.floor}</em>
                    </div>
                  </li>
                  <li className="term" data-live="daily">
                    <div className="term-body">
                      <b className="term-text">Promotions per person per day</b>
                      <em className="term-note">{quote.caps.daily}</em>
                    </div>
                  </li>
                  <li className="term" data-live="repeat">
                    <div className="term-body">
                      <b className="term-text">Times one person may see a campaign</b>
                      <em className="term-note">{quote.caps.repeat}</em>
                    </div>
                  </li>
                  <li className="term" data-live="gap">
                    <div className="term-body">
                      <b className="term-text">Ordinary posts between two promotions</b>
                      <em className="term-note">{quote.caps.gap}</em>
                    </div>
                  </li>
                  <li className="term" data-live="pause">
                    <div className="term-body">
                      <b className="term-text">Every promotion paused</b>
                      <em className="term-note">{quote.global_pause ? 'yes, nothing paid is being shown' : 'no'}</em>
                    </div>
                  </li>
                </ul>
              </div>
            ) : (
              <p className="empty-note">{IC.x}<span>The open door did not answer, so nothing can be promised about what a feed reads.</span></p>
            )}

            <h3 className="desk-sub">The packages this ranking will spend</h3>
            <ul className="terms">
              {(quote?.packages || desk.packages).map(pack => (
                <li className="term" key={pack.id}>
                  <div className="term-body">
                    <b className="term-text">{pack.name} <em>· {pack.coins} Coins / {pack.days} d</em></b>
                    <em className="term-note">{pack.reach}</em>
                  </div>
                </li>
              ))}
            </ul>

            <p className="panel-foot">
              {IC.disk}
              <span>
                {desk.shipped
                  ? 'The shelf is still the three the site shipped with, the packages desk has never been saved.'
                  : 'The shelf has been rewritten from the packages desk, so a campaign bought today is priced from there.'}
              </span>
            </p>
          </section>
        </div>
      )}
    </ConsoleShell>
  );
}
