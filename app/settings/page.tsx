'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import Avatar from '@/components/Avatar';
import VerifiedBadge from '@/components/VerifiedBadge';
import ThemeToggle from '@/components/ThemeToggle';
import EditProfileModal from '@/components/EditProfileModal';
import { useApp } from '@/lib/AppContext';
import { api } from '@/lib/api';
import { disablePush, enablePush, pushState, PushState } from '@/lib/push';
import { mapPerson } from '@/lib/dto';
import { User } from '@/lib/types';
import { KEY } from '@/lib/utils';
import { IC } from '@/lib/icons';

export default function SettingsPage() {
  const { db, me, t, theme, toggleTheme, updateLang, setDb, showToast, showConfirm, logout, updateProfile, serverMode, ready, incomingRequests } = useApp();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /**
   * Push is the browser's own permission, so this switch reads the browser and
   * the click goes to the browser; the server only learns the address after the
   * member has already said yes. Reading it from the account instead would keep
   * a lit switch over a member who revoked the right in the address bar.
   */
  const [pushOn, setPushOn] = useState<PushState>('off');
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    void pushState().then(setPushOn);
  }, []);

  const setPush = async (on: boolean) => {
    if (pushBusy) return;
    setPushBusy(true);
    if (!on) {
      await disablePush();
      setPushOn('off');
      setPushBusy(false);
      return showToast(t('pushOffOk'));
    }
    const out = await enablePush();
    setPushBusy(false);
    if (!out.ok) {
      // The operating system said no, which is the only answer that matters
      // here — re-read it rather than arguing with what it shows.
      setPushOn(await pushState());
      return showToast(out.detail || t('pushBlocked'));
    }
    setPushOn('on');
    showToast(t('pushOnOk'));
  };

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

  const setFlag = async (key: 'twoStep' | 'private' | 'notifyEmail' | 'notifyFollowEmail', on: boolean) => {
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

  const pendingRequests = incomingRequests().length;

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
          <div className="settings-row">
            <span className="settings-row-copy">
              <b>{t('followRequests')}</b>
            </span>
            <Link href={`/u/${me.username}/followers`} className="ghost-btn">
              {IC.user}{t('seeAll')}
              {pendingRequests > 0 && <span className="settings-count">{pendingRequests}</span>}
            </Link>
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
              <b>{t('warnEmails')}</b>
              <small>{t('warnEmailsSub')}</small>
            </span>
            <button type="button" role="switch" aria-checked={me.notifyEmail !== false} aria-label={t('warnEmails')} className={`switch ${me.notifyEmail !== false ? 'on' : ''}`} onClick={() => setFlag('notifyEmail', me.notifyEmail === false)}>
              <span className="switch-knob" />
            </button>
          </div>
          <div className="settings-row">
            <span className="settings-row-copy">
              <b>{t('emailAlerts')}</b>
              <small>{t('emailAlertsSub')}</small>
            </span>
            <button type="button" role="switch" aria-checked={me.notifyFollowEmail !== false} aria-label={t('emailAlerts')} className={`switch ${me.notifyFollowEmail !== false ? 'on' : ''}`} onClick={() => setFlag('notifyFollowEmail', me.notifyFollowEmail === false)}>
              <span className="switch-knob" />
            </button>
          </div>
          <div className="settings-row">
            <span className="settings-row-copy">
              <b>{t('pushAlerts')}</b>
              <small>{pushOn === 'blocked' ? t('pushBlockedSub') : t('pushAlertsSub')}</small>
            </span>
            <button type="button" role="switch" aria-checked={pushOn === 'on'} disabled={pushBusy || pushOn === 'unsupported'} aria-label={t('pushAlerts')} className={`switch ${pushOn === 'on' ? 'on' : ''}`} onClick={() => setPush(pushOn !== 'on')}>
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

        <BlockedPeople />

        <section className="settings-card settings-danger">
          <h2>{t('dangerZone')}</h2>
          <div className="settings-row">
            <span className="settings-row-copy">
              <b>{t('deleteAccount')}</b>
              <small>{t('deleteAccountHint')}</small>
            </span>
            <button type="button" className="ghost-btn delete-account-btn" onClick={() => setDeleting(true)}>{t('deleteAccount')}</button>
          </div>
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
      {deleting && me && <DeleteAccountModal onClose={() => setDeleting(false)} />}
    </AppShell>
  );
}

/**
 * The account's closed doors: everyone this seat blocked, each with the one
 * tap that reopens the door. The server owns the list — it is the same truth
 * the block rules enforce — so it is read fresh rather than reconstructed from
 * the session cache, which only ever holds a slice of people.
 */
function BlockedPeople() {
  const { db, me, serverMode, t, unblockUser, showToast, setDb } = useApp();
  const [rows, setRows] = useState<any[] | null>(null);

  const read = () => {
    if (!serverMode) {
      setRows((db.blocks || []).map(id => db.users.find(u => u.id === id)).filter(Boolean));
      return;
    }
    api.get<any>('/api/follows/blocked/')
      .then(data => {
        setRows(data.results || []);
        // The cards land in the cache so Unblock has a username to act on even
        // for a person this session never met.
        const people: User[] = (data.results || []).map(mapPerson);
        setDb(prev => ({
          ...prev,
          users: [...prev.users.filter(u => !people.some((p: User) => p.id === u.id)), ...people],
        }));
      })
      .catch(() => setRows([]));
  };

  useEffect(() => { if (me) read(); }, [me?.id, serverMode]);

  if (!me || !rows) return null;

  return (
    <section className="settings-card">
      <h2>{t('blockedPeople')}</h2>
      {rows.length === 0 ? (
        <p className="settings-hint">{t('blockedNone')}</p>
      ) : (
        <div className="settings-blocked">
          {rows.map(u => (
            <div className="settings-blocked-row" key={u.id ?? u.username}>
              <Avatar user={mapPerson(u)} size={40} />
              <span className="settings-account-meta">
                <b>{u.name || u.username}{u.verified && <VerifiedBadge size={15} />}</b>
                <small>@{u.username}</small>
              </span>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  void unblockUser(String(u.id)).then(() => read());
                }}
              >
                {t('unblock')}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Two steps stand between a curious tap and a deleted account: the word the
 * reader has to type, and a code the server mails to the address on file.
 */
function DeleteAccountModal({ onClose }: { onClose: () => void }) {  const { me, t, serverMode, showToast, requestAccountDeletion, confirmAccountDeletion } = useApp();
  const [word, setWord] = useState('');
  const [step, setStep] = useState<'word' | 'code'>('word');
  const [challenge, setChallenge] = useState<number>(0);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const codeRef = useRef<HTMLInputElement>(null);

  const armed = word.trim().toUpperCase() === 'DELETE';

  const askForCode = async () => {
    if (!armed) return;
    setBusy(true);
    setError('');
    try {
      if (!serverMode) {
        await confirmAccountDeletion(0, '');
        return;
      }
      const read = await requestAccountDeletion('DELETE');
      if (!read?.challenge) {
        setError(read?.detail || 'The server did not start the deletion. Try again.');
        return;
      }
      setChallenge(read.challenge);
      setStep('code');
      showToast(t('deleteCodeSent').replace('{email}', me?.email || ''));
      setTimeout(() => codeRef.current?.focus(), 60);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The deletion could not be started.');
    } finally {
      setBusy(false);
    }
  };

  const finish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim().length < 4) {
      setError('Enter the code from the email.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await confirmAccountDeletion(challenge, code.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code did not go through.');
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal-content delete-account-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('deleteAccount')}>
        <div className="modal-header">
          <b>{t('deleteAccount')}</b>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t('close')} disabled={busy}>{IC.x}</button>
        </div>

        {step === 'word' ? (
          <div className="delete-account-body">
            <p className="delete-account-warning">{t('deleteAccountHint')}</p>
            <label className="field">
              <span>{t('deleteTypeHint')}</span>
              <input
                type="text"
                value={word}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                placeholder="DELETE"
                onChange={e => setWord(e.target.value)}
              />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="button" className="promote-submit delete-account-submit" disabled={!armed || busy} onClick={() => { void askForCode(); }}>
              {busy ? '…' : t('deleteConfirm')}
            </button>
          </div>
        ) : (
          <form className="delete-account-body" onSubmit={finish}>
            <p className="delete-account-warning">{t('deleteCodeSent').replace('{email}', me?.email || '')}</p>
            <label className="field">
              <span>{t('deleteCodeTitle')}</span>
              <input
                ref={codeRef}
                type="text"
                inputMode="numeric"
                value={code}
                maxLength={6}
                autoComplete="one-time-code"
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              />
              <small className="field-count">{t('deleteCodeHint')}</small>
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="submit" className="promote-submit delete-account-submit" disabled={busy}>
              {busy ? '…' : t('deleteConfirm')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}