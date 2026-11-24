'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Banner from '@/components/Banner';
import ConsoleShell from '@/components/ConsoleShell';
import { ActLink, Chips, More } from '@/components/List';
import { api } from '@/lib/api';
import { num } from '@/lib/format';
import { IC } from '@/lib/icons';
import { stamp } from '@/lib/time';
import { useSession } from '@/lib/session';
import { PromoPage, PromoRow, ReachConfig } from '@/lib/types';

/**
 * Contract 6.8 — the promotion desk. Somebody has asked for reach on their own post
 * or listing, and this screen decides whether the platform sells it to them: the
 * content itself on the row, the reports sitting under it, and the number of coins
 * each verb hands back printed before the click.
 *
 * Nothing here is a status column someone guessed at. "Waiting" means either an order
 * no seat has charged yet or a run that predates the queue, and the two are told apart
 * by `charged` — the coins leave the payer's wallet when this desk approves, not when
 * the campaign was written down.
 */

const STATES = [
  { id: 'waiting', label: 'Waiting on a seat' },
  { id: 'live', label: 'Signed off and running' },
  { id: 'paused', label: 'Paused' },
  { id: 'refused', label: 'Refused' },
  { id: 'ended', label: 'Ended' },
  { id: 'all', label: 'Every campaign' },
];

const STAMP: Record<string, { tone: string; label: string }> = {
  draft: { tone: 'mute', label: 'Never ordered' },
  pending: { tone: 'warn', label: 'Waiting for approval' },
  active: { tone: 'good', label: 'Running' },
  paused: { tone: 'warn', label: 'Paused' },
  rejected: { tone: 'dead', label: 'Refused' },
  ended: { tone: 'mute', label: 'Ended' },
};

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

  const counts = page?.counts;

  return (
    <ConsoleShell
      title="Promotions"
      subtitle="Campaigns people have ordered with Coins, the content they point at, and the five verbs that decide whether the reach is delivered. Approving is what takes the coins and starts the run; every refund is printed before the click."
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
              : counts[item.id as 'waiting' | 'live' | 'paused' | 'refused' | 'ended'])
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

      <Banner banner={banner} />

      {page && (
        <p className="facets" data-held>
          <span><b>{page.counts.reserved}</b> coins</span>
          <span className="dot"/>
          <span>spent by campaigns that are running or paused</span>
          <span className="dot"/>
          <span><b>{page.counts.unbilled}</b> more</span>
          <span className="dot"/>
          <span>still in payers&rsquo; wallets against {page.counts.orders} order{page.counts.orders === 1 ? '' : 's'} waiting</span>
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
              ? 'No order is sitting here. A campaign appears the moment somebody buys reach, and its coins leave the payer’s wallet only when a seat approves it.'
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
            {rows.map(row => <Campaign key={row.id} row={row}/>)}
          </table>
          <More hasMore={!!cursor} busy={busy} onMore={older} label="Show older campaigns"/>
        </div>
      )}
    </ConsoleShell>
  );
}

function age(row: PromoRow) {
  const { age_min: min, age_max: max, country, cities } = row.targeting;
  const where = [...(cities || []), country].filter(Boolean).join(', ') || 'everywhere';
  return `${min}–${max} · ${where}`;
}

/**
 * The queue row is a summary. What the campaign sells, the reports under it
 * and the verbs that hand coins back are all on the campaign's own page.
 */
function Campaign({ row }: { row: PromoRow }) {
  const standing = STAMP[row.status] || { tone: 'mute', label: row.status_label };
  // The order is not the payment. Until a seat approves, the coins are still in the
  // payer's wallet and the run has no clock, so the row must not read as money spent.
  const billed = row.charged;

  return (
    <tbody className="promo" data-promo={row.id} data-charged={billed ? 'yes' : 'no'}>
      <tr className="grid-row">
        <td data-label="Who bought reach">
          <Link href={`/promotions/${row.id}`} className="promo-id">
            <span className="grid-caret">{IC.chevron}</span>
            <span className="promo-name">
              <b>@{row.owner}</b>
              <em>{row.package?.name || 'bought as a budget'} · {row.coins} coins{billed ? '' : ' on approval'}</em>
            </span>
          </Link>
        </td>
        <td data-label="Coins" className="strong num" data-coins>
          {row.coins}
          {!billed && <p className="promo-wait" data-unbilled>not taken yet</p>}
        </td>
        <td data-label="Package bought">
          <span className="promo-pack" data-package={row.package?.id || ''}>
            {row.package ? `${row.package.days ?? '—'} d` : 'no package'}
          </span>
          <p className="promo-reach">{row.package?.reach || row.delivery}</p>
        </td>
        <td data-label="What it sells">
          <span className={`kind kind-${row.target.type}`}>{row.target.type}</span>
          <span className="promo-sells" title={row.target.text}>{row.target.text || 'no caption'}</span>
        </td>
        <td data-label="Audience" className="dim"><span className="promo-audit">{age(row)}</span></td>
        <td data-label="Run left" className="dim">
          <span className={`pile${row.status === 'active' ? ' open' : ' shut'}`}
                title={stamp(billed ? row.starts_at || row.created_at : row.created_at)}>
            {IC.pulse}
            <b>{!billed ? 'starts on approval'
              : row.left_hours === null ? 'open run' : `${Math.round(row.left_hours / 24)} d`}</b>
          </span>
          <p className="promo-wait">{Math.round(row.age_hours)} h since {billed ? 'approved' : 'ordered'}</p>
        </td>
        <td data-label="Standing"><span className={`pill ${standing.tone}`}>{standing.label}</span></td>
        <td data-label="Decided" className="dim">
          <span className="promo-by" data-signoff={row.sign_off}>
            {row.review
              ? <>{row.review.label} by <b>{row.review.by || 'the system'}</b></>
              : row.sign_off === 'waiting' ? 'waiting on a seat' : 'nobody yet'}
          </span>
        </td>
        <td data-label="Actions">
          <div className="grid-acts">
            <ActLink to={`/promotions/${row.id}`} icon="eye" label="Open this campaign"/>
          </div>
        </td>
      </tr>
    </tbody>
  );
}
