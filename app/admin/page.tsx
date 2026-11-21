'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import ThemeToggle from '@/components/ThemeToggle';
import AdminReports from '@/components/AdminReports';
import AdminUsers from '@/components/AdminUsers';
import AdminCoins from '@/components/AdminCoins';
import AdminPromos from '@/components/AdminPromos';
import { useApp } from '@/lib/AppContext';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/utils';
import { FeatureFlags, Settings } from '@/lib/types';
import { TranslationKey } from '@/lib/i18n';

type AdminTab = 'overview' | 'reports' | 'users' | 'coins' | 'promos' | 'audit' | 'settings';

const FEATURE_LABELS: { key: keyof FeatureFlags; label: string }[] = [
  { key: 'video', label: 'video' },
  { key: 'marketplace', label: 'marketplace' },
  { key: 'promotion', label: 'promotions' },
  { key: 'googleLogin', label: 'google' },
  { key: 'facebookLogin', label: 'facebook' },
  { key: 'appleLogin', label: 'apple' }
];

export default function AdminPage() {
  const router = useRouter();
  const { db, me, t, isStaff, setDb, showToast, logAudit, ready } = useApp();
  const lang = db.lang;
  const [tab, setTab] = useState<AdminTab>('overview');
  const [draft, setDraft] = useState<Settings>(() => JSON.parse(JSON.stringify(db.settings)));
  const [newCat, setNewCat] = useState('');

  // While the session is still arriving, neither "sign in" nor "not staff" is a
  // fact about the visitor yet — saying either would flash at a real moderator.
  if (!me) {
    return <AppShell>
      {ready && <div className="empty-state">
        <span className="empty-state-icon">{IC.shield}</span>
        <h2>{t('needLogin')}</h2>
        <button type="button" className="empty-state-cta" onClick={() => router.push('/login')}>{t('signIn')}</button>
      </div>}
    </AppShell>;
  }

  if (!isStaff()) {
    return <AppShell>
      <div className="empty-state">
        <span className="empty-state-icon">{IC.lock}</span>
        <h2>{t('adminOnly')}</h2>
        <button type="button" className="empty-state-cta" onClick={() => router.push('/')}>{t('backFeed')}</button>
      </div>
    </AppShell>;
  }

  const openReports = db.reports.filter(r => r.status === 'open').length;
  const pendingCoins = db.coinRequests.filter(r => r.status === 'pending').length;
  const pendingPromos = db.promotions.filter(p => p.status === 'pending').length;

  const tabs: { id: AdminTab; label: string; badge?: number }[] = [
    { id: 'overview', label: t('tOverview') },
    { id: 'reports', label: t('tReports'), badge: openReports },
    { id: 'users', label: t('tUsers') },
    { id: 'coins', label: t('coinRequests'), badge: pendingCoins },
    { id: 'promos', label: t('promotions'), badge: pendingPromos },
    { id: 'audit', label: t('tAudit') },
    { id: 'settings', label: t('tSettings') }
  ];

  const exportCsv = () => {
    const rows = [['ts', 'actor', 'action', 'target', 'reason'], ...db.audit.map(a => [
      new Date(a.ts).toISOString(), a.actor, a.action, a.target, a.reason.replace(/"/g, '""')
    ])];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'exposing-audit.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveSettings = () => {
    const clean: Settings = {
      ...draft,
      threshold: Math.min(20, Math.max(1, Math.round(draft.threshold) || 1)),
      coinPrice: Math.max(1, Math.round(draft.coinPrice) || 1),
      packages: draft.packages.map(p => ({ ...p, coins: Math.max(1, Math.round(p.coins) || 1), days: Math.max(1, Math.round(p.days) || 1) })),
      categories: draft.categories.filter(c => c.trim())
    };
    setDb(prev => ({ ...prev, settings: clean }));
    setDraft(JSON.parse(JSON.stringify(clean)));
    logAudit('update_settings', 'settings', `threshold ${clean.threshold}, coin NPR ${clean.coinPrice}`);
    showToast(t('savedOk'));
  };

  const actorName = (id: string) => db.users.find(u => u.id === id)?.name ?? id;

  return <AppShell>
    <div className="admin-view">
      <header className="header home-header">
        <div className="home-header-row">
          <div className="home-header-copy">
            <h1 className="header-title">{t('admin')}</h1>
            <p className="header-sub">{me.name} · {me.role}</p>
          </div>
          <div className="header-actions"><ThemeToggle compact/></div>
        </div>
      </header>

      <div className="tabs admin-tabs">
        {tabs.map(x => (
          <button key={x.id} type="button" className={`tab ${tab === x.id ? 'active' : ''}`} onClick={() => setTab(x.id)}>
            {x.label}
            {!!x.badge && <span className="admin-tab-badge">{x.badge}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="admin-panel">
          <div className="admin-stats">
            <div className="admin-stat"><b>{db.users.length}</b><span>{t('sUsers')}</span></div>
            <div className="admin-stat"><b>{db.posts.filter(p => p.status === 'live').length}</b><span>{t('sPosts')}</span></div>
            <div className="admin-stat"><b>{db.comments.filter(c => c.status === 'live').length}</b><span>{t('sComments')}</span></div>
            <button type="button" className="admin-stat alert" onClick={() => setTab('reports')}><b>{openReports}</b><span>{t('sReports')}</span></button>
          </div>
          <div className="admin-queues">
            <button type="button" className="admin-queue" onClick={() => setTab('coins')}>
              {IC.coin}<span>{t('coinRequests')}</span><b>{pendingCoins}</b>{IC.chev}
            </button>
            <button type="button" className="admin-queue" onClick={() => setTab('promos')}>
              {IC.chart}<span>{t('promotions')}</span><b>{pendingPromos}</b>{IC.chev}
            </button>
          </div>
          <h2 className="admin-section-title">{t('recent')}</h2>
          {db.audit.length === 0 ? (
            <p className="feed-empty">{t('noAudit')}</p>
          ) : (
            <div className="admin-list">
              {db.audit.slice(0, 6).map(a => (
                <div key={a.id} className="admin-audit-row">
                  <span className="admin-audit-main">
                    <b>{a.action}</b>
                    <span>{a.target}{a.reason ? ` · ${a.reason}` : ''}</span>
                  </span>
                  <span className="admin-audit-meta">{actorName(a.actor)} · {ago(a.ts, lang)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'reports' && <AdminReports/>}
      {tab === 'users' && <AdminUsers/>}
      {tab === 'coins' && <AdminCoins/>}
      {tab === 'promos' && <AdminPromos/>}

      {tab === 'audit' && (
        <div className="admin-panel">
          <div className="admin-panel-head">
            <h2 className="admin-section-title">{t('tAudit')}</h2>
            <button type="button" className="ghost-btn" onClick={exportCsv} disabled={db.audit.length === 0}>{IC.chart}{t('exportCsv')}</button>
          </div>
          {db.audit.length === 0 ? (
            <p className="feed-empty">{t('noAudit')}</p>
          ) : (
            <div className="admin-list">
              {db.audit.map(a => (
                <div key={a.id} className="admin-audit-row">
                  <span className="admin-audit-main">
                    <b>{a.action}</b>
                    <span>{a.target}{a.reason ? ` · ${a.reason}` : ''}</span>
                  </span>
                  <span className="admin-audit-meta">{actorName(a.actor)} · {ago(a.ts, lang)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'settings' && (
        <div className="admin-panel">
          <section className="settings-card admin-settings-card">
            <h2>{IC.shield}{t('moderation')}</h2>
            <label className="field">
              <span>{t('threshold')}</span>
              <input type="number" min={1} max={20} value={draft.threshold} onChange={e => setDraft({ ...draft, threshold: Number(e.target.value) })}/>
            </label>
            <p className="settings-hint">{t('thr')}</p>
          </section>

          <section className="settings-card admin-settings-card">
            <h2>{IC.coin}{t('economy')}</h2>
            <div className="field-row">
              <label className="field">
                <span>{t('coinPrice')}</span>
                <input type="number" min={1} value={draft.coinPrice} onChange={e => setDraft({ ...draft, coinPrice: Number(e.target.value) })}/>
              </label>
              <label className="field">
                <span>{t('bankName')}</span>
                <input value={draft.bankName} onChange={e => setDraft({ ...draft, bankName: e.target.value })}/>
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>{t('accountNumber')}</span>
                <input value={draft.bankAccount} onChange={e => setDraft({ ...draft, bankAccount: e.target.value })}/>
              </label>
              <label className="field">
                <span>{t('accountHolder')}</span>
                <input value={draft.bankHolder} onChange={e => setDraft({ ...draft, bankHolder: e.target.value })}/>
              </label>
            </div>
          </section>

          <section className="settings-card admin-settings-card">
            <h2>{IC.gear}{t('featureFlags')}</h2>
            {FEATURE_LABELS.map(f => (
              <div key={f.key} className="settings-row">
                <span className="settings-row-copy"><b>{t(f.label as TranslationKey)}</b></span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft.features[f.key]}
                  aria-label={t(f.label as TranslationKey)}
                  className={`switch ${draft.features[f.key] ? 'on' : ''}`}
                  onClick={() => setDraft({ ...draft, features: { ...draft.features, [f.key]: !draft.features[f.key] } })}
                >
                  <span className="switch-knob"/>
                </button>
              </div>
            ))}
          </section>

          <section className="settings-card admin-settings-card">
            <h2>{IC.chart}{t('promotions')}</h2>
            {draft.packages.map((p, i) => (
              <div key={p.id} className="admin-package">
                <label className="field">
                  <span>{t('packageName')}</span>
                  <input value={p.name} onChange={e => setDraft({ ...draft, packages: draft.packages.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })}/>
                </label>
                <div className="field-row">
                  <label className="field">
                    <span>{t('coins')}</span>
                    <input type="number" min={1} value={p.coins} onChange={e => setDraft({ ...draft, packages: draft.packages.map((x, j) => j === i ? { ...x, coins: Number(e.target.value) } : x) })}/>
                  </label>
                  <label className="field">
                    <span>{t('days')}</span>
                    <input type="number" min={1} value={p.days} onChange={e => setDraft({ ...draft, packages: draft.packages.map((x, j) => j === i ? { ...x, days: Number(e.target.value) } : x) })}/>
                  </label>
                </div>
                <label className="field">
                  <span>{t('reach')}</span>
                  <input value={p.reach} onChange={e => setDraft({ ...draft, packages: draft.packages.map((x, j) => j === i ? { ...x, reach: e.target.value } : x) })}/>
                </label>
              </div>
            ))}
          </section>

          <section className="settings-card admin-settings-card">
            <h2>{IC.store}{t('categories')}</h2>
            <div className="admin-cats">
              {draft.categories.map(c => (
                <span key={c} className="admin-cat">
                  {c}
                  <button type="button" aria-label={`${t('del')} ${c}`} onClick={() => setDraft({ ...draft, categories: draft.categories.filter(x => x !== c) })}>{IC.x}</button>
                </span>
              ))}
            </div>
            <div className="admin-cat-add">
              <input value={newCat} onChange={e => setNewCat(e.target.value)} maxLength={40} placeholder={t('addCategory')} aria-label={t('addCategory')}/>
              <button
                type="button"
                className="ghost-btn"
                disabled={!newCat.trim() || draft.categories.includes(newCat.trim())}
                onClick={() => { setDraft({ ...draft, categories: [...draft.categories, newCat.trim()] }); setNewCat(''); }}
              >
                {IC.plus}{t('addCategory')}
              </button>
            </div>
          </section>

          <button type="button" className="promote-submit admin-save" onClick={saveSettings}>{IC.check}{t('save')}</button>
        </div>
      )}
    </div>
  </AppShell>;
}