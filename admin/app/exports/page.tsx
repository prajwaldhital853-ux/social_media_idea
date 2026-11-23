'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ConsoleShell from '@/components/ConsoleShell';
import { api, saveFile, SavedFile } from '@/lib/api';
import { num } from '@/lib/format';
import { IC } from '@/lib/icons';
import { ago, stamp } from '@/lib/time';
import { useSession } from '@/lib/session';
import { AuditLine, ExportFile, ExportIndex } from '@/lib/types';

/**
 * Contract 6.9 — the five files a seat hands to an accountant.
 *
 * Users, Reports, Coin Requests, Coin Ledger, Promotions. The screen answers two
 * questions in that order: *what would this file contain* — the row count under the
 * window, the column names, the cap — and then *give it to me*. A CSV you cannot
 * inspect before downloading is a CSV you end up apologising for.
 *
 * Every build writes its own audit row, so the bottom of the screen is the record of
 * who took a file of other people’s email addresses and when. That is the half of the
 * promise that makes the download a staff action rather than a query.
 */

export default function ExportsScreen() {
  const { noteGate } = useSession();
  const [index, setIndex] = useState<ExportIndex | null>(null);
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, SavedFile>>({});
  const seq = useRef(0);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (since.trim()) params.set('since', since.trim());
    if (until.trim()) params.set('until', until.trim());
    const text = params.toString();
    return text ? `?${text}` : '';
  }, [since, until]);

  const load = useCallback(async () => {
    // One request per keystroke, and the answers come back in no particular order:
    // typing `2026-11-20` sends `2`, then `20`, then `202`… and every one of those is
    // a date the door refuses. Without a sequence number an old refusal can land after
    // the real answer and become the sentence on the screen, so a window typed
    // backwards would be reported as a badly spelled date.
    const mine = seq.current + 1;
    seq.current = mine;
    setBusy('read');
    try {
      const next = await api<ExportIndex>(`admin/exports/${query}`);
      if (seq.current !== mine) return;
      setIndex(next);
      setBanner(null);
    } catch (err) {
      if (seq.current !== mine) return;
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    } finally {
      if (seq.current === mine) setBusy(null);
    }
  }, [query, noteGate]);

  useEffect(() => {
    load();
  }, [load]);

  const download = async (file: ExportFile) => {
    setBusy(file.id);
    try {
      const body = { ...(since.trim() ? { since: since.trim() } : {}), ...(until.trim() ? { until: until.trim() } : {}) };
      const out = await saveFile(`admin/exports/${file.id}/`, body);
      setSaved(all => ({ ...all, [file.id]: out }));
      setBanner({
        kind: 'ok',
        text: `${out.filename} — ${num(out.rows)} row(s). The build is in the audit log with your name on it.`,
      });
      await load();
    } catch (err) {
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const total = (index?.files || []).reduce((all, file) => all + file.rows, 0);

  return (
    <ConsoleShell
      title="CSV exports"
      subtitle="Members, reports, coin requests, the coin ledger and paid campaigns — the five tables an accountant, a lawyer or an auditor asks for, built from the same rows the screens read, and logged as a staff action the moment one is taken."
      actions={(
        <button type="button" className={`btn ghost${busy === 'read' ? ' spinning' : ''}`} onClick={() => load()} title="Count the rows again">
          {IC.refresh}<span>Re-count</span>
        </button>
      )}
    >
      <div className="toolbar">
        <label className="dates">
          <span>From</span>
          <input
            value={since} onChange={event => setSince(event.target.value)}
            placeholder="2026-11-01" aria-label="Rows from this date" autoComplete="off" maxLength={10}
          />
          <span>to</span>
          <input
            value={until} onChange={event => setUntil(event.target.value)}
            placeholder="2026-11-22" aria-label="Rows up to this date" autoComplete="off" maxLength={10}
          />
        </label>
        <span className="toolbar-count">
          {index === null ? '…' : <><b>{num(total)}</b> rows across the five files</>}
        </span>
      </div>

      {banner && (
        <p className={`banner banner-${banner.kind}`} role="status">
          {banner.kind === 'ok' ? IC.check : IC.alert}<span>{banner.text}</span>
        </p>
      )}

      {index === null ? (
        <div className="skeleton-stack">
          <div className="skeleton"/><div className="skeleton"/><div className="skeleton skeleton-short"/>
        </div>
      ) : (
        <>
          <p className="facets" data-totals>
            <span>
              {index.window.since || index.window.until
                ? <>Window: <b>{index.window.since || 'the beginning'}</b> to <b>{index.window.until || 'right now'}</b></>
                : 'No window typed — every file would hold every row the table has'}
            </span>
            <span className="dot"/>
            <span>a file is cut at <b>{num(index.cap)}</b> rows and says so rather than handing over half a table</span>
          </p>

          <div className="grid-wrap">
            <table className="grid review" data-list="exports">
              <thead>
                <tr>
                  <th style={{ width: '18%' }}>File</th>
                  <th style={{ width: '34%' }}>What it holds</th>
                  <th style={{ width: '10%' }}>Rows now</th>
                  <th style={{ width: '10%' }}>Columns</th>
                  <th style={{ width: '28%' }}>Take it</th>
                </tr>
              </thead>
              {index.files.map(file => (
                <Entry
                  key={file.id} file={file} busy={busy}
                  saved={saved[file.id]}
                  onDownload={() => download(file)}
                />
              ))}
            </table>
          </div>

          <section className="panel" data-list="exports-taken">
            <div className="panel-head">
              <div>
                <h2>Files taken from this console</h2>
                <p>
                  The last twelve, straight out of the audit log: who built one, how many rows it held, and
                  the window it was cut to. A download cannot be unsaid, so it is written down.
                </p>
              </div>
            </div>

            {index.taken.length === 0 ? (
              <p className="empty-note">{IC.x}<span>No file has been taken from the console yet.</span></p>
            ) : (
              <ul className="terms">
                {index.taken.map(row => (
                  <li className="term" key={row.id} data-taken={row.id}>
                    <div className="term-body">
                      <b className="term-text">{row.by}</b>
                      <em className="term-note">{row.detail}</em>
                      <span className="term-meta" title={stamp(row.created_at)}>{ago(row.created_at)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="note">
            A date with no clock on it means the whole day, so “to 2026-11-22” keeps the last second of the
            22nd rather than dropping it. The columns are named in words somebody outside this platform
            can read, because the file is the thing that gets handed over.
          </p>
        </>
      )}
    </ConsoleShell>
  );
}

function Entry({ file, busy, saved, onDownload }: {
  file: ExportFile;
  busy: string | null;
  saved?: SavedFile;
  onDownload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const shown = open || !!saved;
  return (
    <tbody className={`entry${shown ? ' open' : ''}`} data-export={file.id}>
      <tr className={`grid-row${shown ? ' open' : ''}`}>
        <td>
          <button type="button" className="case-id" aria-expanded={shown} onClick={() => setOpen(v => !v)}>
            <span className="grid-caret">{IC.chevron}</span>
            <span className="case-name">
              <b>{file.label}</b>
              <em className="case-line dim">{file.id}</em>
            </span>
          </button>
        </td>
        <td>
          <span className="entry-note" title={file.blurb}>{file.blurb}</span>
        </td>
        <td className="num strong">{num(file.rows)}</td>
        <td className="num dim" title={file.columns.join(', ')}>{file.columns.length}</td>
        <td>
          <span className="grid-acts">
            <button type="button" className="btn primary tiny" data-download={file.id} disabled={busy !== null} onClick={onDownload}>
              {busy === file.id ? IC.refresh : IC.download}<span>{busy === file.id ? 'Building…' : 'Download CSV'}</span>
            </button>
          </span>
        </td>
      </tr>
      {shown && (
        <tr className="grid-detail">
          <td colSpan={5}>
            <div className="grid-body">
              <div>
                <h3>Columns, in the order the file writes them</h3>
                <span className="case-why">
                  {file.columns.map(column => <span className="chip" key={column}>{column}</span>)}
                </span>
              </div>
              <div className="person-side">
                <h3>Who is asked to trust it</h3>
                {saved ? (
                  <p className="coin-by" data-saved={file.id}>
                    <b>{saved.filename}</b> — {num(saved.rows)} rows, {num(Math.round(saved.bytes / 1024))} KB
                    {saved.truncated ? ' — cut at the cap, narrow the dates for the rest' : ''}
                    <em className="coin-way">{saved.head}</em>
                  </p>
                ) : (
                  <p className="coin-by dim">
                    Nothing has been built from this window yet. Counting the rows above is a read; a
                    download is a staff action, and the build writes its own log row.
                  </p>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </tbody>
  );
}
