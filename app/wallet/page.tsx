'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import ThemeToggle from '@/components/ThemeToggle';
import { useApp } from '@/lib/AppContext';
import { api, API_ENABLED } from '@/lib/api';
import { mapCoinRequest } from '@/lib/dto';
import { coinRequestsFragment, forgetLists, useList, walletFragment } from '@/lib/lists';
import { useWindowed } from '@/lib/useWindowed';
import { ago, hash, uid } from '@/lib/utils';
import { mediaFromFile } from '@/lib/mediaFile';
import { IC } from '@/lib/icons';
import { CoinRequest, LedgerEntry } from '@/lib/types';

const PRESETS = [50, 100, 200, 500];

function DemoQr({ seed }: { seed: string }) {
  const cells = useMemo(() => {
    const n = 21;
    const out: boolean[][] = Array.from({ length: n }, () => Array(n).fill(false));
    let h = hash(seed);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        h = (Math.imul(h, 16777619) ^ (x * 31 + y * 17)) >>> 0;
        out[y][x] = h % 100 < 46;
      }
    }
    const finder = (ox: number, oy: number) => {
      for (let y = -1; y < 8; y++) for (let x = -1; x < 8; x++) {
        const px = ox + x, py = oy + y;
        if (px < 0 || py < 0 || px >= n || py >= n) continue;
        const border = x >= 0 && x < 7 && y >= 0 && y < 7 && (x === 0 || x === 6 || y === 0 || y === 6);
        const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        out[py][px] = border || core;
      }
    };
    finder(0, 0); finder(14, 0); finder(0, 14);
    return out;
  }, [seed]);

  return (
    <svg className="wallet-qr" viewBox="0 0 21 21" role="img" aria-label="Demo payment QR">
      <rect width="21" height="21" fill="#fff" />
      {cells.map((row, y) => row.map((on, x) => on ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#101114" /> : null))}
    </svg>
  );
}

function StatusChip({ status }: { status: string }) {
  const { t } = useApp();
  const label = status === 'pending' ? t('pending') : status === 'approved' || status === 'active' ? t('approved') : status === 'rejected' ? t('rejected') : status === 'ended' ? t('ended') : status;
  return <span className={`status-chip ${status}`}>{label}</span>;
}

export default function WalletPage() {
  const { db, me, t, setDb, merge, serverMode, showToast, cancelPromotion, ready } = useApp();
  const [coins, setCoins] = useState(100);
  const [method, setMethod] = useState<'bank' | 'qr'>('bank');
  const [reference, setReference] = useState('');
  const [screenshot, setScreenshot] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const meId = me?.id || '';
  // The ledger and the request queue are keyset lists of their own; the cache
  // holds the rows, these hold the order.
  const ledgerList = useList(
    'wallet-ledger',
    { path: '/wallet/', frag: walletFragment(meId) },
    undefined,
    serverMode && !!me,
  );
  const requestList = useList(
    'coin-requests',
    { path: '/wallet/requests/list/', frag: coinRequestsFragment },
    undefined,
    serverMode && !!me,
  );

  const myLedger = useMemo<LedgerEntry[]>(() => {
    if (serverMode) {
      const index = new Map(db.ledger.map(l => [l.id, l] as [string, LedgerEntry]));
      return ledgerList.ids.map(id => index.get(id)).filter((l): l is LedgerEntry => !!l);
    }
    return me ? db.ledger.filter(l => l.uid === me.id).sort((a, b) => b.ts - a.ts) : [];
  }, [db.ledger, ledgerList.ids, me, serverMode]);
  const myRequests = useMemo<CoinRequest[]>(() => {
    if (serverMode) {
      const index = new Map(db.coinRequests.map(r => [r.id, r] as [string, CoinRequest]));
      return requestList.ids.map(id => index.get(id)).filter((r): r is CoinRequest => !!r);
    }
    return me ? db.coinRequests.filter(r => r.uid === me.id).sort((a, b) => b.ts - a.ts) : [];
  }, [db.coinRequests, requestList.ids, me, serverMode]);

  const ledgerWindow = useWindowed(myLedger.length, 10, meId,
    serverMode ? { hasMore: ledgerList.hasMore, loading: ledgerList.loading, load: ledgerList.loadMore } : undefined);
  const requestWindow = useWindowed(myRequests.length, 10, meId,
    serverMode ? { hasMore: requestList.hasMore, loading: requestList.loading, load: requestList.loadMore } : undefined);

  if (!me) {
    return (
      <AppShell>
        <header className="header home-header">
          <div className="home-header-row">
            <div className="home-header-copy">
              <div className="header-title">{t('wallet')}</div>
              <p className="header-sub">{t('walletSub')}</p>
            </div>
            <div className="header-actions"><ThemeToggle compact /></div>
          </div>
        </header>
        <div className="feed-empty">
          {ready && <><p>{t('needLogin')}</p><Link href="/login">{t('signIn')}</Link></>}
        </div>
      </AppShell>
    );
  }

  const price = db.settings.coinPrice;
  const amount = coins * price;
  const myPromos = db.promotions.filter(p => p.uid === me.id).sort((a, b) => b.ts - a.ts);

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
    try {
      // In the API build this pushes the bytes to /api/uploads/ and keeps the URL;
      // screenshot_url is a URL column and refuses a data URL.
      setScreenshot((await mediaFromFile(file)).src || '');
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('e_type'));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reference.trim()) {
      setError(t('reference'));
      return;
    }
    if (API_ENABLED) {
      setBusy(true);
      try {
        const row = await api.post<any>('/api/wallet/requests/', {
          coins, amount, method, reference: reference.trim(), screenshot_url: screenshot || '',
        });
        merge({ coinRequests: [mapCoinRequest(row)] });
        forgetLists('coin-requests');
        setReference('');
        setScreenshot('');
        setError('');
        showToast(t('requestSent'));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The request could not be sent.');
      } finally {
        setBusy(false);
      }
      return;
    }
    const request: CoinRequest = {
      id: uid(), uid: me.id, coins, amount, method,
      reference: reference.trim(), screenshot: screenshot || undefined,
      ts: Date.now(), status: 'pending'
    };
    setDb(prev => ({ ...prev, coinRequests: [request, ...prev.coinRequests] }));
    setReference('');
    setScreenshot('');
    setError('');
    showToast(t('requestSent'));
  };

  const promoTitle = (targetType: 'post' | 'listing', targetId: string) => {
    if (targetType === 'post') {
      const post = db.posts.find(p => p.id === targetId);
      return post ? post.text.slice(0, 60) : t('unavailable');
    }
    return db.listings.find(l => l.id === targetId)?.title || t('unavailable');
  };

  return (
    <AppShell>
      <header className="header home-header">
        <div className="home-header-row">
          <div className="home-header-copy">
            <div className="header-title">{t('wallet')}</div>
            <p className="header-sub">{t('walletSub')}</p>
          </div>
          <div className="header-actions"><ThemeToggle compact /></div>
        </div>
      </header>

      <div className="wallet-body">
        <section className="wallet-balance">
          <div className="wallet-balance-copy">
            <span className="wallet-balance-label">{t('balance')}</span>
            <strong className="wallet-balance-num">{IC.coin}{me.coins}</strong>
            <span className="wallet-balance-sub">{t('coins')} · ≈ NPR {me.coins * price}</span>
          </div>
          <span className="wallet-balance-rate">{t('coinRate', { n: price })}</span>
        </section>

        <section className="wallet-card">
          <h2 className="wallet-card-title">{t('buyCoins')}</h2>
          <form className="wallet-buy" onSubmit={submit}>
            <div className="wallet-amounts" role="group" aria-label={t('chooseCoins')}>
              {PRESETS.map(value => (
                <button key={value} type="button" className={`wallet-amount ${coins === value ? 'on' : ''}`} onClick={() => setCoins(value)}>
                  {IC.coin}{value}
                </button>
              ))}
              <label className="wallet-custom">
                <span>{t('chooseCoins')}</span>
                <input
                  type="number" min={10} max={10000} step={10} value={coins}
                  onChange={e => setCoins(Math.max(10, Math.min(10000, Number(e.target.value) || 10)))}
                  aria-label={t('chooseCoins')}
                />
              </label>
            </div>
            <div className="wallet-total">{t('amount')}: <b>NPR {amount}</b></div>

            <div className="wallet-methods" role="tablist" aria-label={t('buyCoins')}>
              <button type="button" role="tab" aria-selected={method === 'bank'} className={`wallet-method ${method === 'bank' ? 'on' : ''}`} onClick={() => setMethod('bank')}>{t('bankTransfer')}</button>
              <button type="button" role="tab" aria-selected={method === 'qr'} className={`wallet-method ${method === 'qr' ? 'on' : ''}`} onClick={() => setMethod('qr')}>{t('qrPay')}</button>
            </div>

            {method === 'bank' ? (
              <div className="wallet-pay">
                <p className="wallet-hint">{t('bankHint')}</p>
                <dl className="wallet-bank">
                  <div><dt>{t('bankTransfer')}</dt><dd>{db.settings.bankName}<button type="button" className="icon-btn" aria-label="Copy bank name" onClick={() => void copy(db.settings.bankName)}>{IC.share}</button></dd></div>
                  <div><dt>{t('accountNumber')}</dt><dd className="wallet-bank-acct">{db.settings.bankAccount}<button type="button" className="icon-btn" aria-label="Copy account number" onClick={() => void copy(db.settings.bankAccount)}>{IC.share}</button></dd></div>
                  <div><dt>{t('accountHolder')}</dt><dd>{db.settings.bankHolder}</dd></div>
                </dl>
              </div>
            ) : (
              <div className="wallet-pay wallet-pay-qr">
                <DemoQr seed={`exposing-pay-${me.id}-${coins}`} />
                <div>
                  <p className="wallet-hint"><b>{t('demoQr')}</b> · NPR {amount}</p>
                  <p className="wallet-hint">{t('scanHint')}</p>
                </div>
              </div>
            )}

            <label className="field">
              <span>{t('reference')}</span>
              <input type="text" value={reference} maxLength={60} placeholder="TXN-00000" autoComplete="off" onChange={e => { setReference(e.target.value); setError(''); }} />
            </label>
            {error && <p className="wallet-error">{error}</p>}

            <label className="wallet-screenshot">
              <span>{t('screenshot')} ({t('optional')})</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { void pickScreenshot(e.target.files?.[0]); e.target.value = ''; }} />
              {screenshot && <img src={screenshot} alt={t('screenshot')} className="wallet-screenshot-preview" />}
            </label>

            <button type="submit" className="promote-submit" disabled={busy}>{t('submitRequest')} · {IC.coin}{coins}</button>
          </form>
        </section>

        {(myRequests.length > 0 || requestList.loading) && (
          <section className="wallet-card">
            <h2 className="wallet-card-title">{t('pendingRequests')}</h2>
            <div className="wallet-rows">
              {myRequests.slice(0, requestWindow.limit).map(r => (
                <div className="wallet-row" key={r.id}>
                  <span className={`wallet-row-icon ${r.status}`}>{IC.coin}</span>
                  <span className="wallet-row-main">
                    <b>{r.coins} {t('coins')} · NPR {r.amount}</b>
                    <small>{r.method === 'bank' ? t('bankTransfer') : t('qrPay')} · {r.reference} · {ago(r.ts, db.lang)}</small>
                    {r.note && <small className="wallet-row-note">{r.note}</small>}
                  </span>
                  <StatusChip status={r.status} />
                </div>
              ))}
              {requestWindow.hasMore && <div ref={requestWindow.sentinel} className="feed-sentinel" aria-hidden="true" />}
            </div>
          </section>
        )}

        <section className="wallet-card">
          <h2 className="wallet-card-title">{t('myPromotions')}</h2>
          {myPromos.length === 0 ? (
            <p className="wallet-empty">{t('noPromos')}</p>
          ) : (
            <div className="wallet-rows">
              {myPromos.map(p => (
                <div className="wallet-row" key={p.id}>
                  <span className="wallet-row-icon promo">{IC.chart}</span>
                  <span className="wallet-row-main">
                    <b>{promoTitle(p.targetType, p.targetId)}</b>
                    <small>
                      {db.settings.packages.find(pk => pk.id === p.packageId)?.name || p.packageId} · {t('impressions')} {p.impressions} · {t('clicks')} {p.clicks}
                      {p.status === 'active' && ` · ${t('endsIn')} ${new Date(p.ends).toLocaleDateString(db.lang === 'ne' ? 'ne-NP' : 'en-GB', { day: 'numeric', month: 'short' })}`}
                    </small>
                  </span>
                  <span className="wallet-row-side">
                    <StatusChip status={p.status} />
                    {p.status === 'pending' && (
                      <button type="button" className="wallet-cancel" onClick={() => cancelPromotion(p.id)}>{t('cancelPromo')}</button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="wallet-card">
          <h2 className="wallet-card-title">{t('ledger')}</h2>
          {myLedger.length === 0 ? (
            !serverMode || ledgerList.loaded ? <p className="wallet-empty">{t('noLedger')}</p> : null
          ) : (
            <div className="wallet-rows">
              {myLedger.slice(0, ledgerWindow.limit).map(l => (
                <div className="wallet-row" key={l.id}>
                  <span className={`wallet-row-icon ${l.delta >= 0 ? 'in' : 'out'}`}>{l.delta >= 0 ? '+' : '−'}</span>
                  <span className="wallet-row-main">
                    <b>{l.note}</b>
                    <small>{l.kind} · {ago(l.ts, db.lang)}</small>
                  </span>
                  <b className={`wallet-delta ${l.delta >= 0 ? 'in' : 'out'}`}>{l.delta >= 0 ? '+' : ''}{l.delta}</b>
                </div>
              ))}
              {ledgerWindow.hasMore && <div ref={ledgerWindow.sentinel} className="feed-sentinel" aria-hidden="true" />}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}