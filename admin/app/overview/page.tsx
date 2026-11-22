'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import ConsoleShell from '@/components/ConsoleShell';
import { api } from '@/lib/api';
import { bytes as humanBytes, money, num, percent, waiting } from '@/lib/format';
import { IC } from '@/lib/icons';
import { shipped } from '@/lib/nav';
import { ago, stamp } from '@/lib/time';
import { useSession } from '@/lib/session';
import { AlertRow, Overview, PromotionAnalytics, SeriesPoint, Threshold, Tile } from '@/lib/types';

const REFRESH_EVERY = 60000;
const SEVERITY_LABEL: Record<string, string> = { info: 'Note', warning: 'Needs a look', critical: 'Urgent' };
const TARGET_LABEL: Record<string, string> = { post: 'posts', comment: 'comments', user: 'people', listing: 'listings' };

export default function OverviewPage() {
  const { noteGate } = useSession();
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
      setCampaigns(await api<PromotionAnalytics>('admin/analytics/promotions/'));
    } catch (err) {
      if (!noteGate(err)) setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [noteGate]);

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load(false);
    }, REFRESH_EVERY);
    return () => clearInterval(id);
  }, [load]);

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

          <div className="tile-grid">
            {data.tiles.map(tile => (
              <TileCard key={tile.id} tile={tile} threshold={data.thresholds[`alert_storage_gb`]}/>
            ))}
          </div>

          <AlertFeed alerts={data.alerts}/>

          <section className="panel performance">
            <header className="panel-head">
              <div>
                <h2>Promotion performance</h2>
                <p>What each campaign achieved inside the window it ran — not its lifetime total.</p>
              </div>
              {campaigns && <span className="panel-count">{campaigns.shown} most recent</span>}
            </header>
            <Campaigns campaigns={campaigns}/>
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
  off: 'Safeguards switched off — this is not a live box',
  unknown: 'Part of the platform cannot be measured',
  down: 'Something is not answering',
};

function TileCard({ tile, threshold }: { tile: Tile; threshold?: Threshold }) {
  const link = shipped(tile.href) ? tile.href : null;
  return (
    <article className={`tile tile-${tile.kind}`} data-tile={tile.id}>
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
      <span className="tile-unit">since midnight</span>
      <Spark points={tile.series || []}/>
      <Split items={[['7 days', num(tile.week)], ['30 days', num(tile.month)], ['All time', num(tile.total)]]}/>
    </>
  );
}

function QueueBody({ tile }: { tile: Tile }) {
  const targets = Object.entries(tile.by_target || {});
  const reasons = (tile.by_reason || []).slice(0, 2);
  return (
    <>
      <b className={`tile-number ${tile.value ? 'is-debt' : ''}`}>{num(tile.value)}</b>
      <span className="tile-unit">waiting on a decision</span>
      {targets.length > 0 && (
        <ul className="chips">
          {targets.map(([kind, count]) => (
            <li key={kind} className="chip">{count} {TARGET_LABEL[kind] || kind}</li>
          ))}
        </ul>
      )}
      <Split items={[
        ['Opened today', num(tile.new_today)],
        ['Closed this week', num(tile.closed_week)],
        ['Oldest', tile.value ? waiting(tile.oldest_minutes) : 'nothing waiting'],
      ]}/>
      {reasons.length > 0 && <p className="tile-note">Most named: {reasons.map(entry => `${entry.reason} (${entry.n})`).join(', ')}</p>}
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
        <span>Open rate <b>{views ? percent(Math.round(opens * 1000 / views) / 10) : '—'}</b></span>
      </p>
    </>
  );
}

function StorageBody({ tile, threshold }: { tile: Tile; threshold?: Threshold }) {
  const kinds = Object.entries(tile.by_kind || {});
  const peak = Math.max(1, ...kinds.map(([, count]) => count));
  return (
    <>
      <b className="tile-number">{tile.state === 'unknown' ? '—' : humanBytes(tile.bytes)}</b>
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
      <span className="tile-unit">coins spent since midnight</span>
      <Spark points={tile.series || []}/>
      <Split items={[['7 days', num(tile.spent_week)], ['30 days', num(tile.spent_month)], ['Bought in 30 d', num(tile.credited_month)]]}/>
    </>
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

function AlertFeed({ alerts }: { alerts: Overview['alerts'] }) {
  const rows = alerts.recent;
  return (
    <section className="panel alerts">
      <header className="panel-head">
        <div>
          <h2>Alerts</h2>
          <p>Raised by the platform itself, from the queues and limits on this screen.</p>
        </div>
        <span className="panel-count">
          {alerts.counts.open} open · {alerts.counts.acked} acknowledged · {alerts.counts.resolved} resolved
        </span>
      </header>

      {!rows.length ? (
        <p className="empty-note">{IC.check} Nothing is asking for attention. Alerts appear the moment a queue ages past its limit.</p>
      ) : (
        <ul className="alert-list">
          {rows.map(row => <AlertItem key={row.key} row={row}/>)}
        </ul>
      )}
    </section>
  );
}

function AlertItem({ row }: { row: AlertRow }) {
  const target = row.status === 'open' && row.href && shipped(row.href) ? row.href : null;
  return (
    <li className={`alert alert-${row.severity} alert-${row.status}`}>
      <span className="alert-dot" title={SEVERITY_LABEL[row.severity] || row.severity}/>
      <div className="alert-body">
        <b>{row.title}</b>
        <p>{row.detail}</p>
        <span className="alert-meta">
          <span className={`pill ${row.status}`}>{row.status}</span>
          {row.occurrences > 1 && <span>seen {row.occurrences}× since {ago(row.first_seen)}</span>}
          <span>{ago(row.last_seen)}</span>
          {row.acked_by && <span>acknowledged by @{row.acked_by}</span>}
          {row.resolved_at && <span>cleared {ago(row.resolved_at)}</span>}
        </span>
      </div>
      {target
        ? <Link className="btn ghost alert-go" href={target}>Open{IC.go}</Link>
        : row.href && <span className="alert-here">{(row.href.split('?')[0] || '').slice(1).replace(/-/g, ' ')}</span>}
    </li>
  );
}

function Campaigns({ campaigns }: { campaigns: PromotionAnalytics | null }) {
  if (!campaigns) {
    return (
      <div className="skeleton-stack">
        <div className="skeleton"/><div className="skeleton"/><div className="skeleton skeleton-short"/>
      </div>
    );
  }
  if (!campaigns.rows.length) {
    return <p className="empty-note">{IC.chart} No campaign has been bought yet, so there is nothing to score.</p>;
  }

  const columns = campaigns.metrics;
  return (
    <>
      <div className="table-scroll">
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
            {campaigns.rows.map(row => (
              <tr key={row.id}>
                <th scope="row">
                  <b>{row.target_type} #{row.target.split(':')[1]}</b>
                  <em>{row.package || 'custom budget'} · {row.status} · live {waiting(row.minutes_live)}</em>
                  <span className="who">@{row.owner}</span>
                </th>
                {columns.map(metric => (
                  <td key={metric.id} data-metric={metric.id}
                      className={campaigns.unmeasured[metric.id] ? 'is-dim' : ''}>
                    {campaigns.unmeasured[metric.id]
                      ? <span title={campaigns.unmeasured[metric.id]}>—</span>
                      : num(row.metrics[metric.id])}
                  </td>
                ))}
                <td>{percent(row.click_rate)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">These {campaigns.shown} together</th>
              {columns.map(metric => (
                <td key={metric.id} className={campaigns.unmeasured[metric.id] ? 'is-dim' : ''}>
                  {campaigns.unmeasured[metric.id] ? '—' : num(campaigns.totals[metric.id])}
                </td>
              ))}
              <td>—</td>
            </tr>
          </tfoot>
        </table>
      </div>
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
