'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Banner from '@/components/Banner';
import { useConfirm } from '@/components/Confirm';
import ConsoleShell from '@/components/ConsoleShell';
import { Chips } from '@/components/List';
import { api } from '@/lib/api';
import { num } from '@/lib/format';
import { IC } from '@/lib/icons';
import { ago, stamp } from '@/lib/time';
import { useSession } from '@/lib/session';
import { shipped } from '@/lib/nav';
import { AlertDesk, AlertPulse, AlertRow, SettingLine } from '@/lib/types';

/**
 * Contract 6.9 — the alert history and the dials behind it.
 *
 * Two halves, because the contract asks two different questions. The list is what
 * the platform concluded on its own, when, and how many times since; the dials are
 * when it is allowed to conclude it. The third thing on the screen is the honest
 * part: four conditions the contract names that nothing outside this codebase
 * reports on yet, listed as wires rather than as numbers, because a silent backup
 * job and a healthy one look identical from an empty row.
 *
 * Nothing here fires on a page load — the dashboard already runs the checks — so
 * "Run the checks" is a button a person presses, and what it raised is written to
 * the audit log with their name on it.
 */

const MOVES = [
  { id: 'all', label: 'Every alert' },
  { id: 'open', label: 'Still true' },
  { id: 'acked', label: 'Acknowledged' },
  { id: 'resolved', label: 'Cleared' },
];

const SEVERITY_LABEL: Record<string, string> = { info: 'Note', warning: 'Needs a look', critical: 'Urgent' };

export default function AlertsScreen() {
  const { noteGate, session } = useSession();
  const confirm = useConfirm();
  const [desk, setDesk] = useState<AlertDesk | null>(null);
  const [status, setStatus] = useState('all');
  const [kind, setKind] = useState('');
  const [severity, setSeverity] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (status !== 'all') params.set('status', status);
    if (kind) params.set('kind', kind);
    if (severity) params.set('severity', severity);
    params.set('limit', '200');
    return params.toString();
  }, [status, kind, severity]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setDesk(await api<AlertDesk>(`admin/alerts/?${query}`));
      setBanner(null);
    } catch (err) {
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }, [query, noteGate]);

  useEffect(() => {
    load();
  }, [load]);

  const scan = async () => {
    const sure = await confirm({
      title: 'Run every check again now?',
      body: 'This reads the live counts and writes whatever it finds as new alerts, then closes conditions it no longer believes. The run is written to the audit log with your name on it, so a check you ran twice looks like two checks.',
      confirmLabel: 'Run the checks',
      tone: 'amber',
    });
    if (!sure) return;
    setScanning(true);
    try {
      const out = await api<{ detail: string; raised: AlertRow[] }>('admin/alerts/scan/', { method: 'POST', body: {} });
      setBanner({ kind: 'ok', text: `${out.detail} ${out.raised.length} condition(s) true after this run.` });
      await load();
    } catch (err) {
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    } finally {
      setScanning(false);
    }
  };

  const mark = async (row: AlertRow, to: 'ack' | 'resolve') => {
    if (to === 'resolve') {
      const sure = await confirm({
        title: `Close “${row.title}”?`,
        body: 'Resolved says the condition is over. It does not silence the check: if the numbers are still past the threshold, the next run raises this same alert again with a higher count. The row is kept either way.',
        confirmLabel: 'Mark it resolved',
        tone: 'amber',
      });
      if (!sure) return;
    }
    try {
      const out = await api<{ detail: string; alert: AlertRow }>(`admin/alerts/${row.id}/mark/`, {
        method: 'POST', body: { to },
      });
      setDesk(current => (current ? {
        ...current,
        rows: current.rows.map(item => (item.id === row.id ? out.alert : item)),
        counts: {
          ...current.counts,
          open: current.counts.open - (row.status === 'open' ? 1 : 0) + (out.alert.status === 'open' ? 1 : 0),
          acked: current.counts.acked - (row.status === 'acked' ? 1 : 0) + (out.alert.status === 'acked' ? 1 : 0),
          resolved: current.counts.resolved
            - (row.status === 'resolved' ? 1 : 0) + (out.alert.status === 'resolved' ? 1 : 0),
        },
      } : current));
      setBanner({ kind: 'ok', text: out.detail });
    } catch (err) {
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    }
  };

  const lines = desk?.thresholds || [];
  const baseOf = (item: SettingLine) => String(item.value ?? '');
  const valueOf = (item: SettingLine) => draft[item.key] ?? baseOf(item);
  const touched = lines.filter(item => valueOf(item) !== baseOf(item));
  const dirty = touched.length > 0;

  const saveDials = async () => {
    const sure = await confirm({
      title: `Move ${touched.length} alert threshold(s)?`,
      body: 'The checks read these the next time they run. Raising a number closes whatever the platform no longer believes; lowering one can turn a quiet day into several alerts at once, all of them stamped with this change.',
      confirmLabel: 'Save the thresholds',
      tone: 'amber',
    });
    if (!sure) return;
    setBusy(true);
    try {
      const body = touched.reduce((all, item) => ({ ...all, [item.key]: valueOf(item) }), {} as Record<string, string>);
      const out = await api<{ detail: string; changed: string[] }>('admin/alerts/thresholds/', { method: 'POST', body });
      setBanner({ kind: 'ok', text: out.detail });
      setDraft({});
      setDesk(await api<AlertDesk>(`admin/alerts/?${query}`));
    } catch (err) {
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const rows = desk?.rows || [];
  const unwired = (desk?.pulses || []).filter(pulse => !pulse.wired).length;

  return (
    <ConsoleShell
      title="Automated alerts"
      subtitle="Every condition the platform raised on its own — spam waves, report spikes, queues ageing, payment proofs waiting, storage and login attacks, processing backlogs and unusual Coin activity — the thresholds that decide when they fire, and the wires nothing reports on yet."
      actions={(
        <>
          <button
            type="button" className={`btn ghost${scanning ? ' spinning' : ''}`} data-scan
            disabled={scanning || busy} onClick={scan}
            title="Run every check again. The result is written to the audit log with your name on it."
          >
            {IC.pulse}<span>{scanning ? 'Checking…' : 'Run the checks'}</span>
          </button>
          <button type="button" className={`btn ghost${busy ? ' spinning' : ''}`} onClick={() => { load(); setDraft({}); }} title="Read the history again">
            {IC.refresh}<span>Refresh</span>
          </button>
        </>
      )}
    >
      <Banner banner={banner} />

      {!desk ? (
        <div className="skeleton-stack">
          <div className="skeleton"/><div className="skeleton"/><div className="skeleton skeleton-short"/>
        </div>
      ) : (
        <>
          <p className="facets" data-totals>
            <b>{num(desk.counts.attention)}</b> need a look
            <span className="dot"/>
            <b>{num(desk.counts.open)}</b> still true
            <span className="dot"/>
            <b>{num(desk.counts.acked)}</b> acknowledged
            <span className="dot"/>
            <b>{num(desk.counts.resolved)}</b> cleared
            <span className="dot"/>
            <span>
              {desk.counts.unwired} row{desk.counts.unwired === 1 ? '' : 's'} {unwired === 1 ? 'is' : 'are'} a wire
              that nothing has reported on yet — counted apart, because four unconnected sensors are not
              four fires
            </span>
          </p>

          <Chips
            label="Filter the history by whether it is still true"
            chips={MOVES.map(item => ({
              id: item.id,
              label: item.label,
              n: item.id === 'all' ? rows.length
                : item.id === 'open' ? desk.counts.open
                  : item.id === 'acked' ? desk.counts.acked : desk.counts.resolved,
            }))}
            value={status}
            onPick={setStatus}
          />

          <div className="toolbar">
            <select value={kind} onChange={event => setKind(event.target.value)} aria-label="Filter by condition">
              <option value="">Every condition</option>
              {desk.kinds.map(item => (
                <option key={item.kind} value={item.kind}>
                  {item.label} — {item.n} ({item.active} live)
                </option>
              ))}
            </select>
            <select value={severity} onChange={event => setSeverity(event.target.value)} aria-label="Filter by severity">
              <option value="">Any severity</option>
              {desk.severities.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            <span className="toolbar-count">
              Rows on screen: <b>{desk.shown}</b> of {num(desk.counts.open + desk.counts.acked + desk.counts.resolved)}
            </span>
          </div>

          <section className="panel" data-list="alerts">
            {rows.length === 0 ? (
              <p className="empty-note">
                {IC.check}
                <span>
                  Nothing matches this filter. The checks run with the dashboard, and the button above
                  runs them again right now — an alert appears the moment a queue ages past its limit.
                </span>
              </p>
            ) : (
              <div className="grid-wrap">
                <table className="grid review">
                  <thead>
                    <tr>
                      <th style={{ width: '30%' }}>What it says</th>
                      <th style={{ width: '15%' }}>Condition</th>
                      <th style={{ width: '11%' }}>Severity</th>
                      <th style={{ width: '10%' }}>Status</th>
                      <th style={{ width: '10%' }}>Seen</th>
                      <th style={{ width: '12%' }}>Last true</th>
                      <th style={{ width: '12%' }}>Say about it</th>
                    </tr>
                  </thead>
                  {rows.map(row => <Row key={row.id} row={row} mark={mark} busy={busy} seat={session}/>)}
                </table>
              </div>
            )}
            <p className="note">
              Acknowledging says a person has read it; resolving says the condition is over. Neither edits
              a row: a check that is still true raises the same alert again on the next run, and the
              count of times it has been true stays on the record.
            </p>
          </section>

          <div className="policy-grid">
            <section className="panel" data-alerts="dials">
              <div className="panel-head">
                <div>
                  <h2>When something becomes an alert</h2>
                  <p>
                    Every dial is read by the check named beside it. Raising one closes whatever the
                    platform no longer believes on the next run — that is written down, not made to
                    disappear.
                  </p>
                </div>
              </div>

              <div className="desk-grid">
                {lines.map(item => (
                  <label className="field" data-knob={item.key} key={item.key}>
                    <span>{item.label}</span>
                    <input
                      name={item.key} value={valueOf(item)} autoComplete="off" maxLength={9}
                      inputMode="decimal" placeholder={String(item.default)}
                      onChange={event => setDraft({ ...draft, [item.key]: event.target.value.replace(/[^\d.]/g, '') })}
                    />
                    <em className="desk-who">
                      {item.set
                        ? <>turned by <b>{item.by}</b> {ago(item.at || '')} — {item.help}</>
                        : <>never moved from the platform’s own answer — {item.help}</>}
                    </em>
                  </label>
                ))}
              </div>

              <div className="ask-actions">
                <button
                  type="button" className="btn primary" data-thresholds-save
                  disabled={busy || !dirty} onClick={saveDials}
                  title={dirty ? 'Write these to the platform' : 'Nothing has changed yet'}
                >
                  {IC.check}<span>{busy ? 'Working…' : 'Save the thresholds'}</span>
                </button>
                {dirty && (
                  <button type="button" className="btn ghost" disabled={busy} onClick={() => setDraft({})}>
                    <span>Undo my typing</span>
                  </button>
                )}
              </div>
            </section>

            <section className="panel" data-alerts="wires">
              <div className="panel-head">
                <div>
                  <h2>What nothing reports on yet</h2>
                  <p>
                    Site down, backup failure, app errors and the processing queue are conditions this
                    console can be told about — but only from outside. Until something stamps in, the row
                    says so in words instead of leaving an empty space that looks like a quiet day.
                  </p>
                </div>
              </div>

              <ul className="terms">
                {desk.pulses.map(pulse => <Wire key={pulse.key} pulse={pulse} seat={session}/>)}
              </ul>

              <h3 className="desk-sub">What the platform can measure about itself</h3>
              <div className={`health health-${desk.health.state}`}>
                <span className="health-summary">
                  {desk.health.state === 'ok' ? IC.check : IC.alert}
                  <b>{desk.health.state === 'ok' ? 'Every check answering' : 'Some checks need a look'}</b>
                </span>
                <ul className="health-list">
                  {desk.health.checks.map(check => (
                    <li key={check.id} className={`health-item health-${check.state}`} title={check.detail}>
                      <span className="health-dot"/>
                      <span>{check.label}</span>
                      <em>{check.state}</em>
                    </li>
                  ))}
                </ul>
              </div>

              <p className="panel-foot">
                {IC.disk}
                <span>
                  A stamp is one command away: <span className="cmd">python manage.py adminpulse &lt;key&gt;
                  --state=ok --detail="what it saw"</span>. Whatever runs it — cron, a CI job, the backup
                  script — the console only needs to hear from it before its own clock runs out.
                </span>
              </p>
            </section>
          </div>
        </>
      )}
    </ConsoleShell>
  );
}

function Row({ row, mark, busy, seat }: {
  row: AlertRow;
  mark: (row: AlertRow, to: 'ack' | 'resolve') => Promise<void>;
  busy: boolean;
  seat: ReturnType<typeof useSession>['session'];
}) {
  const where = row.href && shipped(row.href, seat?.permissions || [], seat?.role) ? row.href : null;
  return (
    <tbody className="entry" data-alert={row.id}>
      <tr className="grid-row">
        <td>
          <span className="case-name">
            <b>{row.title}</b>
            <em className="case-line" title={row.detail}>{row.detail}</em>
          </span>
        </td>
        <td className="dim">{row.kind.replace(/_/g, ' ')}</td>
        <td>
          <span className={`state ${row.severity === 'critical' ? 'dead' : row.severity === 'warning' ? 'warn' : 'mute'}`}>
            {SEVERITY_LABEL[row.severity] || row.severity}
          </span>
        </td>
        <td><span className={`pill ${row.status}`}>{row.status}</span></td>
        <td className="num" title={`First seen ${stamp(row.first_seen)}`}>
          {row.occurrences > 1 ? `${row.occurrences}×` : 'once'}
        </td>
        <td className="dim" title={stamp(row.last_seen)}>{ago(row.last_seen)}</td>
        <td>
          <span className="grid-acts">
            {where && <Link className="btn ghost tiny" href={where}>{IC.go}<span>Open</span></Link>}
            {row.status === 'open' && (
              <button type="button" className="btn ghost tiny" data-ack={row.id} disabled={busy} onClick={() => mark(row, 'ack')}>
                <span>Acknowledge</span>
              </button>
            )}
            {row.status !== 'resolved' && (
              <button type="button" className="btn ghost tiny" data-resolve={row.id} disabled={busy} onClick={() => mark(row, 'resolve')}>
                <span>Resolved</span>
              </button>
            )}
            {row.status === 'acked' && row.acked_by && (
              <span className="case-age" title={`Acknowledged by ${row.acked_by}`}>@{row.acked_by}</span>
            )}
          </span>
        </td>
      </tr>
    </tbody>
  );
}

function Wire({ pulse, seat }: { pulse: AlertPulse; seat: ReturnType<typeof useSession>['session'] }) {
  const quiet = pulse.quiet_after !== null
    ? `silent for more than ${pulse.quiet_after} ${pulse.quiet_unit}`
    : `more than ${pulse.counted_at} counted in an hour`;
  const where = shipped(pulse.href, seat?.permissions || [], seat?.role) ? pulse.href : null;
  return (
    <li className={`term${pulse.wired ? '' : ' off'}`} data-wire={pulse.key} data-wired={pulse.wired ? '1' : '0'}>
      <div className="term-body">
        <b className="term-text">{pulse.label}</b>
        <em className="term-note">
          {pulse.wired
            ? <>last heard from <b>{ago(pulse.stamped_at)}</b> — {pulse.state}, {pulse.detail || 'nothing added'} ({pulse.stamps} stamp{pulse.stamps === 1 ? '' : 's'})</>
            : <>never reported in — {pulse.silent}</>}
        </em>
        <span className="term-meta">
          {pulse.wired ? '' : `would fire if ${quiet}`}
          {where && <>&nbsp;</>}
          {where && <Link href={where} className="link">open it</Link>}
        </span>
      </div>
    </li>
  );
}
