'use client';

import { useCallback, useEffect, useState } from 'react';
import ConsoleShell from '@/components/ConsoleShell';
import { api, upload } from '@/lib/api';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/time';
import { useSession } from '@/lib/session';
import { CoinDesk, SettingLine } from '@/lib/types';

/**
 * Contract 6.7 — the pricing desk. What a Coin costs, the smallest purchase, the
 * bank account the rupees go to, the QR a payer scans, and how long a stranger's
 * payment screenshot is kept. All of it is a row in the database, so a price
 * change is a click here and not a deploy — which is also why the screen shows the
 * open door's answer beside the boxes, so what you saved is what a payer is told.
 */

const ORDER = ['coin_price', 'coin_min_purchase', 'alert_coin_queue_hours', 'coin_bank_name',
               'coin_bank_account', 'coin_bank_holder', 'coin_proof_days'];

/** The QR is a file, not a box of text, so it is written by its own door. */
const FILED = ['coin_qr_url'];

export default function PricingScreen() {
  const { noteGate } = useSession();
  const [desk, setDesk] = useState<CoinDesk | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [shot, setShot] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDesk(await api<CoinDesk>('admin/coins/desk/'));
    } catch (err) {
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    }
  }, [noteGate]);

  useEffect(() => {
    load();
  }, [load]);

  const line = (key: string) => desk?.lines.find(item => item.key === key);
  const shown = (desk?.lines || [])
    .filter(item => !FILED.includes(item.key))
    .sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));

  const valueOf = (item: SettingLine) => draft[item.key] ?? String(item.value ?? '');
  // Only the boxes that actually moved are posted. A desk that sends every knob
  // every time turns "I changed the price" into "changed price, bank, floor,
  // retention and contact details" in the audit log.
  const touched = (desk?.lines || []).filter(item =>
    !FILED.includes(item.key) && valueOf(item).trim() !== String(item.value ?? ''));
  const dirty = touched.length > 0 || !!file;

  const save = async () => {
    if (!desk) return;
    setBusy(true);
    setBanner(null);
    try {
      let said: string | null = null;
      if (file) {
        const form = new FormData();
        form.append('file', file);
        said = (await upload<Pick<CoinDesk, 'lines' | 'pricing' | 'detail'>>('admin/coins/qr/', form)).detail || null;
        setFile(null);
        setShot(null);
      }
      if (touched.length > 0) {
        const body = touched.reduce((all, item) => ({ ...all, [item.key]: valueOf(item).trim() }), {} as Record<string, string>);
        const out = await api<Pick<CoinDesk, 'lines' | 'pricing' | 'detail'>>('admin/coins/desk/', { method: 'POST', body });
        setDesk({ ...desk, lines: out.lines, pricing: out.pricing });
        said = out.detail || said;
      } else if (said) {
        const back = await api<CoinDesk>('admin/coins/desk/');
        setDesk(back);
      }
      setDraft({});
      setBanner({ kind: 'ok', text: said || 'Saved.' });
    } catch (err) {
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const pick = (chosen: File | null) => {
    setFile(chosen);
    setShot(chosen ? URL.createObjectURL(chosen) : null);
  };

  const qr = desk?.pricing.bank.qr || '';

  return (
    <ConsoleShell
      title="Coin pricing"
      subtitle="What a Coin costs, the floor under a purchase, where the rupees land, and how long a payment screenshot is kept — every one of them a number or a sentence, none of them in the code."
      actions={(
        <button type="button" className={`btn ghost${busy ? ' spinning' : ''}`} onClick={() => { load(); setDraft({}); pick(null); }} title="Reload the desk">
          {IC.refresh}<span>Refresh</span>
        </button>
      )}
    >
      {banner && (
        <p className={`banner banner-${banner.kind}`} role="status">
          {banner.kind === 'ok' ? IC.check : IC.alert}<span>{banner.text}</span>
        </p>
      )}

      {!desk ? (
        <div className="skeleton-stack">
          <div className="skeleton"/><div className="skeleton"/><div className="skeleton skeleton-short"/>
        </div>
      ) : (
        <div className="policy-grid">
          <section className="panel" data-desk="knobs">
            <div className="panel-head">
              <div>
                <h2>The numbers and the bank</h2>
                <p>
                  A price of zero is refused, because that is not a price. Everything written here is
                  read by the site on the next quote — no restart, no deploy — and each save names the
                  seat that turned the knob.
                </p>
              </div>
            </div>

            <div className="desk-grid">
              {shown.map(item => (
                <label className="field" key={item.key} data-knob={item.key}>
                  <span>{item.label}</span>
                  <input
                    name={item.key} value={valueOf(item)} autoComplete="off" maxLength={120}
                    inputMode={item.type === 'str' ? 'text' : 'decimal'}
                    placeholder={String(item.default)}
                    onChange={event => setDraft({ ...draft, [item.key]: event.target.value })}
                  />
                  <em className="desk-who">
                    {item.set
                      ? <>written by <b>{item.by}</b> {ago(item.at || '')} — {item.help}</>
                      : <>the contract’s own number, still untouched — {item.help}</>}
                  </em>
                </label>
              ))}
            </div>

            <div className="ask-actions">
              <button
                type="button" className="btn primary" data-desk-save
                disabled={busy || !dirty} onClick={save}
                title={dirty ? 'Write these to the platform' : 'Nothing has changed yet'}
              >
                {IC.check}<span>{busy ? 'Working…' : 'Save the desk'}</span>
              </button>
              {dirty && !file && (
                <button type="button" className="btn ghost" disabled={busy} onClick={() => setDraft({})}>
                  <span>Undo my typing</span>
                </button>
              )}
            </div>
          </section>

          <section className="panel" data-desk="card">
            <div className="panel-head">
              <div>
                <h2>What a payer is told</h2>
                <p>
                  This is the answer <b>GET /api/coins/pricing/</b> gives with nobody signed in — the
                  card a person reads before they send money to the account below it.
                </p>
              </div>
            </div>

            <div className="quote">
              <p className="quote-price">
                <b>{Number(desk.pricing.coin_price).toFixed(2)}</b>
                <span>NPR for 1 Coin</span>
              </p>
              <p className="quote-floor">Smallest purchase: <b>{desk.pricing.min_purchase}</b> coins</p>
            </div>

            <ul className="terms">
              {[
                ['Bank', desk.pricing.bank.name || 'not filled in'],
                ['Account number', desk.pricing.bank.account || 'not filled in'],
                ['Account holder', desk.pricing.bank.holder || 'not filled in'],
              ].map(([label, value]) => (
                <li className="term" key={label}>
                  <div className="term-body">
                    <b className="term-text">{label}</b>
                    <em className="term-note">{value}</em>
                  </div>
                </li>
              ))}
            </ul>

            <h3 className="desk-sub">The code they scan</h3>
            {file || qr ? (
              <div className="qr-desk">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={(file ? shot : qr) || ''} alt="Payment QR code" className="qr-img"/>
                <p className="note">
                  {line('coin_qr_url')?.set
                    ? <>last put up by <b>{line('coin_qr_url')?.by}</b> {ago(line('coin_qr_url')?.at || '')}</>
                    : 'saved from this desk'}
                </p>
              </div>
            ) : (
              <p className="empty-note">{IC.x}<span>No payment QR yet — payers are shown the account number to type.</span></p>
            )}

            <div className="qr-pick">
              <input
                type="file" name="qr" accept="image/png,image/jpeg,image/webp"
                data-qr-file
                onChange={event => pick(event.target.files?.[0] || null)}
              />
              {file && (
                <button type="button" className="btn ghost tiny" disabled={busy} onClick={() => pick(null)}>
                  <span>Not that one</span>
                </button>
              )}
            </div>

            <p className="panel-foot">
              {IC.alert}
              <span>
                A QR is an account number drawn as a picture, so whoever can swap it can redirect the
                platform’s income. The swap is written to the audit log, and anyone who was already
                shown the old picture keeps it — a bank change is worth telling people about.
              </span>
            </p>

            <p className="panel-foot">
              {IC.disk}
              <span>
                {desk.counts.held} purchase{desk.counts.held === 1 ? '' : 's'} are waiting on a person in
                the queue right now. Payment screenshots are deleted <b>{desk.pricing.proof_days}</b> days
                after a request is decided — and a request nobody ever decided goes on the same clock
                from the day it was uploaded.
              </span>
            </p>
          </section>
        </div>
      )}
    </ConsoleShell>
  );
}
