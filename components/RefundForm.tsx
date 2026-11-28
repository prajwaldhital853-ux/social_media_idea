'use client';

import { useEffect, useState } from 'react';
import { useApp } from '@/lib/AppContext';
import { api, API_ENABLED } from '@/lib/api';
import { mapCoinRequest } from '@/lib/dto';
import { coinRequestsFragment, refreshList } from '@/lib/lists';
import { mediaFromFile } from '@/lib/mediaFile';
import { IC } from '@/lib/icons';
import { useBackClose } from '@/lib/useBackClose';
import { CoinRequest } from '@/lib/types';

const stamp = (ts: number, lang: string) =>
  new Date(ts).toLocaleDateString(lang === 'ne' ? 'ne-NP' : 'en-GB', { day: '2-digit', month: 'short' });

/**
 * Asking for an approved purchase back. The whole point of this sheet is the
 * sentence under the button: sending it locks those coins, so a refund cannot be
 * spent twice while the desk is still deciding it. The lock is written with the
 * submission rather than on the tap that opened this sheet, because a form
 * abandoned halfway would otherwise leave money frozen with no record of why.
 */
export default function RefundForm({ request, onClose }: { request: CoinRequest; onClose: () => void }) {
  const { t, db, setDb, merge, showToast, showConfirm } = useApp();
  const [shot, setShot] = useState('');
  const [reference, setReference] = useState(request.reference || '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useBackClose(true, onClose);
  useEffect(() => {
    const had = document.body.classList.contains('noscroll');
    document.body.classList.add('noscroll');
    return () => { if (!had) document.body.classList.remove('noscroll'); };
  }, []);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      setShot((await mediaFromFile(file)).src || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('e_type'));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (API_ENABLED) {
      setBusy(true);
      try {
        const out = await api.post<any>(`/api/wallet/requests/${request.id}/refund-request/`, {
          screenshot_url: shot, reference: reference.trim(), reason: reason.trim(),
        });
        // The row the server hands back is the request, not the wallet list's
        // shape: the refund flags are added by the list endpoint. Say what just
        // became true here so the badge flips before the re-read lands.
        merge({
          coinRequests: [{
            ...mapCoinRequest(out.request || out),
            refundRequested: true, refundable: false, locked: request.coins,
          }],
        });
        refreshList('coin-requests', { path: '/wallet/requests/list/', frag: coinRequestsFragment });
        showToast(t('refundSent'));
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : t('refundFailed'));
        setBusy(false);
      }
      return;
    }
    setDb(prev => ({
      ...prev,
      coinRequests: prev.coinRequests.map(r => (r.id === request.id
        ? { ...r, refundRequested: true, refundable: false, locked: r.coins }
        : r)),
    }));
    showToast(t('refundSent'));
    onClose();
  };

  // Submitting this freezes real money, so the bar at the foot of the screen asks
  // once before the request leaves the device. The sheet stays open underneath:
  // a half-filled form is not something a mis-tap should throw away.
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!shot) { setError(t('refundNeedsProof')); return; }
    if (!reason.trim()) { setError(t('refundNeedsReason')); return; }
    showConfirm(t('refundConfirm', { n: request.coins }), () => { void send(); });
  };

  return (
    <div className="modal-overlay refund-overlay" onClick={onClose}>
      <form
        className="modal-content refund-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label={t('refundTitle')}
        onSubmit={e => void submit(e)}
      >
        <div className="modal-header">
          <b>{t('refundTitle')}</b>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t('close')}>{IC.x}</button>
        </div>
        <p className="wallet-hint">
          {t('refundIntro', { n: request.coins, day: stamp(request.ts, db.lang) })}
        </p>
        <p className="wallet-hint refund-sum">
          {request.coins} {t('coins')} · NPR {request.amount} · {request.method === 'bank' ? t('bankTransfer') : t('qrPay')}
        </p>

        <label className="wallet-shot">
          <span>{t('refundProof')}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }}
          />
          {shot && <img src={shot} alt={t('refundProof')} className="wallet-shot-preview" />}
        </label>

        <label className="field">
          <span>{t('refundReference')}</span>
          <input
            type="text"
            value={reference}
            maxLength={60}
            placeholder="TXN-00000"
            autoComplete="off"
            onChange={e => { setReference(e.target.value); setError(''); }}
          />
        </label>

        <label className="field">
          <span>{t('refundReason')}</span>
          <textarea
            value={reason}
            rows={3}
            maxLength={240}
            onChange={e => { setReason(e.target.value); setError(''); }}
          />
        </label>

        {error && <p className="wallet-error">{error}</p>}

        <button type="submit" className="wallet-submit" disabled={busy}>
          {t('refundSubmit')} · {request.coins} {t('coins')}
        </button>
        <p className="wallet-hint refund-lock-note">{t('refundLocks')}</p>
      </form>
    </div>
  );
}
