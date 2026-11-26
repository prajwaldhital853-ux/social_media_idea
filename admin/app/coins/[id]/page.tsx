'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Banner from '@/components/Banner';
import ConsoleShell from '@/components/ConsoleShell';
import { useConfirm } from '@/components/Confirm';
import { api } from '@/lib/api';
import { IC } from '@/lib/icons';
import { useAdminEvent } from '@/lib/live';
import { ago, stamp } from '@/lib/time';
import { useSession } from '@/lib/session';
import { CoinDetail, ProofLink } from '@/lib/types';

const STANDINGS: Record<string, { tone: string; label: string }> = {
  pending: { tone: 'warn', label: 'Waiting on a person' },
  approved: { tone: 'good', label: 'Coins credited' },
  rejected: { tone: 'mute', label: 'Rejected' },
};

/**
 * One payment request on its own page. The proof is the only thing on here that
 * is private, so it opens on a click and closes on its own clock, and the verb
 * that moves money names the amount it moves before it moves it.
 */
export default function CoinRequestPage({ params }: { params: { id: string } }) {
  const { noteGate, can } = useSession();
  const confirm = useConfirm();
  const [detail, setDetail] = useState<CoinDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [verb, setVerb] = useState<'reject' | 'proof' | null>(null);
  const [reason, setReason] = useState('');
  const [proof, setProof] = useState<ProofLink | null>(null);
  const [closed, setClosed] = useState(false);
  const [working, setWorking] = useState(false);
  const [mail, setMail] = useState('');
  const timer = useRef<number | null>(null);

  const review = can('coins_review');

  const load = useCallback(async () => {
    try {
      setDetail(await api<CoinDetail>(`admin/coins/${params.id}/`));
      setError(null);
    } catch (err) {
      if (!noteGate(err)) setError((err as Error).message);
    }
  }, [noteGate, params.id]);

  useEffect(() => {
    load();
  }, [load]);

  useAdminEvent(['coins', 'coin_request', 'staff_notice'], load, pulse => {
    if (pulse.kind === 'staff_notice') {
      const route = pulse.route.split('?')[0].replace(/\/+$/, '');
      return route === '/coins' || route.startsWith('/coins/');
    }
    if (pulse.kind === 'coin_request') return String(pulse.id) === params.id;
    return pulse.kind === 'coins'
      && (!detail || String(pulse.user_id) === String(detail.request.card.id));
  });

  // The link is a two-minute window on purpose, so the picture closes itself when
  // the window does rather than staying on screen as if it were still private.
  useEffect(() => {
    if (!proof) return undefined;
    timer.current = window.setTimeout(() => setClosed(true), proof.expires_in * 1000);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [proof]);

  const showProof = async () => {
    setError(null);
    try {
      setClosed(false);
      setProof(await api<ProofLink>(`admin/coins/${params.id}/receipt-link/`));
    } catch (err) {
      setProof(null);
      if (!noteGate(err)) setError((err as Error).message);
    }
  };

  const submit = async (which: 'approve' | 'reject' | 'proof') => {
    const sure = await confirm({
      title: which === 'approve'
        ? `Credit ${detail?.request.coins} coins to @${detail?.request.card.username}?`
        : which === 'reject'
          ? 'Reject this payment request?'
          : 'Ask this person for a better receipt?',
      body: which === 'approve'
        ? 'Real rupees have already reached the account, so the coins go into their wallet now. There is no undo here, a mistake is corrected with a new ledger row.'
        : which === 'reject'
          ? 'The request is refused and they are sent your reason. Nothing is credited.'
          : 'The request stays open and they are told what else you need.',
      confirmLabel: which === 'approve' ? `Credit ${detail?.request.coins} coins` : which === 'reject' ? 'Reject' : 'Ask for more proof',
      tone: which === 'approve' ? 'primary' : which === 'reject' ? 'danger' : 'primary',
    });
    if (!sure) return;
    setWorking(true);
    setError(null);
    try {
      const out = await api<{ detail: string; mail?: string } & CoinDetail>(`admin/coins/${params.id}/${which}/`, {
        method: 'POST', body: { reason: which === 'approve' ? '' : reason.trim() },
      });
      setVerb(null);
      setReason('');
      setBanner({ kind: 'ok', text: out.detail });
      // The decision answer already carries the settled row, so the screen is
      // rewritten from it. Reloading here spent a second round trip to be told the
      // same thing, and the seat watched the page blank itself for no reason.
      setDetail(current => (current ? { ...current, request: out.request, asks: out.asks } : current));
      setMail(out.mail || '');
    } catch (err) {
      if (!noteGate(err)) setError((err as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const row = detail?.request;
  const standing = row ? (STANDINGS[row.status] || { tone: 'mute', label: row.status_label }) : null;

  return (
    <ConsoleShell
      title={row ? `Coin request #${row.id}` : `Coin request #${params.id}`}
      subtitle={row
        ? `@${row.card.username} · ${row.coins} coins for NPR ${row.amount} · ${standing!.label}`
        : 'What they say they paid, the proof behind it, and what the seat can settle.'}
      actions={(
        <>
          <Link href="/coins" className="btn ghost">{IC.chevron}<span>All requests</span></Link>
          <button type="button" className="btn ghost" onClick={load} title="Reload this request">
            {IC.refresh}<span>Refresh</span>
          </button>
        </>
      )}
    >
      <Banner banner={banner} />

      {mail && (
        <p className="note row" data-mail>
          <span>{mail}</span>
        </p>
      )}

      {!detail && !error && (
        <div className="skeleton-stack">
          <div className="skeleton"/><div className="skeleton"/><div className="skeleton skeleton-short"/>
        </div>
      )}

      {error && !detail && (
        <section className="panel empty">
          <h2>This request is not here</h2>
          <p>{error}</p>
        </section>
      )}

      {row && standing && (
        <div className="record">
          <div className="record-main">
            <Section title="What they say they paid">
              <ul className="coin-facts">
                <li><span>Coins asked for</span><b>{row.coins}</b></li>
                <li><span>Rupees</span><b>{row.amount}</b></li>
                <li><span>Method</span><b>{row.method}</b></li>
                <li><span>Bank reference</span><b title={stamp(row.created_at)}>{row.reference || '-'}</b></li>
                <li><span>Uploaded</span><b>{ago(row.created_at)}</b></li>
                <li><span>Standing</span><b><span className={`pill ${standing.tone}`}>{standing.label}</span></b></li>
                {!!row.resubmitted_at && (
                  <li><span>Proof resent</span><b title={stamp(row.resubmitted_at)}>{ago(row.resubmitted_at)}</b></li>
                )}
              </ul>
              <p className="fineprint">
                <Link href={`/people/${row.card.username}`}>@{row.card.username}&apos;s full record</Link>
              </p>
            </Section>

            <Section title="The payment proof">
              {row.has_proof ? (
                proof && !closed ? (
                  <div className="proof" data-proof>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={proof.href} alt={`Payment proof for @${row.card.username}`} className="proof-img"/>
                    <p className="note row">
                      {IC.lock}
                      <span>This link closes after {Math.round(proof.expires_in / 60)} minutes and is
                        good only for your seat. The receipt is never printed in the list itself.</span>
                    </p>
                  </div>
                ) : (
                  <div className="proof-shut">
                    <button type="button" className="btn ghost tiny" disabled={working} onClick={showProof} data-proof-open>
                      {IC.eye}<span>{closed ? 'Ask for the link again' : 'Open the payment proof'}</span>
                    </button>
                    {closed && <p className="note row"><span>That view has closed. Nothing was downloaded.</span></p>}
                  </div>
                )
              ) : (
                <p className="empty-note">{IC.x}<span>They have not uploaded a receipt yet.</span></p>
              )}
              {!!row.resubmitted_at && (
                <p className="fineprint" data-resent-note>
                  This is the receipt they sent after being asked for more proof, {ago(row.resubmitted_at)}.
                  The one they first uploaded was replaced, the request itself never became a second one.
                </p>
              )}
            </Section>

            {detail && detail.asks.length > 0 && (
              <Section title="What was asked of them">
                <ul className="coin-asks">
                  {detail.asks.map((ask, index) => (
                    <li key={`${ask.at}-${index}`}>
                      <b>{ask.action === 'proof' ? 'More proof' : ask.action === 'reject' ? 'Rejected' : 'Credited'}</b>
                      <span>{ask.reason || 'no sentence was written'}</span>
                      <em>{ask.by ? `@${ask.by}` : 'system'} {ago(ask.at)}</em>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>

          <aside className="record-acts">
            <h3>Decide</h3>
            {row.status !== 'pending' ? (
              <div className="verdict">
                <p className="verdict-line">
                  {IC.check}
                  <span><b>{row.review?.label || row.status_label}</b>, {row.review?.reason || 'no sentence was written'}</span>
                </p>
                {row.review?.coins_credited ? (
                  <p className="verdict-note">
                    <span>Coins moved</span>
                    <b>{row.review.coins_credited} into @{row.card.username}&apos;s wallet</b>
                  </p>
                ) : null}
                <p className="note">
                  {IC.alert}
                  <span>Nothing here can be undone. If the money was credited by mistake, write a
                    correction in the ledger, it will be a new row, not an edit.</span>
                </p>
              </div>
            ) : !review ? (
              <p className="note row">
                {IC.lock}
                <span>Crediting coins is not on your seat. You can read the request and open the proof.</span>
              </p>
            ) : (
              <div className="verbs">
                <button type="button" className="btn primary tiny" data-verb="approve"
                  disabled={working} onClick={() => submit('approve')}
                  title={`Credit ${row.coins} coins to @${row.card.username} now`}>
                  {IC.check}<span>Credit {row.coins} coins</span>
                </button>
                <button type="button" className="btn amber tiny" data-verb="proof"
                  disabled={working || verb === 'proof'} onClick={() => setVerb(verb === 'proof' ? null : 'proof')}
                  title="Leave the request open and ask them for a better receipt">
                  {IC.refresh}<span>Ask for more proof</span>
                </button>
                <button type="button" className="btn danger outline tiny" data-verb="reject"
                  disabled={working || verb === 'reject'} onClick={() => setVerb(verb === 'reject' ? null : 'reject')}
                  title="Refuse the request and tell them why">
                  {IC.x}<span>Reject</span>
                </button>
              </div>
            )}

            {verb && row.status === 'pending' && review && (
              <div className="ask">
                <label className="field">
                  <span>{verb === 'reject' ? 'Why the money is not being credited, they are sent this' : 'What more you need from them'}</span>
                  <textarea
                    rows={2} name="reason" maxLength={240} value={reason} autoFocus
                    placeholder={verb === 'reject'
                      ? 'e.g. the reference does not match this amount'
                      : 'e.g. the right-hand edge of the receipt is cut off'}
                    onChange={event => setReason(event.target.value)}
                  />
                </label>
                <div className="ask-actions">
                  <button
                    type="button" className="btn primary tiny" disabled={working || !reason.trim()}
                    onClick={() => submit(verb)}
                  >
                    {IC.go}<span>{working ? 'Working…' : `Confirm, ${verb === 'reject' ? 'Reject' : 'Ask for more proof'}`}</span>
                  </button>
                  <button type="button" className="btn ghost tiny" disabled={working}
                    onClick={() => { setVerb(null); setReason(''); }}>
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
