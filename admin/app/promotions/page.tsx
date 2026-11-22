'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ConsoleShell from '@/components/ConsoleShell';
import ContentCard from '@/components/ContentCard';
import { Act, Chips, More } from '@/components/List';
import { api } from '@/lib/api';
import { num } from '@/lib/format';
import { IC } from '@/lib/icons';
import { ago, stamp } from '@/lib/time';
import { useSession } from '@/lib/session';
import { PromoDetail, PromoPage, PromoRow, ReachConfig } from '@/lib/types';

/**
 * Contract 6.8 — the promotion desk. Somebody has already paid Coins for reach on
 * their own post or listing, so this screen decides with the thing itself on the
 * row, the reports sitting under it, and the number of coins each verb hands back.
 *
 * Nothing here is a status column someone guessed at: "waiting" means no seat has
 * signed this off, which is a different question from "the feed is carrying it",
 * because the site takes the coins when the campaign is created.
 */

const STATES = [
  { id: 'waiting', label: 'Waiting on a seat' },
  { id: 'live', label: 'Signed off and running' },
  { id: 'paused', label: 'Paused' },
  { id: 'ended', label: 'Ended' },
  { id: 'all', label: 'Every campaign' },
];

const STAMP: Record<string, { tone: string; label: string }> = {
  draft: { tone: 'mute', label: 'Not paid for yet' },
  active: { tone: 'good', label: 'Running' },
  paused: { tone: 'warn', label: 'Paused' },
  ended: { tone: 'mute', label: 'Ended' },
};

type Verb = 'approve' | 'pause' | 'resume' | 'reject' | 'stop';

/** Which verbs a campaign offers, in the order a person at the desk reaches for them. */
function verbsFor(row: PromoRow): Verb[] {
  if (row.status === 'draft' || row.status === 'ended') return [];
  const over = row.left_hours !== null && row.left_hours <= 0;
  const out: Verb[] = [];
  if (row.status === 'active') {
    if (!over && row.sign_off === 'waiting') out.push('approve');
    out.push('pause');
  }
  if (row.status === 'paused' && !over) out.push('resume');
  out.push('reject', 'stop');
  return out;
}

/** Which pile the server counts this campaign in — the same question its chips answer. */
function pileOf(row: PromoRow): 'waiting' | 'live' | 'paused' | 'ended' | null {
  if (row.status === 'active') return row.sign_off === 'waiting' ? 'waiting' : 'live';
  if (row.status === 'paused') return 'paused';
  if (row.status === 'ended') return 'ended';
  return null;
}

/** A campaign holds its reservation back while it is running or paused, and only until it ends. */
const reserved = (row: PromoRow) => row.status === 'active' || row.status === 'paused';

export default function PromotionsScreen() {
  const { noteGate, can } = useSession();
  const [page, setPage] = useState<PromoPage | null>(null);
  const [rows, setRows] = useState<PromoRow[] | null>(null);
  const [quote, setQuote] = useState<ReachConfig | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [state, setState] = useState('waiting');
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const review = can('promotions_review');

  const fetchPage = useCallback((after: string | null) => {
    const params = new URLSearchParams();
    params.set('state', state);
    if (q.trim()) params.set('q', q.trim());
    if (after) params.set('cursor', after);
    return api<PromoPage>(`admin/promotions/?${params}`);
  }, [q, state]);

  const load = useCallback(async () => {
    const mine = seq.current + 1;
    seq.current = mine;
    setBusy(true);
    try {
      const next = await fetchPage(null);
      if (seq.current !== mine) return;
      setRows(next.results);
      setPage(next);
      setCursor(next.next_cursor);
    } catch (err) {
      if (seq.current !== mine) return;
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    } finally {
      if (seq.current === mine) setBusy(false);
    }
  }, [fetchPage, noteGate]);

  useEffect(() => {
    load();
  }, [load]);

  // The open door is what the feed will actually do with these campaigns, so the
  // desk reads it beside the queue: a paused switch or a lowered cap changes what
  // "approved" means without changing a single row here.
  useEffect(() => {
    api<ReachConfig>('promotions/config/').then(setQuote).catch(() => setQuote(null));
  }, []);

  const older = async () => {
    if (!cursor) return;
    const mine = seq.current + 1;
    seq.current = mine;
    setBusy(true);
    try {
      const next = await fetchPage(cursor);
      if (seq.current !== mine) return;
      setRows(list => [...(list || []), ...next.results]);
      setPage(next);
      setCursor(next.next_cursor);
    } catch (err) {
      if (seq.current !== mine) return;
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    } finally {
      if (seq.current === mine) setBusy(false);
    }
  };

  const settle = async (id: number, verb: string, reason: string, refund: string) => {
    const before = (rows || []).find(item => item.id === id) || null;
    const out = await api<{ detail: string; campaign: PromoRow }>(`admin/promotions/${id}/${verb}/`, {
      method: 'POST', body: { reason, refund },
    });
    const after = out.campaign;
    setRows(list => (list || []).map(row => (row.id === id ? after : row)));
    setPage(current => {
      if (!current || !before) return current;
      const from = pileOf(before);
      const to = pileOf(after);
      if (from === to && reserved(before) === reserved(after)) return current;
      const counts = { ...current.counts };
      if (from) counts[from] -= 1;
      if (to) counts[to] += 1;
      const coins = Number(after.coins);
      if (reserved(before) && !reserved(after)) counts.reserved = String(Number(counts.reserved) - coins);
      if (!reserved(before) && reserved(after)) counts.reserved = String(Number(counts.reserved) + coins);
      return { ...current, counts };
    });
    setBanner({ kind: 'ok', text: out.detail });
    return out;
  };

  const counts = page?.counts;

  return (
    <ConsoleShell
      title="Promotions"
      subtitle="Campaigns somebody already paid Coins for, the content they point at, and the five verbs that decide whether the reach is delivered — with the coins each one hands back printed before the click."
      actions={(
        <button type="button" className={`btn ghost${busy ? ' spinning' : ''}`} onClick={() => load()} title="Reload the queue">
          {IC.refresh}<span>Refresh</span>
        </button>
      )}
    >
      <Chips
        label="Filter by where the campaign stands"
        chips={STATES.map(item => ({
          id: item.id,
          label: item.label,
          n: counts
            ? (item.id === 'all'
              ? counts.every
              : counts[item.id as 'waiting' | 'live' | 'paused' | 'ended'])
            : undefined,
        }))}
        value={state}
        onPick={setState}
      />

      <div className="toolbar">
        <label className="search">
          {IC.search}
          <input
            value={q} onChange={event => setQ(event.target.value)}
            placeholder="Search by payer, content, package or category" aria-label="Search campaigns"
          />
        </label>
        <span className="toolbar-count">
          {rows === null ? '…' : <>Campaigns in view: <b>{rows.length}</b></>}
        </span>
      </div>

      {banner && (
        <p className={`banner banner-${banner.kind}`} role="status">
          {banner.kind === 'ok' ? IC.check : IC.alert}<span>{banner.text}</span>
        </p>
      )}

      {page && (
        <p className="facets" data-held>
          <span><b>{page.counts.reserved}</b> coins</span>
          <span className="dot"/>
          <span>reserved by campaigns that are running or paused</span>
          <span className="dot"/>
          <span>{page.controls.caps.daily} promotions per person per day</span>
          <span className="dot"/>
          <span>relevance floor {page.controls.floor}</span>
          {page.counts.waiting > 0 && (
            <>
              <span className="dot"/>
              <span data-waiting>{page.counts.waiting} waiting on a seat</span>
            </>
          )}
        </p>
      )}

      {page?.controls.global_pause && (
        <p className="note row" data-paused-all>
          {IC.alert}
          <span>
            <b>Every promotion is paused at the platform level.</b> Approving a campaign here
            signs it off, but the feed is not showing anyone&rsquo;s paid reach until the switch
            on the reach controls desk is turned back on.
          </span>
        </p>
      )}

      {!review && can('promotions_view') && (
        <p className="note row" data-readonly>
          {IC.lock}
          <span>
            Your seat reads the queue and the paper behind it. Approving, pausing, stopping and
            refunding need <b>Approve, pause, stop, refund</b>, which is not on it.
          </span>
        </p>
      )}

      {quote && quote.packages.length > 0 && (
        <p className="note row" data-shelf>
          {IC.mega}
          <span>
            A payer chooses from {quote.packages.map(pack => `${pack.name} (${pack.coins} coins / ${pack.days} d)`).join(', ')}
            {' '}— {quote.packages_edited
              ? <>this list is the one <b>this desk</b> wrote, not the one the site shipped with</>
              : 'this list is still the three the site shipped with'}
            .
          </span>
        </p>
      )}

      {rows === null ? (
        <div className="skeleton-stack">
          <div className="skeleton"/><div className="skeleton"/><div className="skeleton skeleton-short"/>
        </div>
      ) : rows.length === 0 ? (
        <section className="panel empty">
          <h2>Nothing in this pile</h2>
          <p>
            {state === 'waiting'
              ? 'Every campaign that is running has been looked at by a seat. A new one appears the moment somebody buys reach.'
              : 'No campaign matches this view. Try widening the filter.'}
          </p>
        </section>
      ) : (
        <div className="promotions grid-wrap">
          <table className="grid review">
            <thead>
              <tr>
                <th style={{ width: '17%' }}>Who bought reach</th>
                <th style={{ width: '8%' }}>Coins</th>
                <th style={{ width: '13%' }}>Package bought</th>
                <th style={{ width: '22%' }}>What it sells</th>
                <th style={{ width: '12%' }}>Audience</th>
                <th style={{ width: '10%' }}>Run left</th>
                <th style={{ width: '10%' }}>Standing</th>
                <th style={{ width: '6%' }}>Decided</th>
                <th style={{ width: '2%' }} aria-label="Actions"/>
              </tr>
            </thead>
            {rows.map(row => (
              <Campaign
                key={row.id} row={row} canReview={review}
                settle={settle} onReask={load}
              />
            ))}
          </table>
          <More hasMore={!!cursor} busy={busy} onMore={older} label="Show older campaigns"/>
        </div>
      )}
    </ConsoleShell>
  );
}

function age(row: PromoRow) {
  const { age_min: min, age_max: max, country, city } = row.targeting;
  const where = [country, city].filter(Boolean).join(', ') || 'everywhere';
  return `${min}–${max} · ${where}`;
}

/** The sentence a refund verb has to be worth before anybody clicks it. */
function owed(row: PromoRow, verb: 'reject' | 'stop') {
  const coins = Number(verb === 'reject' ? row.refund_reject : row.refund_stop);
  if (!coins) {
    return verb === 'reject'
      ? 'Refusing hands back nothing — this campaign had no unspent run to give.'
      : 'Stopping hands back nothing: this run had no end date, so nothing was unearned.';
  }
  return verb === 'reject'
    ? `Refusing hands back ${num(coins)} coins — the part of the run they never got.`
    : `Stopping hands back ${num(coins)} coins, or withholds them if the reason is a broken rule.`;
}

function Campaign({ row, canReview, settle, onReask }: {
  row: PromoRow;
  canReview: boolean;
  settle: (id: number, verb: string, reason: string, refund: string) => Promise<unknown>;
  onReask: () => Promise<void>;
}) {
  const { noteGate } = useSession();
  const [open, setOpen] = useState(false);
  const [verb, setVerb] = useState<'reject' | 'stop' | null>(null);
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState<'credit' | 'withhold' | ''>('');
  const [detail, setDetail] = useState<PromoDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const standing = STAMP[row.status] || { tone: 'mute', label: row.status_label };
  const verbs = verbsFor(row);
  const over = row.left_hours !== null && row.left_hours <= 0;

  const expand = async () => {
    setOpen(true);
    if (detail) return;
    try {
      setDetail(await api<PromoDetail>(`admin/promotions/${row.id}/`));
    } catch (err) {
      if (!noteGate(err)) setError((err as Error).message);
    }
  };

  const submit = async (which: Verb) => {
    setWorking(true);
    setError(null);
    try {
      await settle(row.id, which, verb === which ? reason.trim() : '', which === 'stop' ? refund : '');
      setVerb(null);
      setReason('');
      setRefund('');
      setDetail(await api<PromoDetail>(`admin/promotions/${row.id}/`));
      onReask();
    } catch (err) {
      if (!noteGate(err)) setError((err as Error).message);
    } finally {
      setWorking(false);
    }
  };

  // A refund verb is not clickable until the seat has written the sentence the payer
  // is sent, and on a stop until it has also said what happens to the unspent coins.
  const armed = !working && (
    verb === null || (verb !== 'stop'
      ? reason.trim().length > 0
      : reason.trim().length > 0 && refund !== '')
  );

  return (
    <tbody className={`promo${open ? ' open' : ''}`} data-promo={row.id}>
      <tr className={`grid-row${open ? ' open' : ''}`}>
        <td>
          <button type="button" className="promo-id" aria-expanded={open} onClick={() => (open ? setOpen(false) : expand())}>
            <span className="grid-caret">{IC.chevron}</span>
            <span className="promo-name">
              <b>@{row.owner}</b>
              <em>{row.package?.name || 'bought as a budget'} · {row.coins} coins</em>
            </span>
          </button>
        </td>
        <td className="strong num" data-coins>{row.coins}</td>
        <td>
          <span className="promo-pack" data-package={row.package?.id || ''}>
            {row.package ? `${row.package.days ?? '—'} d` : 'no package'}
          </span>
          <p className="promo-reach">{row.package?.reach || row.delivery}</p>
        </td>
        <td>
          <span className={`kind kind-${row.target.type}`}>{row.target.type}</span>
          <span className="promo-sells" title={row.target.text}>{row.target.text || 'no caption'}</span>
        </td>
        <td className="dim"><span className="promo-audit">{age(row)}</span></td>
        <td className="dim">
          <span className={`pile${row.status === 'active' ? ' open' : ' shut'}`} title={stamp(row.created_at)}>
            {IC.pulse}<b>{row.left_hours === null ? 'open run' : `${Math.round(row.left_hours / 24)} d`}</b>
          </span>
          <p className="promo-wait">{Math.round(row.age_hours)} h since bought</p>
        </td>
        <td><span className={`pill ${standing.tone}`}>{standing.label}</span></td>
        <td className="dim">
          <span className="promo-by" data-signoff={row.sign_off}>
            {row.review
              ? <>{row.review.label} by <b>{row.review.by || 'the system'}</b></>
              : row.sign_off === 'waiting' ? 'waiting on a seat' : 'nobody yet'}
          </span>
        </td>
        <td>
          <div className="grid-acts">
            <Act icon="eye" label={open ? 'Close this campaign' : 'Open this campaign'} onClick={() => (open ? setOpen(false) : expand())}/>
          </div>
        </td>
      </tr>

      {open && (
        <tr className="grid-detail">
          <td colSpan={9}>
            <div className="grid-body promo-body">
              <div>
                <h3>What the coins are spent on</h3>
                <ContentCard content={row.card}/>

                <h3>Who is meant to see it</h3>
                <ul className="promo-facts" data-targeting>
                  <li><span>Ages</span><b>{row.targeting.age_min}–{row.targeting.age_max}</b></li>
                  <li><span>Country</span><b>{row.targeting.country || 'everywhere'}</b></li>
                  <li><span>City</span><b>{row.targeting.city || 'the whole country'}</b></li>
                  <li><span>Category</span><b>{row.category || 'not narrowed'}</b></li>
                  <li><span>Bought</span><b>{ago(row.created_at)}</b></li>
                  <li><span>Ends</span><b>{row.ends_at ? stamp(row.ends_at) : 'no end date'}</b></li>
                  <li><span>Impressions</span><b>{num(row.impressions)}</b></li>
                  <li><span>Clicks</span><b>{num(row.clicks)}</b></li>
                </ul>

                <h3>Reports already sitting on it</h3>
                {detail && detail.reports.length > 0 ? (
                  <div className="promo-pile" data-pile>
                    <p className="line">
                      {IC.flag}
                      <span>
                        <b>{detail.campaign.pile.open}</b> open report(s) from{' '}
                        <b>{detail.campaign.pile.reporters}</b> people
                        {detail.campaign.pile.reasons.length
                          ? <> — {detail.campaign.pile.reasons.map(item => `${item.reason} ×${item.n}`).join(', ')}</>
                          : null}
                      </span>
                    </p>
                    <ul className="promo-reasons">
                      {detail.reports.map(item => (
                        <li key={item.id} data-report={item.id}>
                          <b>{item.reason}</b>
                          <span>{item.details || 'no details given'}</span>
                          <em>{item.reporter ? `@${item.reporter.username}` : 'anonymous'} {ago(item.created_at)} · {item.status}</em>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="empty-note">{IC.check}<span>Nothing has been reported on what this campaign sells.</span></p>
                )}
              </div>

              <div>
                <h3>Decide</h3>
                {row.status === 'draft' ? (
                  <p className="note row" data-unpaid>
                    {IC.alert}
                    <span>A draft has not been paid for — there are no coins here to approve or hand back.</span>
                  </p>
                ) : row.status === 'ended' ? (
                  <div className="verdict" data-record>
                    <p className="verdict-line">
                      {IC.check}
                      <span><b>{row.review?.label || row.status_label}</b> — {row.review?.reason || 'no sentence was written'}</span>
                    </p>
                    {Number(row.review?.coins_refunded || 0) > 0 && (
                      <p className="verdict-note">
                        <span>Coins moved</span>
                        <b>{row.review?.coins_refunded} back to @{row.owner}&apos;s wallet</b>
                      </p>
                    )}
                    <p className="note">{IC.alert}<span>An ended campaign is a record, not a task. Nothing here changes it again.</span></p>
                  </div>
                ) : !canReview ? (
                  <p className="note row">
                    {IC.lock}
                    <span>Deciding what gets paid reach is not on your seat. You can read the queue and the paper.</span>
                  </p>
                ) : (
                  <div className="decide">
                    {over && (
                      <p className="note row" data-over>
                        {IC.alert}
                        <span>Its paid run finished {Math.abs(Math.round((row.left_hours || 0) / 24))} day(s) ago, so this desk offers no Approve — signing it off would promise reach that no longer exists.</span>
                      </p>
                    )}
                    <div className="verbs">
                      {verbs.map(item => {
                        const tone = item === 'approve' || item === 'resume' ? 'primary'
                          : item === 'pause' ? 'amber' : 'danger outline';
                        const words: Record<Verb, string> = {
                          approve: 'Sign this off and let the feed carry it — nothing is charged again',
                          pause: 'Take it out of the feed while the reservation stands',
                          resume: 'Put it back in the feed on the end date it already had',
                          reject: owed(row, 'reject'),
                          stop: owed(row, 'stop'),
                        };
                        return (
                          <button
                            key={item} type="button" data-verb={item}
                            className={`btn tiny ${tone}`}
                            disabled={working || verb === item}
                            onClick={() => (item === 'reject' || item === 'stop'
                              ? setVerb(verb === item ? null : item)
                              : submit(item))}
                            title={words[item]}
                          >
                            {item === 'approve' || item === 'resume' ? IC.check
                              : item === 'pause' ? IC.lock
                                : item === 'reject' ? IC.x : IC.trash}
                            <span>{item === 'approve' ? 'Approve' : item === 'resume' ? 'Resume'
                              : item === 'pause' ? 'Pause' : item === 'reject' ? 'Reject' : 'Stop'}</span>
                          </button>
                        );
                      })}
                      {verbs.length === 0 && (
                        <p className="empty-note">{IC.x}<span>There is nothing left to decide on this campaign.</span></p>
                      )}
                    </div>

                    {verb && (
                      <div className="ask">
                        <p className="note row">{IC.coin}<span>{owed(row, verb)}</span></p>
                        <label className="field">
                          <span>{verb === 'reject'
                            ? 'Why the reach is refused — the payer is sent this'
                            : 'Why this paid run ends early — the payer is sent this'}</span>
                          <textarea
                            rows={2} name="reason" maxLength={240} value={reason} autoFocus
                            placeholder={verb === 'reject'
                              ? 'e.g. the content is not theirs to promote'
                              : 'e.g. the payment behind this was reversed at the bank'}
                            onChange={event => setReason(event.target.value)}
                          />
                        </label>
                        {verb === 'stop' && (
                          <div className="refund-choice" data-refund>
                            <span className="refund-ask">And the unspent part of the budget is…</span>
                            <div className="moves" role="group" aria-label="What happens to the unspent coins">
                              {(['credit', 'withhold'] as const).map(which => (
                                <button
                                  key={which} type="button" data-refund-pick={which}
                                  className={`fchip${refund === which ? ' on' : ''}`}
                                  aria-pressed={refund === which} disabled={working}
                                  onClick={() => setRefund(which)}
                                >
                                  {which === 'credit' ? 'Refunded to their wallet' : 'Withheld'}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="ask-actions">
                          <button
                            type="button" className="btn primary tiny" disabled={!armed}
                            onClick={() => submit(verb)}
                          >
                            {IC.go}<span>{working ? 'Working…' : `Confirm — ${verb === 'reject' ? 'Reject' : 'Stop'}`}</span>
                          </button>
                          <button
                            type="button" className="btn ghost tiny" disabled={working}
                            onClick={() => { setVerb(null); setReason(''); setRefund(''); }}
                          >
                            <span>Cancel</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {detail && detail.reviews.length > 0 && (
                  <>
                    <h3>The paper on this campaign</h3>
                    <ul className="promo-paper">
                      {detail.reviews.map((item, index) => (
                        <li key={`${item.at}-${index}`} data-paper={item.action}>
                          <b>{item.label}</b>
                          <span>{item.reason || (Number(item.coins_refunded) > 0
                            ? `${item.coins_refunded} coins back` : 'no sentence was written')}</span>
                          <em>
                            {item.choice ? `${item.choice} · ` : ''}
                            {item.by ? `@${item.by}` : 'system'} {ago(item.at)}
                          </em>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {error && <p className="card-error" role="status">{IC.alert}<span>{error}</span></p>}
              </div>
            </div>
          </td>
        </tr>
      )}
    </tbody>
  );
}
