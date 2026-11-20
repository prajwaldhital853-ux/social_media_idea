'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import Avatar from '@/components/Avatar';
import VerifiedBadge from '@/components/VerifiedBadge';
import { useApp } from '@/lib/AppContext';
import { useBackClose } from '@/lib/useBackClose';
import { IC } from '@/lib/icons';
import { compact } from '@/lib/utils';
import { Role, User } from '@/lib/types';

const DAY = 24 * 60 * 60 * 1000;
const DURATIONS = [
  { key: 'd1', days: 1 },
  { key: 'd7', days: 7 },
  { key: 'd30', days: 30 },
  { key: 'dperm', days: 0 }
] as const;

function ManageUser({ user, onClose }: { user: User; onClose: () => void }) {
  const { db, me, t, setDb, showToast, logAudit, notify, isAdmin } = useApp();
  const [warnText, setWarnText] = useState('');
  const [duration, setDuration] = useState<typeof DURATIONS[number]['key']>('d7');
  const [suspReason, setSuspReason] = useState('');
  useBackClose(true, onClose);

  const live = db.users.find(u => u.id === user.id) || user;
  const canRole = isAdmin() && live.role !== 'superadmin';

  const setRole = (role: Role) => {
    setDb(prev => ({ ...prev, users: prev.users.map(u => u.id === live.id ? { ...u, role } : u) }));
    logAudit('change_role', live.id, role);
    showToast(t('savedOk'));
  };

  const warn = () => {
    if (!warnText.trim()) return;
    const text = warnText.trim();
    setDb(prev => ({ ...prev, users: prev.users.map(u => u.id === live.id ? { ...u, warning: text } : u) }));
    notify(live.id, 'warning', text, '/notifications');
    logAudit('warn_user', live.id, text);
    setWarnText('');
    showToast(t('warnSent'));
  };

  const suspend = () => {
    const d = DURATIONS.find(x => x.key === duration)!;
    const reason = suspReason.trim() || t('suspNotice');
    const until = d.days ? Date.now() + d.days * DAY : null;
    setDb(prev => ({ ...prev, users: prev.users.map(u => u.id === live.id ? { ...u, susp: { until, reason } } : u) }));
    notify(live.id, 'warning', `${t('suspNotice')} ${reason}`, '/notifications');
    logAudit('suspend_user', live.id, `${t(d.key)} — ${reason}`);
    setSuspReason('');
    showToast(t('savedOk'));
  };

  const reinstate = () => {
    setDb(prev => ({ ...prev, users: prev.users.map(u => u.id === live.id ? { ...u, susp: null } : u) }));
    notify(live.id, 'system', t('reinstated'), '/notifications');
    logAudit('reinstate_user', live.id, '');
    showToast(t('savedOk'));
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content admin-manage-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={t('manage')}>
        <div className="modal-header">
          <b>{t('manage')}</b>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t('close')}>{IC.x}</button>
        </div>
        <div className="admin-manage-body">
          <div className="admin-manage-id">
            <Avatar user={live} size={52}/>
            <span>
              <b>{live.name}{live.verified && <VerifiedBadge/>}</b>
              <span>@{live.username} · {live.email}</span>
            </span>
            <span className={`status-chip ${live.susp ? 'rejected' : 'approved'}`}>{live.susp ? t('suspended') : t('active')}</span>
          </div>

          {canRole && (
            <label className="field">
              <span>{t('role')}</span>
              <select value={live.role} onChange={e => setRole(e.target.value as Role)}>
                <option value="user">user</option>
                <option value="moderator">moderator</option>
                <option value="admin">admin</option>
              </select>
            </label>
          )}

          <section className="admin-manage-section">
            <h3>{IC.flag}{t('warn')}</h3>
            {live.warning && <p className="admin-manage-current">{t('warningNotice')}: “{live.warning}”</p>}
            <textarea value={warnText} onChange={e => setWarnText(e.target.value)} rows={2} maxLength={300} placeholder={t('warnPh')}/>
            <button type="button" className="ghost-btn" disabled={!warnText.trim()} onClick={warn}>{IC.send}{t('warn')}</button>
          </section>

          <section className="admin-manage-section">
            <h3>{IC.lock}{live.susp ? t('reinstate') : t('suspend')}</h3>
            {live.susp ? (
              <>
                <p className="admin-manage-current">
                  {live.susp.reason}
                  {live.susp.until ? ` · ${new Date(live.susp.until).toLocaleDateString()}` : ` · ${t('dperm')}`}
                </p>
                <button type="button" className="promote-submit" onClick={reinstate}>{IC.check}{t('reinstate')}</button>
              </>
            ) : (
              <>
                <div className="field-row">
                  <label className="field">
                    <span>{t('duration')}</span>
                    <select value={duration} onChange={e => setDuration(e.target.value as typeof duration)}>
                      {DURATIONS.map(d => <option key={d.key} value={d.key}>{t(d.key)}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span>{t('reason')}</span>
                    <input value={suspReason} onChange={e => setSuspReason(e.target.value)} maxLength={160} placeholder={t('reason')}/>
                  </label>
                </div>
                <button type="button" className="ghost-btn danger" onClick={suspend}>{IC.lock}{t('suspend')}</button>
              </>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function AdminUsers() {
  const { db, me, t } = useApp();
  const [q, setQ] = useState('');
  const [manageId, setManageId] = useState<string | null>(null);

  const needle = q.trim().toLowerCase();
  const users = db.users
    .filter(u => !needle || u.name.toLowerCase().includes(needle) || u.username.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));
  const managed = manageId ? db.users.find(u => u.id === manageId) : null;

  return (
    <div className="admin-panel">
      <div className="inbox-search admin-search">
        {IC.search}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('searchPeople')} aria-label={t('searchPeople')}/>
      </div>
      <div className="admin-list">
        {users.map(u => {
          const postCount = db.posts.filter(p => p.uid === u.id && p.status === 'live').length;
          const canManage = me && u.id !== me.id && (u.role !== 'superadmin' || me.role === 'superadmin');
          return (
            <div key={u.id} className="admin-user">
              <Avatar user={u} size={44}/>
              <span className="admin-user-main">
                <b>{u.name}{u.verified && <VerifiedBadge/>}</b>
                <span>@{u.username} · {u.email}</span>
                <span className="admin-user-meta">
                  <span className={`status-chip ${u.susp ? 'rejected' : 'approved'}`}>{u.susp ? t('suspended') : t('active')}</span>
                  <span className="admin-user-role">{u.role}</span>
                  <span>{postCount} {t('sPosts').toLowerCase()}</span>
                  <span>{IC.coin}{compact(u.coins)}</span>
                  {u.warning && <span className="admin-user-warn" title={u.warning}>{IC.flag}</span>}
                </span>
              </span>
              {canManage && (
                <button type="button" className="ghost-btn" onClick={() => setManageId(u.id)}>{IC.gear}{t('manage')}</button>
              )}
            </div>
          );
        })}
      </div>
      {managed && <ManageUser user={managed} onClose={() => setManageId(null)}/>}
    </div>
  );
}