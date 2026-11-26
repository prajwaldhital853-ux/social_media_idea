'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import ConsoleShell from '@/components/ConsoleShell';
import { ActivityChart, ChartSeries, MixRing, RingSlice } from '@/components/Charts';
import { api } from '@/lib/api';
import { bytes as humanBytes, money, num, percent, waiting } from '@/lib/format';
import { IC } from '@/lib/icons';
import { useAdminEvent, useAdminLive } from '@/lib/live';
import { shipped } from '@/lib/nav';
import { stamp } from '@/lib/time';
import { useSession } from '@/lib/session';
import { CampaignRow, Overview, PromotionAnalytics, SeriesPoint, Threshold, Tile } from '@/lib/types';

const REFRESH_EVERY = 60000;
/** Rows either dashboard panel shows before it asks for another page. */
const PAGE = 7;
const TARGET_LABEL: Record<string, string> = { post: 'posts', comment: 'comments', user: 'people', listing: 'listings' };

/** One hue per tile, shared by that tile's sparkline and by whatever chart the
 *  same number appears in, a tile and its chart drawn in two colours reads as
 *  two different measures. */
const TILE_COLOR: Record<string, string> = {
  new_users: 'var(--brand)',
  posts: '#3C4450',
  comments: 'var(--amber-ink)',
  listings: 'var(--green-ink)',
  open_reports: 'var(--brand)',
  coin_requests: 'var(--amber-ink)',
  promotions: '#3C4450',
  storage: 'var(--green-ink)',
  coins_moved: 'var(--ink)',
};
const KIND_COLOR: Record<string, string> = {
  post: 'var(--brand)',
  comment: '#3C4450',
  listing: 'var(--amber-ink)',
  user: 'var(--green-ink)',
};
/** Only the tiles that count things happening per day share one axis. Coins are
 *  a value, not a volume, so they keep their own tile rather than a fifth line. */
const ACTIVITY_IDS = ['new_users', 'posts', 'comments', 'listings'];

export default function OverviewPage() {
  const { noteGate } = useSession();
  const { health } = useAdminLive();
  const [data, setData] = useState<Overview | null>(null);
  const [campaigns, setCampaigns] = useState<PromotionAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (rescan = false) => {
    setBusy(true);
    try {
      const overview = await api<Overview>(`admin/overview/${rescan ? '?refresh=1' : ''}`);
      setData(overview);
      setError(null);
      // Campaign results cost a handful of queries each and sit below the fold,
      // so they arrive after the numbers a person came to read.
      setCampaigns(await api<PromotionAnalytics>(`admin/analytics/promotions/?limit=${PAGE}`));
    } catch (err) {
      if (!noteGate(err)) setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [noteGate]);

  useAdminEvent([
    'comment', 'post_new', 'reaction', 'audit', 'staff_notice',
    'coin_request', 'promotion', 'coins', 'warning',
  ], load);

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    if (health === 'live') return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load(false);
    }, REFRESH_EVERY);
    return () => clearInterval(id);
  }, [health, load]);

  return (
    <ConsoleShell
      title="Dashboard"
      subtitle={data
        ? `Counted from live tables at ${stamp(data.generated_at)}. Every number here has a screen behind it.`
        : 'Reading the live tables.'}
      actions={(
        <button type="button" className={`btn ghost${busy ? ' spinning' : ''}`} onClick={() => load(true)}
                title="Re-count, and re-measure the upload directory instead of using the cached figure">
          {IC.refresh}<span>{busy ? 'Counting…' : 'Re-count'}</span>
        </button>
      )}
    >
      {error && (
        <p className="banner banner-bad" role="status">{IC.alert}<span>{error}</span></p>
      )}

      {!data ? (
        <div className="tile-grid">
          {[0, 1, 2, 3, 4, 5].map(index => <div key={index} className="skeleton tile-skeleton" />)}
        </div>
      ) : (
        <>
          <HealthStrip health={data.health}/>

          <section className="panel activity wide">
            <header className="panel-head">
              <div>
                <h2>What happened each day</h2>
                <p>New people, posts, comments and listings, counted a day at a time on one
                  axis. The figure under each name is what that count did over the window.</p>
              </div>
              <span className="panel-count">{data.windows.series_days} days counted back</span>
            </header>
            <ActivityChart series={activity(data.tiles)}
                           hint="Each line is one count a day."/>
          </section>

          <div className="tile-grid">
            {data.tiles.map(tile => (
              <TileCard key={tile.id} tile={tile} threshold={data.thresholds[`alert_storage_gb`]}/>
            ))}
          </div>

          <MakeUp tiles={data.tiles}/>

          <section className="panel performance">
            <header className="panel-head">
              <div>
                <h2>Promotion performance</h2>
                <p>What each campaign achieved inside the window it ran, not its lifetime total.</p>
              </div>
              {campaigns && <span className="panel-count">{campaigns.total} campaigns</span>}
            </header>
            <Campaigns key={campaigns?.generated_at || 'wait'} campaigns={campaigns}/>
          </section>
        </>
      )}
    </ConsoleShell>
  );
}

function HealthStrip({ health }: { health: Overview['health'] }) {
  return (
    <section className={`health health-${health.state}`} aria-label="System health">
      <span className="health-summary">
        {health.state === 'ok' ? IC.check : IC.alert}
        <b>{HEALTH_HEADLINE[health.state] || 'Some checks need a look'}</b>
      </span>
      <ul className="health-list">
        {health.checks.map(check => (
          <li key={check.id} className={`health-item health-${check.state}`} title={check.detail}>
            <span className="health-dot"/>
            <span>{check.label}</span>
            <em>{check.state}</em>
          </li>
        ))}
      </ul>
    </section>
  );
}

const HEALTH_HEADLINE: Record<string, string> = {
  ok: 'All systems answering',
  slow: 'The database is answering slowly',
  degraded: 'Some safeguards are partial',
  off: 'Safeguards switched off, this is not a live box',
  unknown: 'Part of the platform cannot be measured',
  down: 'Something is not answering',
};

function TileCard({ tile, threshold }: { tile: Tile; threshold?: Threshold }) {
  const { session } = useSession();
  const link = shipped(tile.href, session?.permissions || [], session?.role) ? tile.href : null;
  const color = TILE_COLOR[tile.id] || 'var(--brand)';
  return (
    <article className={`tile tile-${tile.kind}`} data-tile={tile.id} style={{ ['--tile' as string]: color }}>
      <header className="tile-head">
        <span className="tile-label">{tile.label}</span>
        <span className="tile-icon">{TILE_ICON[tile.id] || IC.chart}</span>
      </header>

      {tile.kind === 'rate' && <RateBody tile={tile}/>}
      {tile.kind === 'queue' && <QueueBody tile={tile}/>}
      {tile.kind === 'coins' && <CoinsBody tile={tile}/>}
      {tile.kind === 'promotions' && <PromoBody tile={tile}/>}
      {tile.kind === 'storage' && <StorageBody tile={tile} threshold={threshold}/>}
      {tile.kind === 'ledger' && <LedgerBody tile={tile}/>}

      {link && (
        <Link className="tile-link" href={link}>
          <span>Work it off</span>{IC.go}
        </Link>
      )}
    </article>
  );
}

const TILE_ICON: Record<string, JSX.Element> = {
  new_users: IC.users,
  posts: IC.chart,
  comments: IC.chat,
  listings: IC.store,
  open_reports: IC.flag,
  coin_requests: IC.coin,
  promotions: IC.pulse,
  storage: IC.disk,
  coins_moved: IC.coin,
};

function Split({ items }: { items: [string, string][] }) {
  return (
    <dl className="tile-split">
      {items.map(([label, value]) => (
        <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}

function RateBody({ tile }: { tile: Tile }) {
  return (
    <>
      <b className="tile-number">{num(tile.today)}</b>
      <span className="tile-unit">since midnight <Trend points={tile.series}/></span>
      <Spark points={tile.series || []}/>
      <Split items={[['7 days', num(tile.week)], ['30 days', num(tile.month)], ['All time', num(tile.total)]]}/>
    </>
  );
}

/** This stretch of days against the one before it, in the tile's own hue. A day
 *  count that has moved is the one thing a snapshot cannot say on its own. */
function Trend({ points }: { points?: SeriesPoint[] }) {
  const series = points || [];
  if (series.length < 14) return null;
  const half = Math.floor(series.length / 2);
  const sum = (from: number, to: number) => series.slice(from, to).reduce((total, point) => total + point.n, 0);
  const now = sum(half, series.length);
  const before = sum(0, half);
  if (!before) {
    return now ? <em className="trend is-new">new</em> : <em className="trend is-flat">steady</em>;
  }
  const change = Math.round(((now - before) / before) * 100);
  if (!change) return <em className="trend is-flat">steady</em>;
  const up = change > 0;
  return (
    <em className={`trend ${up ? 'is-up' : 'is-down'}`}
        title={`${num(before)} in the first ${half} days, ${num(now)} in the last ${series.length - half}`}>
      <svg viewBox="0 0 8 8" aria-hidden="true">
        {up ? <path d="M4 1l3.2 6H0.8z"/> : <path d="M4 7L0.8 1h6.4z"/>}
      </svg>
      {up ? '+' : '−'}{Math.abs(change)}%
    </em>
  );
}

function QueueBody({ tile }: { tile: Tile }) {
  return (
    <>
      <b className={`tile-number ${tile.value ? 'is-debt' : ''}`}>{num(tile.value)}</b>
      <span className="tile-unit">waiting on a decision</span>
      <Split items={[
        ['Opened today', num(tile.new_today)],
        ['Closed this week', num(tile.closed_week)],
        ['Oldest', tile.value ? waiting(tile.oldest_minutes) : 'nothing waiting'],
      ]}/>
    </>
  );
}

function CoinsBody({ tile }: { tile: Tile }) {
  return (
    <>
      <b className={`tile-number ${tile.pending ? 'is-debt' : ''}`}>{num(tile.pending)}</b>
      <span className="tile-unit">proofs unverified</span>
      <Split items={[
        ['Coins held up', num(tile.pending_coins)],
        ['Value held up', money(tile.pending_npr)],
        ['Oldest', tile.pending ? waiting(tile.oldest_minutes) : 'queue clear'],
      ]}/>
      <p className="tile-foot">
        <span>Sold today <b>{num(tile.sold_today)}</b></span>
        <span>7 days <b>{num(tile.sold_week)}</b></span>
        <span>Collected <b>{money(tile.collected_npr)}</b></span>
      </p>
    </>
  );
}

function PromoBody({ tile }: { tile: Tile }) {
  const views = tile.impressions_month || 0;
  const opens = tile.clicks_month || 0;
  return (
    <>
      <b className="tile-number">{num(tile.active)}</b>
      <span className="tile-unit">running in the feed right now</span>
      <Split items={[
        ['Awaiting review', num(tile.awaiting_review)],
        ['Paused', num(tile.paused)],
        ['Started this month', num(tile.started_month)],
      ]}/>
      <p className="tile-foot">
        <span>Views <b>{num(views)}</b></span>
        <span>Opens <b>{num(opens)}</b></span>
        <span>Open rate <b>{views ? percent(Math.round(opens * 1000 / views) / 10) : '-'}</b></span>
      </p>
    </>
  );
}

function StorageBody({ tile, threshold }: { tile: Tile; threshold?: Threshold }) {
  const kinds = Object.entries(tile.by_kind || {});
  const peak = Math.max(1, ...kinds.map(([, count]) => count));
  return (
    <>
      <b className="tile-number">{tile.state === 'unknown' ? '-' : humanBytes(tile.bytes)}</b>
      <span className="tile-unit">{tile.state === 'unknown' ? 'no disk on this server' : `${num(tile.files)} uploaded files`}</span>
      {kinds.length > 0 && (
        <ul className="bars">
          {kinds.slice(0, 4).map(([kind, count]) => (
            <li key={kind}>
              <span className="bar-kind">.{kind}</span>
              <span className="bar-track"><i style={{ width: `${(count / peak) * 100}%` }}/></span>
              <b>{num(count)}</b>
            </li>
          ))}
        </ul>
      )}
      <p className="tile-note">
        {tile.detail}
        {tile.state === 'ok' && threshold && ` Alert above ${threshold.value} GB.`}
      </p>
    </>
  );
}

function LedgerBody({ tile }: { tile: Tile }) {
  return (
    <>
      <b className="tile-number">{num(tile.spent_today)}</b>
      <span className="tile-unit">spent since midnight <Trend points={tile.series}/></span>
      <Spark points={tile.series || []}/>
      <Split items={[['7 days', num(tile.spent_week)], ['30 days', num(tile.spent_month)], ['Bought in 30 d', num(tile.credited_month)]]}/>
    </>
  );
}

/** The tiles that share a unit, things that happened per day, become lines. */
function activity(tiles: Tile[]): ChartSeries[] {
  return ACTIVITY_IDS
    .map(id => tiles.find(tile => tile.id === id))
    .filter((tile): tile is Tile => Boolean(tile?.series?.length))
    .map(tile => ({
      id: tile.id,
      label: tile.label,
      color: TILE_COLOR[tile.id] || 'var(--brand)',
      points: tile.series || [],
    }));
}

/** The two questions a pile of numbers cannot answer: what is the pile made of,
 *  and why was it raised. Both read off the same counts the report tile shows. */
function MakeUp({ tiles }: { tiles: Tile[] }) {
  const queue = tiles.find(tile => tile.id === 'open_reports');
  const promo = tiles.find(tile => tile.id === 'promotions');
  const targets: RingSlice[] = Object.entries(queue?.by_target || {})
    .map(([kind, value]) => ({
      id: kind,
      label: TARGET_LABEL[kind] || kind,
      value: value || 0,
      color: KIND_COLOR[kind] || '#79818D',
    }));
  const states: RingSlice[] = [
    { id: 'active', label: 'Running', value: promo?.active || 0, color: 'var(--green-ink)' },
    { id: 'pending', label: 'Awaiting review', value: promo?.awaiting_review || 0, color: 'var(--brand)' },
    { id: 'paused', label: 'Paused', value: promo?.paused || 0, color: '#79818D' },
  ];
  const reasons = (queue?.by_reason || []).slice(0, 5);

  if (!targets.length && !reasons.length && !states.some(entry => entry.value)) return null;

  return (
    <div className="make-up">
      <section className="panel">
        <header className="panel-head">
          <div>
            <h2>What the pile is on</h2>
            <p>Every open report, split by the kind of thing it names.</p>
          </div>
          <span className="panel-count">{num(queue?.value)} open</span>
        </header>
        {targets.length
          ? <MixRing slices={targets} caption="open reports"/>
          : <p className="empty-note">{IC.check} Nothing is reported right now.</p>}
      </section>

      <section className="panel">
        <header className="panel-head">
          <div>
            <h2>Why it was reported</h2>
            <p>The five reasons named most often, and the share of the open pile each
              one carries. Only the five are listed, so the shares do not add to one hundred.</p>
          </div>
        </header>
        {reasons.length
          ? <Reasons rows={reasons} total={queue?.value || 0}/>
          : <p className="empty-note">{IC.check} No reasons to rank, the queue is empty.</p>}
      </section>

      <section className="panel">
        <header className="panel-head">
          <div>
            <h2>Where the promotions stand</h2>
            <p>Only the orders someone on shift can still act on: ended and refused
              campaigns are left out of the ring.</p>
          </div>
        </header>
        {states.some(entry => entry.value)
          ? <MixRing slices={states} caption="to act on"/>
          : <p className="empty-note">{IC.chart} Nothing is waiting or running.</p>}
      </section>
    </div>
  );
}

function Reasons({ rows, total }: { rows: { reason: string; n: number }[]; total: number }) {
  const peak = Math.max(1, ...rows.map(entry => entry.n));
  return (
    <ul className="reasons">
      {rows.map((entry, index) => (
        <li key={entry.reason} style={{ animationDelay: `${index * 60}ms` }}>
          <span className="reason-name">{entry.reason}</span>
          <span className="reason-track">
            <i style={{ width: `${(entry.n / peak) * 100}%` }}/>
          </span>
          <b>{num(entry.n)}</b>
          <em>{total ? Math.round((entry.n / total) * 100) : 0}%</em>
        </li>
      ))}
    </ul>
  );
}

function Spark({ points }: { points: SeriesPoint[] }) {
  const width = 100;
  const height = 30;
  const peak = Math.max(1, ...points.map(point => point.n));
  const last = points.length ? points[points.length - 1].n : 0;
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  const line = points.map((point, index) => (
    `${(index * step).toFixed(1)},${(height - (point.n / peak) * (height - 3) - 1.5).toFixed(1)}`
  )).join(' ');
  const area = points.length ? `0,${height} ${line} ${width},${height}` : '';

  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
         role="img" aria-label={`${num(points.reduce((sum, point) => sum + point.n, 0))} over ${points.length} days, ending at ${num(last)}`}>
      {area && <polygon className="spark-fill" points={area}/>}
      {line && <polyline className="spark-line" points={line}/>}
      <circle className="spark-end" cx={width} cy={height - (last / peak) * (height - 3) - 1.5} r="1.8"/>
    </svg>
  );
}

function Campaigns({ campaigns }: { campaigns: PromotionAnalytics | null }) {
  const { noteGate } = useSession();
  const [rows, setRows] = useState<CampaignRow[]>(campaigns?.rows || []);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');

  const loadMore = async () => {
    setBusy(true);
    setFailed('');
    try {
      const page = await api<PromotionAnalytics>(`admin/analytics/promotions/?limit=${PAGE}&offset=${rows.length}`);
      setRows(current => [...current, ...page.rows]);
    } catch (err) {
      if (!noteGate(err)) setFailed((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!campaigns) {
    return (
      <div className="skeleton-stack">
        <div className="skeleton"/><div className="skeleton"/><div className="skeleton skeleton-short"/>
      </div>
    );
  }
  if (!rows.length) {
    return <p className="empty-note">{IC.chart} No campaign has been bought yet, so there is nothing to score.</p>;
  }

  const columns = campaigns.metrics;
  // Each page arrives on its own totals line, so the foot is added from the rows
  // actually on the screen rather than from the first page alone.
  const sum = (id: string) => rows.reduce((total, row) => total + (row.metrics[id] || 0), 0);
  const more = rows.length < campaigns.total;
  // The bar is scaled to the best rate on the screen, not to 100%: no campaign
  // opens at anything like a third, and a row of quarter-filled tracks says nothing.
  const topRate = Math.max(1, ...rows.map(row => row.click_rate || 0));

  return (
    <>
      <div className={`table-scroll${rows.length > PAGE ? ' capped' : ''}`}>
        <table className="campaigns">
          <thead>
            <tr>
              <th scope="col">Campaign</th>
              {columns.map(metric => (
                <th key={metric.id} scope="col" title={campaigns.unmeasured[metric.id]}>
                  {metric.label}
                  {campaigns.unmeasured[metric.id] && <span className="dim-mark" aria-hidden="true"> *</span>}
                </th>
              ))}
              <th scope="col">Open rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id}>
                <th scope="row">
                  <b>{row.target_type} #{row.target.split(':')[1]}</b>
                  <em>{row.package || 'custom budget'} · {row.status} · live {waiting(row.minutes_live)}</em>
                  <span className="who">@{row.owner}</span>
                </th>
                {columns.map(metric => (
                  <td key={metric.id} data-metric={metric.id} data-label={metric.label}
                      className={campaigns.unmeasured[metric.id] ? 'is-dim' : ''}>
                    {campaigns.unmeasured[metric.id]
                      ? <span title={campaigns.unmeasured[metric.id]}>,</span>
                      : num(row.metrics[metric.id])}
                  </td>
                ))}
                <td data-label="Open rate" className="rate-cell">
                  {row.click_rate === null
                    ? ','
                    : (
                      <span className="rate">
                        <span className="rate-track"><i style={{ width: `${Math.min(100, (row.click_rate / topRate) * 100)}%` }}/></span>
                        <b>{percent(row.click_rate)}</b>
                      </span>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">These {rows.length} together</th>
              {columns.map(metric => (
                <td key={metric.id} data-label={metric.label} className={campaigns.unmeasured[metric.id] ? 'is-dim' : ''}>
                  {campaigns.unmeasured[metric.id] ? '-' : num(sum(metric.id))}
                </td>
              ))}
              <td data-label="Open rate">,</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {campaigns.total > PAGE && (
        <div className="panel-more" data-campaign-more>
          <span>{rows.length} of {campaigns.total} campaigns shown{more ? '' : ', that is all of them'}</span>
          {more && (
            <button type="button" className="btn ghost tiny" disabled={busy} onClick={loadMore}>
              <span>{busy ? 'Scoring…' : 'Load more'}</span>
            </button>
          )}
        </div>
      )}
      {failed && <p className="card-error" role="status">{IC.alert}<span>{failed}</span></p>}
      {Object.keys(campaigns.unmeasured).length > 0 && (
        <p className="panel-foot">
          {IC.alert}
          <span>
            <b>Two of these are not measured yet.</b>{' '}
            {Object.entries(campaigns.unmeasured)
              .map(([key, reason]) => `${key.replace(/_/g, ' ')}: ${reason}`)
              .join(' ')}
            {' '}They are left blank rather than shown as zero, because a zero reads as a campaign that did nothing.
          </span>
        </p>
      )}
    </>
  );
}
