'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import WalletShell from '@/components/WalletShell';
import { useApp } from '@/lib/AppContext';
import { api } from '@/lib/api';
import { forgetLists } from '@/lib/lists';
import { mediaFromFile } from '@/lib/mediaFile';
import { ago } from '@/lib/utils';

interface Ask {
  request: {
    id: number;
    coins: number;
    amount: string;
    method: string;
    reference: string;
    status: string;
    created_at: string;
  };
  asked: boolean;
  reason: string;
  asked_at: string | null;
}

/**
 * Answering the desk's "we need more proof", on the purchase that is already open.
 *
 * This is deliberately not the buy-again form: a second request would be a second
 * payment for the same coins, and the desk would be left holding two rows for one
 * transfer. Uploading here replaces the screenshot on the row the admin is reading.
 */
export default function CoinProofResubmitPage() {
  const params = useParams();
  const router = useRouter();
  const { db, me, ready, t, showToast, showConfirm, featureLock } = useApp();
  const walletOff = featureLock('wallet');
  const id = String(params.id || '');
  const [ask, setAsk] = useState<Ask | null>(null);
  const [error, setError] = useState('');
  const [reference, setReference] = useState('');
  const [screenshot, setScreenshot] = useState('');
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const row = await api.get<Ask>(`/api/wallet/requests/${id}/proof/`);
      setAsk(row);
      setReference(row.request?.reference || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That request could not be opened.');
    } finally {
      setBusy(false);
    }
  }, [id]);

  useEffect(() => {
    if (!ready) return;
    if (!me) {
      router.replace('/login');
      return;
    }
    if (id) void load();
  }, [id, load, me, ready, router]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      // The screenshot column is a URL, so the bytes go to /api/uploads/ first.
      setScreenshot((await mediaFromFile(file)).src || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('e_type'));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    setBusy(true);
    try {
      await api.post(`/api/wallet/requests/${id}/proof/`, {
        screenshot_url: screenshot, reference: reference.trim(),
      });
      forgetLists('coin-requests');
      showToast(t('proofSent'));
      // The same iOS habit as the request form: the tap's activation is spent by
      // the time the answer lands, and Safari drops the navigation it issued
      // from under the keyboard. Blur, then move from a fresh task.
      (document.activeElement as HTMLElement | null)?.blur?.();
      setTimeout(() => router.push('/wallet'), 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The proof could not be sent.');
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (walletOff) { showToast(walletOff.msg); return; }
    if (!screenshot) {
      setError(t('proofShotRequired'));
      return;
    }
    showConfirm(t('proofSendConfirm'), () => { void send(); });
  };

  const row = ask?.request;

  return (
    <WalletShell>
      <section className="wallet-sec">
        <div className="wallet-sec-head">
          <h2>{t('proofAskTitle')}</h2>
          <Link href="/wallet" className="wallet-sec-note">{t('wallet')}</Link>
        </div>

        {busy && !ask && !error ? (
          <div className="wallet-rows" aria-hidden="true"><i className="wallet-skel" /><i className="wallet-skel" /></div>
        ) : error ? (
          <>
            <p className="wallet-error">{error}</p>
            <button type="button" className="ghost-btn" onClick={() => void load()} disabled={busy}>{t('retry')}</button>
          </>
        ) : !ask || !row || !ask.asked ? (
          <p className="wallet-empty">{t('proofNone')}</p>
        ) : (
          <>
            <div className="notice-banner" role="status">
              <div className="notice-line">
                <p className="notice-copy">
                  <span className="notice-text">{t('proofNeeded')}</span>
                  {ask.reason && <span className="notice-reason">{ask.reason}</span>}
                </p>
              </div>
            </div>

            <dl className="wallet-bank">
              <div><dt>{t('coins')}</dt><dd>{row.coins}</dd></div>
              <div><dt>{t('amount')}</dt><dd className="wallet-mono">NPR {row.amount}</dd></div>
              <div><dt>{t('method')}</dt><dd>{row.method === 'bank' ? t('bankTransfer') : t('qrPay')}</dd></div>
              <div>
                <dt>{t('pendingRequests')}</dt>
                <dd>{ago(new Date(row.created_at).getTime(), db.lang)}</dd>
              </div>
            </dl>

            <p className="wallet-hint">{t('proofAskSub')}</p>

            <form className="wallet-form" onSubmit={submit}>
              <label className="field">
                <span>{t('reference')}</span>
                <input
                  type="text"
                  value={reference}
                  maxLength={60}
                  placeholder="TXN-00000"
                  autoComplete="off"
                  onChange={e => { setReference(e.target.value); setError(''); }}
                />
              </label>

              <label className="wallet-shot">
                <span>{t('screenshot')}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }}
                />
                {screenshot && <img src={screenshot} alt={t('screenshot')} className="wallet-shot-preview" />}
              </label>

              {error && <p className="wallet-error">{error}</p>}

              {walletOff && <p className="feature-off-note">{walletOff.msg}</p>}

              <button type="submit" className={`wallet-submit${walletOff ? ' f-off' : ''}`} disabled={busy} {...(walletOff ? walletOff.props : {})}>
                {t('uploadProof')}
              </button>
            </form>
          </>
        )}
      </section>
    </WalletShell>
  );
}
