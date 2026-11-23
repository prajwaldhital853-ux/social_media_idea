'use client';

import { useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import Avatar from '@/components/Avatar';
import VerifiedBadge from '@/components/VerifiedBadge';
import ThemeToggle from '@/components/ThemeToggle';
import EditProfileModal from '@/components/EditProfileModal';
import { useApp } from '@/lib/AppContext';
import { KEY } from '@/lib/utils';
import { IC } from '@/lib/icons';

export default function SettingsPage() {
  const { db, me, t, theme, toggleTheme, updateLang, setDb, showToast, showConfirm, logout, updateProfile, serverMode, ready } = useApp();
  const [editing, setEditing] = useState(false);

  if (!me) {
    return (
      <AppShell>
        <header className="header home-header">
          <div className="home-header-row">
            <div className="home-header-copy">
              <div className="header-title">{t('settings')}</div>
            </div>
            <div className="header-actions"><ThemeToggle compact /></div>
          </div>
        </header>
        {/* The session is still arriving on a cold load; a signed-in visitor
            should not be told to sign in while that happens. */}
        <div className="feed-empty">
          {ready && <><p>{t('needLogin')}</p><Link href="/login">{t('signIn')}</Link></>}
        </div>
      </AppShell>
    );
  }

  const setFlag = async (key: 'twoStep' | 'private' | 'notifyEmail', on: boolean) => {
    const flip = (value: boolean) => setDb(prev => ({ ...prev, users: prev.users.map(u => (u.id === me.id ? { ...u, [key]: value } : u)) }));
    flip(on);
    if (!serverMode) return showToast(t('savedOk'));
    try {
      await updateProfile({ [key]: on });
      showToast(t('savedOk'));
    } catch (err: any) {
      flip(!on);
      showToast(err?.message || 'That setting could not be saved.');
    }
  };

  const verifyEmail = () => {
    setDb(prev => ({ ...prev, users: prev.users.map(u => (u.id === me.id ? { ...u, emailVerified: true } : u)) }));
    showToast(t('verified'));
  };

  const resetDemo = () => {
    showConfirm(`${t('resetDemo')}? ${t('resetDemoHint')}`, () => {
      localStorage.removeItem(KEY);
      window.location.reload();
    });
  };

  return (
    <AppShell>
      <header className="header home-header">
        <div className="home-header-row">
          <div className="home-header-copy">
            <div className="header-title">{t('settings')}</div>
            <p className="header-sub">@{me.username}</p>
          </div>
          <div className="header-actions"><ThemeToggle compact /></div>
        </div>
      </header>

      <div className="settings-body">
        <section className="settings-card">
          <h2>{t('appearance')}</h2>
          <div className="settings-choices">
            <button type="button" className={`settings-choice ${theme === 'light' ? 'on' : ''}`} aria-pressed={theme === 'light'} onClick={() => theme !== 'light' && toggleTheme()}>
              {IC.sun}<span>Light</span>
            </button>
            <button type="button" className={`settings-choice ${theme === 'dark' ? 'on' : ''}`} aria-pressed={theme === 'dark'} onClick={() => theme !== 'dark' && toggleTheme()}>
              {IC.moon}<span>Dark</span>
            </button>
          </div>
        </section>

        <section className="settings-card">
          <h2>{t('language')}</h2>
          <div className="settings-choices">
            <button type="button" className={`settings-choice ${db.lang === 'en' ? 'on' : ''}`} aria-pressed={db.lang === 'en'} onClick={() => updateLang('en')}>
              <span className="settings-lang-mark">EN</span><span>English</span>
            </button>
            <button type="button" className={`settings-choice ${db.lang === 'ne' ? 'on' : ''}`} aria-pressed={db.lang === 'ne'} onClick={() => updateLang('ne')}>
              <span className="settings-lang-mark">ने</span><span>नेपाली</span>
            </button>
          </div>
        </section>

        <section className="settings-card">
          <h2>{t('account')}</h2>
          <div className="settings-account">
            <Avatar user={me} size={56} />
            <span className="settings-account-meta">
              <b>{me.name || me.username}{me.verified && <VerifiedBadge size={15} />}</b>
              <small>@{me.username} · {me.email}</small>
            </span>
            <button type="button" className="ghost-btn" onClick={() => setEditing(true)}>{t('editProfile')}</button>
          </div>
        </section>

        <section className="settings-card">
          <h2>{t('security')}</h2>
          <div className="settings-row">
            <span className="settings-row-copy">
              <b>{t('twoStep')}</b>
              <small>{t('twoStepHint')}</small>
            </span>
            <button type="button" role="switch" aria-checked={me.twoStep} aria-label={t('twoStep')} className={`switch ${me.twoStep ? 'on' : ''}`} onClick={() => setFlag('twoStep', !me.twoStep)}>
              <span className="switch-knob" />
            </button>
          </div>
          <div className="settings-row">
            <span className="settings-row-copy">
              <b>{t('email')}</b>
              <small>{me.email}</small>
            </span>
            {me.emailVerified ? (
              <span className="status-chip approved">{IC.check}{t('verified')}</span>
            ) : serverMode ? (
              <span className="status-chip pending">{t('notVerified')}</span>
            ) : (
              <button type="button" className="ghost-btn" onClick={verifyEmail}>{t('verifyNow')}</button>
            )}
          </div>
        </section>

        <section className="settings-card">
          <h2>{t('privacy')}</h2>
          <div className="settings-row">
            <span className="settings-row-copy">
              <b>{t('privateToggle')}</b>
              <small>{t('privateToggleSub')}</small>
            </span>
            <button type="button" role="switch" aria-checked={!!me.private} aria-label={t('privateToggle')} className={`switch ${me.private ? 'on' : ''}`} onClick={() => setFlag('private', !me.private)}>
              <span className="switch-knob" />
            </button>
          </div>
          <div className="settings-row">
            <span className="settings-row-copy">
              <b>{t('emailAlerts')}</b>
              <small>{t('emailAlertsSub')}</small>
            </span>
            <button type="button" role="switch" aria-checked={me.notifyEmail !== false} aria-label={t('emailAlerts')} className={`switch ${me.notifyEmail !== false ? 'on' : ''}`} onClick={() => setFlag('notifyEmail', me.notifyEmail === false)}>
              <span className="switch-knob" />
            </button>
          </div>
          <nav className="settings-legal">
            <Link href="/legal/privacy">{t('privacy')}</Link>
            <Link href="/legal/terms">{t('terms')}</Link>
            <Link href="/legal/user-policy">{t('userPolicy')}</Link>
            <Link href="/legal/cookies">{t('cookies')}</Link>
          </nav>
        </section>

        {!serverMode && (
          <section className="settings-card">
            <h2>{t('resetDemo')}</h2>
            <p className="settings-hint">{t('resetDemoHint')}</p>
            <button type="button" className="ghost-btn" onClick={resetDemo}>{t('resetDemo')}</button>
          </section>
        )}

        <button type="button" className="settings-logout" onClick={logout}>
          {IC.logout}<span>{t('logout')}</span>
        </button>
      </div>

      {editing && <EditProfileModal onClose={() => setEditing(false)} />}
    </AppShell>
  );
}