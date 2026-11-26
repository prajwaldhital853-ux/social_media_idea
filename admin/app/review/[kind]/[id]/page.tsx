'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Banner from '@/components/Banner';
import ConsoleShell from '@/components/ConsoleShell';
import ContentCard from '@/components/ContentCard';
import DecisionBar from '@/components/Decision';
import { useConfirm } from '@/components/Confirm';
import { api } from '@/lib/api';
import { IC } from '@/lib/icons';
import { useAdminEvent } from '@/lib/live';
import { ago, stamp } from '@/lib/time';
import { useSession } from '@/lib/session';
import { AsideVerb, ContentKind, Decision as Verb, NoticeRow, Outcome, ReviewCase } from '@/lib/types';

const KINDS: ContentKind[] = ['post', 'comment', 'listing', 'user'];

const KIND_LABEL: Record<string, string> = {
  post: 'Post', comment: 'Comment', listing: 'Listing', user: 'Account',
};

const VERB_LABEL: Record<string, string> = {
  dismiss_reports: 'Left it up',
  remove_content: 'Took it down',
  public_notice: 'Put a warning notice on it',
  attach_notice: 'Put a notice on it',
  withdraw_notice: 'Withdrew a notice',
  release_content: 'Released it back to the feed',
  restore_content: 'Restored it',
};

/**
 * One thing, opened as a page of its own.
 *
 * The queue row says how big the pile is and the shelf row says what took it
 * down; neither has room for the forty reports behind a photograph or for the
 * trail of decisions a listing has been through. Both desks land here, so the
 * five verbs are decided against one screen that shows the whole of it.
 */
export default function ReviewCasePage({ params }: { params: { kind: string; id: string } }) {
  const { status, noteGate, can } = useSession();
  const confirm = useConfirm();
  const [detail, setDetail] = useState<ReviewCase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [withdrawing, setWithdrawing] = useState<number | null>(null);

  const known = KINDS.includes(params.kind as ContentKind);

  const load = useCallback(async () => {
    if (!known) return;
    setBusy(true);
    try {
      setDetail(await api<ReviewCase>(`admin/review/case/?target=${encodeURIComponent(`${params.kind}:${params.id}`)}`));
      setError(null);
    } catch (err) {
      if (!noteGate(err)) setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [known, noteGate, params.id, params.kind]);

  useEffect(() => {
    if (status === 'in') load();
  }, [load, status]);

  useAdminEvent(known
    ? ['comment', 'reaction', 'post_new', 'audit', 'staff_notice']
    : [], load, pulse => {
    const same = (id: string | number | undefined) => id !== undefined && String(id) === params.id;
    if (pulse.kind === 'audit') return true;
    if (pulse.kind === 'staff_notice') {
      return pulse.notice_kind === 'report' || pulse.route.split('?')[0].replace(/\/+$/, '') === '/reports';
    }
    if (pulse.kind === 'post_new') return params.kind === 'post' && same(pulse.id);
    if (pulse.kind === 'comment') {
      if (params.kind === 'post') return same(pulse.post_id);
      return params.kind === 'comment'
        && [pulse.comment_id, pulse.parent_id, ...(pulse.deleted_ids || [])].some(id => same(id));
    }
    if (pulse.kind === 'reaction') {
      const target = pulse.target ?? pulse.target_type;
      const id = pulse.id ?? pulse.target_id;
      if (params.kind === 'comment') return target === 'comment' && same(id);
      return params.kind === 'post' && (same(pulse.post_id) || (target === 'post' && same(id)));
    }
    return false;
  });

  const decide = async (verb: Verb, reason: string, notice: string, audience: string) =>
    api<Outcome>(detail!.reports.length
      ? `admin/review/${detail!.reports[0].id}/decide/`
      : `admin/content/${params.kind}/${params.id}/`, {
      method: 'POST',
      body: { action: verb, reason, notice, audience },
    });

  const standing = (detail?.notices || []).filter(notice => notice.is_live);

  /** The aside's withdraw verb asks at the notices door, not the decide door:
   * every sentence still standing on this target comes down, each one kept on
   * the record with the seat's name beside it. */
  const withdrawAll = async (): Promise<Outcome> => {
    for (const notice of standing) {
      // `tell: false`, because this is one verb over several rows: three letters
      // about one post is three letters too many, and the line below already says
      // what happened.
      await api<NoticeRow>(`admin/notices/${notice.id}/withdraw/`, { method: 'POST', body: { tell: false } });
    }
    return {
      action: 'withdraw', kind: detail!.kind, target: detail!.target, content: detail!.content,
      reports_closed: 0, campaigns: [], refunded: '0', notice: null,
      detail: `${standing.length} warning notice(s) withdrawn. The author is not told again.`,
    };
  };

  const run = (verb: AsideVerb, reason: string, notice: string, audience: string) =>
    (verb === 'withdraw' ? withdrawAll() : decide(verb, reason, notice, audience));

  const handled = (out: Outcome) => {
    setBanner({ kind: 'ok', text: out.detail });
    load();
  };

  const withdrawNotice = async (notice: NoticeRow) => {
    const sure = await confirm({
      title: 'Withdraw this notice?',
      body: `The sentence about @${notice.about} stops showing on this ${notice.target_type}. It stays on the record, marked withdrawn, with your name on it. `
        + `@${notice.about} is told in their bell and at their email address that it has been taken back.`,
      confirmLabel: 'Withdraw',
      tone: 'danger',
    });
    if (!sure) return;
    setWithdrawing(notice.id);
    setBanner(null);
    try {
      const out = await api<{ detail?: string }>(`admin/notices/${notice.id}/withdraw/`, { method: 'POST', body: {} });
      setBanner({ kind: 'ok', text: out.detail || `The notice about @${notice.about} is withdrawn. The audit row says who took it down.` });
      await load();
    } catch (err) {
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    } finally {
      setWithdrawing(null);
    }
  };

  const author = detail?.content?.author;
  const titled = detail ? `${KIND_LABEL[detail.kind]} #${detail.id}` : `${KIND_LABEL[params.kind] || params.kind} #${params.id}`;

  return (
    <ConsoleShell
      title={titled}
      subtitle={detail
        ? `${author ? `@${author.username} · ` : ''}${detail.pile.open} report(s) waiting of ${detail.pile.reports} filed · ${detail.pile.reporters} reporter(s)`
        : known ? 'The thing, every report on it, and everything staff have done to it.' : 'This is not a thing the console can open.'}
      actions={(
        <>
          {author && (
            <Link href={`/people/${author.username}`} className="btn ghost">
              {IC.users}<span>Their account</span>
            </Link>
          )}
          <button
            type="button" className={`btn ghost${busy ? ' spinning' : ''}`}
            onClick={load} title="Read it again from the server"
          >
            {IC.refresh}<span>Refresh</span>
          </button>
        </>
      )}
    >
      <Banner banner={banner} />

      {!detail && !error && (
        <div className="skeleton-stack">
          <div className="skeleton"/><div className="skeleton"/><div className="skeleton skeleton-short"/>
        </div>
      )}

      {(error || !known) && !detail && (
        <section className="panel empty">
          <h2>This is not here</h2>
          <p>{error || 'Open a report from the queue or a row from the takedown shelf.'}</p>
        </section>
      )}

      {detail && (
        <div className="record">
          <div className="record-main">
            <Section title="The thing itself">
              <ContentCard content={detail.content} matched={detail.matches}/>
              {detail.missing && (
                <p className="note row">
                  {IC.alert}
                  <span>
                    This was deleted after it was reported. The reports still count until a seat
                    dismisses them, but there is nothing left to take down or put back.
                  </span>
                </p>
              )}
              {detail.campaigns > 0 && (
                <p className="note row">
                  {IC.coin}
                  <span>
                    {detail.campaigns} paid campaign(s) are running or paused on this. Taking it
                    down stops them and refunds the days they never got to run.
                  </span>
                </p>
              )}
            </Section>

            <Section title={`Why people reported it (${detail.reports.length})`}>
              {detail.reports.length === 0
                ? <p className="note">Nobody reported this. It is on the shelf because a seat took it down.</p>
                : (
                  <ul className="reporters">
                    {detail.reports.map(report => (
                      <li key={report.id}>
                        <b>{report.reason}</b>
                        <em>
                          {report.reporter
                            ? <Link href={`/people/${report.reporter.username}`}>@{report.reporter.username}</Link>
                            : 'deleted account'}
                          {' · '}{report.status} · {ago(report.created_at)}
                        </em>
                        {report.details && <span className="ctext">{report.details}</span>}
                        <span className="when">{stamp(report.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
            </Section>

            <Section title={`Notices standing on it (${detail.notices.length})`}>
              {detail.notices.length === 0
                ? <p className="note">No warning notice has been put on this content.</p>
                : (
                  <ul className="reporters">
                    {detail.notices.map(notice => (
                      <li key={notice.id}>
                        <b>{notice.text}</b>
                        <em>
                          {notice.is_live ? 'standing' : 'withdrawn'} · {notice.audience} · put there by {' '}
                          {notice.actor ? `@${notice.actor}` : 'staff'} · {ago(notice.created_at)}
                        </em>
                        {notice.reason && <span className="ctext">{notice.reason}</span>}
                        {notice.is_live && can('notices') && (
                          <div className="notice-act">
                            <button
                              type="button" className="btn danger outline tiny"
                              disabled={busy || withdrawing !== null}
                              onClick={() => withdrawNotice(notice)}
                            >
                              {IC.x}<span>{withdrawing === notice.id ? 'Working…' : 'Withdraw notice'}</span>
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
            </Section>

            <Section title="What staff have done to it">
              {detail.history.length === 0
                ? <p className="note">No decision has been recorded against this yet.</p>
                : (
                  <ul className="record-list">
                    {detail.history.map(entry => (
                      <li key={entry.id} className="record-item">
                        <span>
                          <span className="record-text">
                            <b>{VERB_LABEL[entry.action] || entry.action}</b>
                            {', '}{entry.detail || 'no reason was written'}
                          </span>
                          <span className="record-meta">
                            {entry.actor ? `@${entry.actor}` : 'system'} · {ago(entry.at)} · {stamp(entry.at)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
            </Section>
          </div>

          <aside className="record-acts">
            <h3>Decide</h3>
            <DecisionBar
              actions={detail.actions}
              permission={detail.permission}
              standing={standing.length}
              target={detail.target}
              run={run}
              onDone={handled}
              footnote={detail.pile.open > 0
                ? `One click here answers all ${detail.pile.open} open report(s) on ${detail.target}, not only the one you opened.`
                : `Every report on ${detail.target} is already answered. What you sign here speaks for the content alone.`}
            />
            <p className="fineprint">
              The reason you type goes to the author, and the audit row keeps it with your name
              beside it. Choose whether a warning is public or private, and withdraw takes that
              sentence back down again. Restore and Release put the thing back exactly as it was.
            </p>
          </aside>
        </div>
      )}
    </ConsoleShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel record-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
