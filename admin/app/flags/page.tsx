'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import ConsoleShell from '@/components/ConsoleShell';
import { More } from '@/components/List';
import { api } from '@/lib/api';
import { num } from '@/lib/format';
import { IC } from '@/lib/icons';
import { ago, stamp } from '@/lib/time';
import { useSession } from '@/lib/session';
import { FlaggedPage, FlagRow } from '@/lib/types';

/**
 * Contract 6.9 — the flagged pile. Not "what has been filed" (that is the review
 * queue) but "what has already been pulled, by how many people, and from whom", plus
 * the accounts sitting under a pile of their own.
 *
 * The number that decides whether a post is on this list is a rule on the spam desk,
 * so it is printed at the top of the screen and linked: a list whose threshold nobody
 * can see is a list nobody can argue with.
 */

export default function FlagsScreen() {
  const { noteGate } = useSession();
  const [page, setPage] = useState<FlaggedPage | null>(null);
  const [rows, setRows] = useState<FlagRow[] | null>(null);
  const [at, setAt] = useState(0);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const seq = useRef(0);

  const fetchPage = useCallback((which: number) => api<FlaggedPage>(`admin/spam/flags/?page=${which}`), []);

  const load = useCallback(async () => {
    const mine = seq.current + 1;
    seq.current = mine;
    setBusy(true);
    try {
      const next = await fetchPage(0);
      if (seq.current !== mine) return;
      setRows(next.content);
      setPage(next);
      setAt(0);
      setMore(next.content_more);
    } catch (err) {
      if (seq.current !== mine) return;
      if (!noteGate(err)) {
        setRows([]);
        setBanner((err as Error).message);
      }
    } finally {
      if (seq.current === mine) setBusy(false);
    }
  }, [fetchPage, noteGate]);

  useEffect(() => {
    load();
  }, [load]);

  const older = async () => {
    if (!more) return;
    const mine = seq.current + 1;
    seq.current = mine;
    setBusy(true);
    try {
      const next = await fetchPage(at + 1);
      if (seq.current !== mine) return;
      setRows(list => [...(list || []), ...next.content]);
      setPage(next);
      setAt(at + 1);
      setMore(next.content_more);
    } catch (err) {
      if (seq.current !== mine) return;
      if (!noteGate(err)) setMore(false);
    } finally {
      if (seq.current === mine) setBusy(false);
    }
  };

  const held = (rows || []).filter(row => !row.live && !row.gone).length;

  return (
    <ConsoleShell
      title="Flagged content and accounts"
      subtitle="What the pile has already reached: posts pulled out of the feed on report counts alone, the accounts sitting under a pile of their own, and the words and links a post is refused for carrying."
      actions={(
        <button type="button" className={`btn ghost${busy ? ' spinning' : ''}`} onClick={() => load()} title="Read the pile again">
          {IC.refresh}<span>Refresh</span>
        </button>
      )}
    >
      {banner && (
        <p className="banner banner-bad" role="status">{IC.alert}<span>{banner}</span></p>
      )}

      {!page && rows === null && (
        <div className="skeleton-stack">
          <div className="skeleton"/><div className="skeleton"/><div className="skeleton skeleton-short"/>
        </div>
      )}

      {page && (
        <>
          <p className="facets" data-totals>
            <b>{num(page.content.length)}</b> targets at or over the pile
            <span className="dot"/>
            <b>{num(held)}</b> already out of the feed
            <span className="dot"/>
            <b>{num(page.accounts_total)}</b> account{page.accounts_total === 1 ? '' : 's'} flagged
            <span className="dot"/>
            <span>
              a pile of <b>{page.threshold}</b> distinct reporters is what pulls content out on its own —{' '}
              <Link href="/spam">change it on the spam desk</Link>
            </span>
          </p>

          <section className="panel" data-list="flagged-content">
            <div className="panel-head">
              <div>
                <h2>Content the pile reached</h2>
                <p>
                  Ordered by how many people said it, newest complaint first. The decision that clears a
                  row is made in the review queue, not here — this screen is the pile, and the queue is
                  the verdict.
                </p>
              </div>
              {page.can_review && (
                <Link className="btn ghost" href="/reports">{IC.flag}<span>Open the review queue</span></Link>
              )}
            </div>

            {rows === null || rows.length === 0 ? (
              <p className="empty-note">
                {IC.check}
                <span>
                  Nothing has reached {page.threshold} distinct reporters. Content only appears here once
                  the pile alone has pulled it out of the feed, or a post sits on that many open reports
                  without anybody having ruled on it.
                </span>
              </p>
            ) : (
              <div className="grid-wrap">
                <table className="grid review">
                  <thead>
                    <tr>
                      <th style={{ width: '17%' }}>Whose it is</th>
                      <th style={{ width: '10%' }}>What</th>
                      <th style={{ width: '12%' }}>The pile</th>
                      <th style={{ width: '27%' }}>What they said</th>
                      <th style={{ width: '12%' }}>Where it is now</th>
                      <th style={{ width: '10%' }}>Last reported</th>
                      <th style={{ width: '12%' }}>Decide it</th>
                    </tr>
                  </thead>
                  {rows.map(row => <Target key={`${row.kind}:${row.id}`} row={row} canReview={page.can_review}/>)}
                </table>
                <More hasMore={more} busy={busy} onMore={older} label="Show the next pile"/>
              </div>
            )}
          </section>

          <section className="panel" data-list="flagged-accounts">
            <div className="panel-head">
              <div>
                <h2>Accounts with a pile on them</h2>
                <p>
                  Reported as accounts, or the authors of enough reported content that the pattern is the
                  account’s. Nothing here suspends anybody: enforcement is a decision with a reason
                  attached, and it is made on the person’s own screen.
                </p>
              </div>
              <Link className="btn ghost" href="/people">{IC.users}<span>User directory</span></Link>
            </div>

            {page.accounts.length === 0 ? (
              <p className="empty-note">{IC.check}<span>No account is sitting under a pile right now.</span></p>
            ) : (
              <div className="grid-wrap">
                <table className="grid review">
                  <thead>
                    <tr>
                      <th style={{ width: '26%' }}>Account</th>
                      <th style={{ width: '14%' }}>On their person</th>
                      <th style={{ width: '14%' }}>On their content</th>
                      <th style={{ width: '14%' }}>Distinct reporters</th>
                      <th style={{ width: '16%' }}>State</th>
                      <th style={{ width: '16%' }}>Joined</th>
                    </tr>
                  </thead>
                  {page.accounts.map(person => <Account key={person.id} person={person}/>)}
                </table>
              </div>
            )}

            {page.accounts_total > 40 && (
              <p className="note">
                Showing the first 40 of <b>{page.accounts_total}</b>. The directory filters the rest the
                same way, and searches by name.
              </p>
            )}
          </section>

          <p className="note">
            The blocked-word and blocked-link lists are written once and read everywhere:{' '}
            <b>{page.words}</b> word{page.words === 1 ? '' : 's'} and <b>{page.links}</b> domain
            {page.links === 1 ? '' : 's'} are on the platform’s list, all of them editable from{' '}
            <Link href="/policy">Platform rules</Link>.
          </p>
        </>
      )}
    </ConsoleShell>
  );
}

function Target({ row, canReview }: { row: FlagRow; canReview: boolean }) {
  const queue = `/reports?target=${row.kind}&status=open`;
  const shelf = `/content?type=${row.kind}&state=taken_down`;
  return (
    <tbody className="entry" data-flag={`${row.kind}:${row.id}`}>
      <tr className="grid-row">
        <td>
          <span className="entry-who">
            {row.owner ? (
              <>
                <b>{row.owner.name}</b>
                <em>@{row.owner.username}{row.owner.verified ? ' ✓' : ''}</em>
              </>
            ) : <em className="dim">account gone</em>}
          </span>
        </td>
        <td>
          <span className={`kind kind-${row.kind}`}>{row.label}</span>
          <em className="coin-way">#{row.id}</em>
        </td>
        <td>
          <span className={`pile${row.live ? ' open' : ' shut'}`} title={`${row.reports} reports from ${row.reporters} people`}>
            <b>{row.reporters}</b>
            <span>{row.reporters === 1 ? 'reporter' : 'reporters'}</span>
          </span>
        </td>
        <td>
          <span className="case-why">
            {row.reasons.slice(0, 3).map(why => (
              <span className="chip" key={why.reason} title={`${why.n} report(s)`}>
                {why.reason.replace(/_/g, ' ')}&nbsp;{why.n}
              </span>
            ))}
            {row.reasons.length === 0 && <span className="dim">no reason recorded</span>}
          </span>
        </td>
        <td>
          <span className={`state ${row.gone ? 'mute' : row.live ? 'warn' : 'dead'}`} data-where={row.state}>
            {row.gone ? 'deleted' : row.state_word || row.state}
          </span>
        </td>
        <td className="dim" title={stamp(row.newest)}>{ago(row.newest)}</td>
        <td>
          <span className="grid-acts">
            {canReview && <Link className="btn ghost tiny" href={queue} title="Rule on every report on this target">{IC.flag}<span>Rule</span></Link>}
            {canReview && !row.live && !row.gone
              && <Link className="btn ghost tiny" href={shelf} title="Find it on the takedown shelf">{IC.shelf}<span>Shelf</span></Link>}
            {row.gone && <span className="case-age" title="The row the reports point at is gone; the complaints stay on the record.">row gone</span>}
          </span>
        </td>
      </tr>
    </tbody>
  );
}

function Account({ person }: { person: FlaggedPage['accounts'][number] }) {
  const state = person.suspension ? 'suspended' : person.locked_until ? 'locked out' : person.is_active ? 'active' : 'deactivated';
  return (
    <tbody className="entry" data-account={person.username}>
      <tr className="grid-row">
        <td>
          <span className="entry-who">
            <b>{person.name}</b>
            <em>@{person.username}{person.verified ? ' ✓' : ''}</em>
          </span>
        </td>
        <td className="num strong">{person.flags.on_account}</td>
        <td className="num">{person.flags.on_content}</td>
        <td className="num">{person.flags.reporters}</td>
        <td>
          <span className={`state ${state === 'active' ? 'good' : state === 'deactivated' ? 'mute' : 'dead'}`}>
            {state}
          </span>
        </td>
        <td className="dim" title={stamp(person.joined)}>{ago(person.joined)}</td>
      </tr>
    </tbody>
  );
}
