'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Banner from '@/components/Banner';
import ConsoleShell from '@/components/ConsoleShell';
import ContentCard from '@/components/ContentCard';
import { useConfirm } from '@/components/Confirm';
import { api } from '@/lib/api';
import { num } from '@/lib/format';
import { IC } from '@/lib/icons';
import { ago, stamp } from '@/lib/time';
import { useSession } from '@/lib/session';
import { PromoDetail, PromoRow } from '@/lib/types';

const STAMP: Record<string, { tone: string; label: string }> = {
  draft: { tone: 'mute', label: 'Never ordered' },
  pending: { tone: 'warn', label: 'Waiting for approval' },
  active: { tone: 'good', label: 'Running' },
  paused: { tone: 'warn', label: 'Paused' },
  rejected: { tone: 'dead', label: 'Refused' },
  ended: { tone: 'mute', label: 'Ended' },
};

type Verb = 'approve' | 'pause' | 'resume' | 'reject' | 'stop';

/**
 * An order that has not been approved has no run to pause and no money to hand
 * back, so the only two things a seat can do to it are take the coins or refuse.
 */
function verbsFor(row: PromoRow): Verb[] {
  if (row.status === 'draft' || row.status === 'ended' || row.status === 'rejected') return [];
  if (row.status === 'pending') return ['approve', 'reject'];
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

/** The sentence a refund verb has to be worth before anybody clicks it. */
function owed(row: PromoRow, verb: 'reject' | 'stop') {
  if (!row.charged) {
    return 'Nothing has been taken from this wallet yet, so refusing hands back nothing and starts no run.';
  }
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

const WORDS: Record<Verb, string> = {
  approve: 'Signing this off takes the budget out of the payer’s wallet now, starts the paid run today and lets the feed carry the campaign.',
  pause: 'Taking it out of the feed keeps the paid run standing, so it still ends on the same date.',
  resume: 'Putting it back in the feed runs out the end date it already had.',
  reject: 'Refusing ends the campaign and hands back whatever part of the paid run was never delivered.',
  stop: 'Stopping ends a paid run early and either refunds the unspent coins or withholds them.',
};

/**
 * One campaign on its own page: the thing being sold at full size, the paper
 * under it, and the verbs kept off the scrolling list so a refund is decided
 * while looking at what the refund is for.
 */
export default function CampaignPage({ params }: { params: { id: string } }) {
  const { noteGate, can } = useSession();
  const confirm = useConfirm();
  const [detail, setDetail] = useState<PromoDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [verb, setVerb] = useState<'reject' | 'stop' | null>(null);
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState<'credit' | 'withhold' | ''>('');
  const [working, setWorking] = useState(false);

  const review = can('promotions_review');

  const load = useCallback(async () => {
    try {
      setDetail(await api<PromoDetail>(`admin/promotions/${params.id}/`));
      setError(null);
    } catch (err) {
      if (!noteGate(err)) setError((err as Error).message);
    }
  }, [noteGate, params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (which: Verb) => {
    const sure = await confirm({
      title: `${which === 'approve' ? 'Sign this campaign off' : which === 'pause' ? 'Pause this campaign'
        : which === 'resume' ? 'Resume this campaign' : which === 'reject' ? 'Reject this campaign' : 'Stop this paid run'}?`,
      body: `${WORDS[which]}\n${which === 'reject' ? owed(detail!.campaign, 'reject')
        : which === 'stop' ? owed(detail!.campaign, 'stop') : ''}`.trim(),
      confirmLabel: which[0].toUpperCase() + which.slice(1),
      tone: which === 'reject' || which === 'stop' ? 'danger' : 'primary',
    });
    if (!sure) return;
    setWorking(true);
    setError(null);
    try {
      const out = await api<{ detail: string; campaign: PromoRow }>(`admin/promotions/${params.id}/${which}/`, {
        method: 'POST',
        body: { reason: which === 'approve' || which === 'pause' || which === 'resume' ? '' : reason.trim(), refund: which === 'stop' ? refund : '' },
      });
      setVerb(null);
      setReason('');
      setRefund('');
      setBanner({ kind: 'ok', text: out.detail });
      setDetail(current => (current ? { ...current, campaign: out.campaign } : current));
      await load();
    } catch (err) {
      if (!noteGate(err)) setError((err as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const row = detail?.campaign;
  const standing = row ? (STAMP[row.status] || { tone: 'mute', label: row.status_label }) : null;
  const verbs = row ? verbsFor(row) : [];
  const over = !!row && row.left_hours !== null && row.left_hours <= 0;
  const armed = !working && (
    verb === null || (verb !== 'stop' ? reason.trim().length > 0 : reason.trim().length > 0 && refund !== '')
  );

  return (
    <ConsoleShell
      title={row ? `Campaign #${row.id} — @${row.owner}` : `Campaign #${params.id}`}
      subtitle={row
        ? `${row.package?.name || 'bought as a budget'} · ${row.coins} coins${row.charged ? '' : ' still in the payer’s wallet'} · ${standing!.label}`
        : 'What the coins bought, who is meant to see it, and what the seat can sign.'}
      actions={(
        <>
          <Link href="/promotions" className="btn ghost">{IC.chevron}<span>All campaigns</span></Link>
          <button type="button" className="btn ghost" onClick={load} title="Reload this campaign">
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

      {error && !detail && (
        <section className="panel empty">
          <h2>This campaign is not here</h2>
          <p>{error}</p>
        </section>
      )}

      {row && standing && (
        <div className="record">
          <div className="record-main">
            <Section title="What the coins are spent on">
              <ContentCard content={row.card}/>
              <p className="fineprint">
                <Link href={`/people/${row.owner}`}>@{row.owner}&apos;s full record</Link>
              </p>
            </Section>

            <Section title="Who is meant to see it">
              <ul className="promo-facts" data-targeting>
                <li><span>Ages</span><b>{row.targeting.age_min}–{row.targeting.age_max}</b></li>
                <li><span>Country</span><b>{row.targeting.country || 'everywhere'}</b></li>
                <li><span>Cities</span>
                  <b>{row.targeting.cities.length ? row.targeting.cities.join(', ') : 'the whole country'}</b>
                </li>
                <li><span>Category</span><b>{row.category || 'not narrowed'}</b></li>
                <li><span>Ordered</span><b>{stamp(row.created_at)}</b></li>
                <li><span>Coins taken</span>
                  <b data-charged={row.charged ? 'yes' : 'no'}>
                    {row.charged ? stamp(row.starts_at || row.created_at) : 'not yet — waiting on a seat'}
                  </b>
                </li>
                <li><span>Ends</span>
                  <b>{row.ends_at ? stamp(row.ends_at) : row.charged ? 'no end date' : 'when a seat approves'}</b>
                </li>
                <li><span>Impressions</span><b>{num(row.delivered)}</b></li>
                <li><span>People reached</span><b>{row.people === null ? 'not counted' : num(row.people)}</b></li>
                <li><span>Reach bought</span><b>{row.reach_bought ? `${num(row.reach_bought)} people` : 'nothing promised'}</b></li>
                <li><span>Clicks</span><b>{num(row.clicks)}</b></li>
                <li><span>Standing</span><b><span className={`pill ${standing.tone}`}>{standing.label}</span></b></li>
              </ul>
            </Section>

            <Section title="Reports already sitting on it">
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
            </Section>

            {detail && detail.reviews.length > 0 && (
              <Section title="The paper on this campaign">
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
              </Section>
            )}
          </div>

          <aside className="record-acts">
            <h3>Decide</h3>
            {row.status === 'draft' ? (
              <p className="note row" data-unpaid>
                {IC.alert}
                <span>A draft has not been paid for — there are no coins here to approve or hand back.</span>
              </p>
            ) : row.status === 'ended' || row.status === 'rejected' ? (
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
            ) : !review ? (
              <p className="note row">
                {IC.lock}
                <span>Deciding what gets paid reach is not on your seat. You can read the queue and the paper.</span>
              </p>
            ) : (
              <div className="verbs">
                {row.status === 'pending' && (
                  <p className="note row" data-unbilled>
                    {IC.coin}
                    <span>
                      <b>{row.coins} coins are still in @{row.owner}&apos;s wallet.</b> Approving moves them here
                      and starts the {row.package?.days ? `${row.package.days}-day ` : ''}run today; refusing moves nothing.
                    </span>
                  </p>
                )}
                {over && (
                  <p className="note row" data-over>
                    {IC.alert}
                    <span>Its paid run finished {Math.abs(Math.round((row.left_hours || 0) / 24))} day(s) ago, so this
                      desk offers no Approve — signing it off would promise reach that no longer exists.</span>
                  </p>
                )}
                {verbs.map(item => {
                  const tone = item === 'approve' || item === 'resume' ? 'primary'
                    : item === 'pause' ? 'amber' : 'danger outline';
                  return (
                    <button
                      key={item} type="button" data-verb={item}
                      className={`btn tiny ${tone}`}
                      disabled={working || verb === item}
                      onClick={() => (item === 'reject' || item === 'stop'
                        ? setVerb(verb === item ? null : item)
                        : submit(item))}
                      title={WORDS[item]}
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
            )}

            {verb && review && row.status !== 'draft' && row.status !== 'ended' && row.status !== 'rejected' && (
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
                  <button type="button" className="btn primary tiny" disabled={!armed} onClick={() => submit(verb)}>
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

            {error && <p className="card-error" role="status">{IC.alert}<span>{error}</span></p>}
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
