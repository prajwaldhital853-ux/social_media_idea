'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import Avatar from '@/components/Avatar';
import { useApp } from '@/lib/AppContext';
import { useBackClose } from '@/lib/useBackClose';
import { IC } from '@/lib/icons';
import { ago, uid } from '@/lib/utils';
import { CoinRequest } from '@/lib/types';

const FILTERS = ['all', 'pending', 'approved', 'rejected'] as const;

function RejectRequest({ request, onClose }: { request: CoinRequest; onClose: () => void }) {
  const { t, setDb, showToast, logAudit, notify } = useApp();
  const [note, setNote] = useState('');
  useBackClose(true, onClose);

  const reject = () => {
    const trimmed = note.trim();
    setDb(prev => ({
      ...prev,
      coinRequests: prev.coinRequests.map(r => r.id === request.id ? { ...r, status: 'rejected' as const, note: trimmed || undefined } : r)
    }));
    notify(request.uid, 'coins', `${t('requestRejected')}${trimmed ? ` ${trimmed}` : ''}`, '/wallet');
    logAudit('reject_coin_request', request.id, trimmed);
    showToast(t('requestRejected'));
    onClose();
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content admin-reject-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={t('reject')}>
        <div className="modal-header">
          <b>{t('reject')} · {request.coins} {t('coins')}</b>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t('close')}>{IC.x}</button>
        </div>
        <div className="admin-reject-body">
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={300} placeholder={t('rejectNotePh')}/>
          <button type="button" className="ghost-btn danger" onClick={reject}>{IC.x}{t('reject')}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function AdminCoins() {
  const { db, t, setDb, showToast, logAudit, notify } = useApp();
  const lang = db.lang;
  const [filter, setFilter] = useState<typeof FILTERS[number]>('all');
  const [rejecting, setRejecting] = useState<CoinRequest | null>(null);

  const requests = db.coinRequests
    .filter(r => filter === 'all' || r.status === filter)
    .sort((a, b) => b.ts - a.ts);

  const approve = (r: CoinRequest) => {
    const now = Date.now();
    setDb(prev => ({
      ...prev,
      users: prev.users.map(u => u.id === r.uid ? { ...u, coins: u.coins + r.coins } : u),
      coinRequests: prev.coinRequests.map(x => x.id === r.id ? { ...x, status: 'approved' as const } : x),
      ledger: [{ id: uid(), uid: r.uid, delta: r.coins, kind: 'purchase' as const, note: `${r.method === 'bank' ? 'Bank transfer' : 'QR payment'} ${r.reference}`, ts: now }, ...prev.ledger]
    }));
    notify(r.uid, 'coins', t('coinsAdded', { n: r.coins }), '/wallet');
    logAudit('approve_coin_request', r.id, `${r.coins} coins · ${r.reference}`);
    showToast(t('requestApproved'));
  };

  return (
    <div className="admin-panel">
      <div className="admin-chips">
        {FILTERS.map(f => (
          <button key={f} type="button" className={`admin-chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? t('all') : t(f)}
            {f === 'pending' && <span className="admin-chip-n">{db.coinRequests.filter(r => r.status === 'pending').length}</span>}
          </button>
        ))}
      </div>
      {requests.length === 0 ? (
        <div className="empty-state"><span className="empty-state-icon">{IC.coin}</span><h2>{t('noLedger')}</h2></div>
      ) : (
        <div className="admin-list">
          {requests.map(r => {
            const user = db.users.find(u => u.id === r.uid);
            return (
              <div key={r.id} className="admin-coin">
                {user && <Avatar user={user} size={44}/>}
                <span className="admin-coin-main">
                  <b>{user?.name ?? r.uid} · {r.coins} {t('coins')} · NPR {r.amount.toLocaleString('en-US')}</b>
                  <span className="admin-coin-meta">
                    <span className="status-chip">{r.method === 'bank' ? t('bankTransfer') : t('qrPay')}</span>
                    <span className="admin-coin-ref">{t('reference')}: {r.reference}</span>
                    <span>{ago(r.ts, lang)}</span>
                  </span>
                  {r.note && <span className="admin-coin-note">{r.note}</span>}
                </span>
                {r.screenshot && <img className="admin-coin-shot" src={r.screenshot} alt={t('screenshot')}/>}
                <span className={`status-chip ${r.status}`}>{t(r.status)}</span>
                {r.status === 'pending' && (
                  <span className="admin-coin-actions">
                    <button type="button" className="promote-submit" onClick={() => approve(r)}>{IC.check}{t('approve')}</button>
                    <button type="button" className="ghost-btn danger" onClick={() => setRejecting(r)}>{IC.x}{t('reject')}</button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {rejecting && <RejectRequest request={rejecting} onClose={() => setRejecting(null)}/>}
    </div>
  );
}