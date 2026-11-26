'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DemoQr from '@/components/DemoQr';
import { useApp } from '@/lib/AppContext';
import { api, API_ENABLED } from '@/lib/api';
import { mapCoinRequest } from '@/lib/dto';
import { forgetLists } from '@/lib/lists';
import { mediaFromFile } from '@/lib/mediaFile';
import { IC } from '@/lib/icons';
import { uid } from '@/lib/utils';
import { CoinRequest } from '@/lib/types';

const PRESETS = [50, 100, 200, 500, 1000];
/**
 * The coin request form, once per payment method. The two wallet pages differ
 * only by which detail the buyer copies, so the amount, the reference and the
 * proof of payment stay in one place.
 */
export default function CoinRequestForm({ method }: { method: 'bank' | 'qr' }) {
  const { db, me, t, setDb, merge, showToast } = useApp();
  const router = useRouter();
  const [coins, setCoins] = useState(100);
  const [reference, setReference] = useState('');
  const [screenshot, setScreenshot] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!me) return null;

  const price = db.settings.coinPrice;
  const floor = db.settings.minPurchase;
  const amount = coins * price;
  // The desk's floor decides which shortcuts are worth showing: a minimum of
  // 250 hides every preset under it instead of letting one be clicked and
  // bounced by the door.
  const presets = PRESETS.filter(value => value >= floor);
  const choices = presets.length > 0 ? presets : [floor];

  // The desk's floor can arrive after this form rendered (the seed says 100
  // until /api/meta/ answers), so a pick made in that window is re-clamped.
  useEffect(() => {
    setCoins(prev => (prev < floor ? floor : prev));
  }, [floor]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showToast(t('linkCopied'));
    } catch {
      showToast(value);
    }
  };

  const pickScreenshot = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      // screenshot_url is a URL column and refuses a data URL, so the bytes go
      // to /api/uploads/ first in the API build.
      setScreenshot((await mediaFromFile(file)).src || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('e_type'));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reference.trim()) { setError(t('reference')); return; }
    if (API_ENABLED) {
      setBusy(true);
      try {
        const row = await api.post<any>('/api/wallet/requests/', {
          coins, amount, method, reference: reference.trim(), screenshot_url: screenshot || '',
        });
        merge({ coinRequests: [mapCoinRequest(row)] });
        forgetLists('coin-requests');
        showToast(t('requestSent'));
        router.push('/wallet/requests');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The request could not be sent.');
        setBusy(false);
      }
      return;
    }
    const request: CoinRequest = {
      id: uid(), uid: me.id, coins, amount, method,
      reference: reference.trim(), screenshot: screenshot || undefined,
      ts: Date.now(), status: 'pending',
    };
    setDb(prev => ({ ...prev, coinRequests: [request, ...prev.coinRequests] }));
    setReference('');
    setScreenshot('');
    setError('');
    showToast(t('requestSent'));
    router.push('/wallet/requests');
  };

  return (
    <form className="wallet-form" onSubmit={submit}>
      <div className="wallet-field">
        <span className="wallet-label">{t('chooseCoins')}</span>
        <div className="wallet-amounts">
          {choices.map(value => (
            <button
              key={value}
              type="button"
              className={`wallet-amount ${coins === value ? 'on' : ''}`}
              onClick={() => setCoins(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <label className="wallet-inline">
          <span>{t('coins')}</span>
          <input
            type="number"
            min={floor}
            max={10000}
            step={10}
            value={coins}
            onChange={e => setCoins(Math.max(floor, Math.min(10000, Number(e.target.value) || floor)))}
            aria-label={t('chooseCoins')}
          />
        </label>
      </div>

      <div className="wallet-line">
        <span>{t('coinRate', { n: price })}</span>
        <b>{t('amount')}: NPR {amount}</b>
      </div>

      {method === 'bank' ? (
        <dl className="wallet-bank">
          <div><dt>{t('bankTransfer')}</dt><dd>{db.settings.bankName}</dd></div>
          <div>
            <dt>{t('accountNumber')}</dt>
            <dd>
              <span className="wallet-mono">{db.settings.bankAccount}</span>
              <button type="button" className="wallet-copy" onClick={() => void copy(db.settings.bankAccount)}>{IC.share}{t('copy')}</button>
            </dd>
          </div>
          <div><dt>{t('accountHolder')}</dt><dd>{db.settings.bankHolder}</dd></div>
          <div><dt>{t('amount')}</dt><dd className="wallet-mono">NPR {amount}</dd></div>
        </dl>
      ) : db.settings.qrImage ? (
        <div className="wallet-qr-row">
          <img src={db.settings.qrImage} alt={t('qrPay')} className="wallet-qr" />
          <div className="wallet-qr-copy">
            <b>{t('qrPay')}</b>
            <p className="wallet-hint">{t('scanHint')}</p>
            <p className="wallet-hint wallet-mono">NPR {amount}</p>
          </div>
        </div>
      ) : (
        <div className="wallet-qr-row">
          <DemoQr seed={`exposing-pay-${me.id}-${coins}`} />
          <div className="wallet-qr-copy">
            <b>{t('demoQr')}</b>
            <p className="wallet-hint">{t('scanHint')}</p>
            <p className="wallet-hint wallet-mono">NPR {amount}</p>
          </div>
        </div>
      )}

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
        <span>{t('screenshot')} ({t('optional')})</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={e => { void pickScreenshot(e.target.files?.[0]); e.target.value = ''; }}
        />
        {screenshot && <img src={screenshot} alt={t('screenshot')} className="wallet-shot-preview" />}
      </label>

      {error && <p className="wallet-error">{error}</p>}

      <button type="submit" className="wallet-submit" disabled={busy}>
        {t('submitRequest')} · {coins} {t('coins')}
      </button>
    </form>
  );
}
