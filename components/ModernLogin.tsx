'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthCode from './AuthCode';
import BrandLogo from './BrandLogo';
import { AuthResult, useApp } from '@/lib/AppContext';
import { API_ENABLED } from '@/lib/api';
import { requestGoogleToken } from '@/lib/google';

type Step =
  | { kind: 'form' }
  | { kind: 'code'; challenge: string; expiresAt?: number; devCode?: string; hint?: string }
  | { kind: 'unlock' }
  | { kind: 'unlockCode'; challenge: string; expiresAt?: number; devCode?: string };

const GOOGLE_KEY = 'exposing-google';

export default function ModernLogin() {
  const { db, t, feature, ready, login, signin, verifyCode, resendCode, requestUnlock, confirmUnlock, googleSignIn, showToast } = useApp();
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (db.meId) router.replace('/');
  }, [db.meId, router]);

  const done = (name: string) => {
    showToast(t('welcome', { name }));
    router.push('/');
  };

  const needsSignup = (res: AuthResult) => {
    if (!res.needsSignup || !res.prefill) return false;
    sessionStorage.setItem(GOOGLE_KEY, JSON.stringify(res.prefill));
    router.push('/signup');
    return true;
  };

  /** Password tries burn the lockout counter; code tries only burn that one code. */
  const triesLeft = (n: number) => t(n === 1 ? 'codeTryOne' : 'codeTriesLeft', { n });
  const attemptsLeftText = (n: number) => t(n === 1 ? 'attemptLeftOne' : 'attemptsLeft', { n });

  /** Any answer that carries a challenge means the session is not live yet. */
  const afterAuth = (res: AuthResult) => {
    if (res.ok && res.user) {
      done(res.user.name || res.user.username);
      return;
    }
    if (res.ok && res.challenge) {
      setStep({
        kind: 'code',
        challenge: res.challenge,
        expiresAt: res.expiresIn ? Date.now() + res.expiresIn * 1000 : undefined,
        devCode: res.devCode,
        hint: res.emailHint || undefined,
      });
      return;
    }
    if (needsSignup(res)) return;
    if (res.locked) {
      setStep(res.challenge
        ? { kind: 'unlockCode', challenge: res.challenge, expiresAt: res.expiresIn ? Date.now() + res.expiresIn * 1000 : undefined, devCode: res.devCode }
        : { kind: 'unlock' });
      setError('');
      return;
    }
    setError(res.attemptsLeft !== undefined && res.attemptsLeft > 0
      ? `${res.detail} ${attemptsLeftText(res.attemptsLeft)}`
      : res.detail || t('needIdentifier'));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) return setError(t('needIdentifier'));
    if (!password) return setError(t('e_nopass'));
    setError('');
    setNotice('');

    if (!API_ENABLED) {
      const id = identifier.trim().toLowerCase().replace(/^@/, '');
      const user = db.users.find(u => u.email.toLowerCase() === id || u.username.toLowerCase() === id) || db.users[0];
      if (!user) return setError(t('e_noacc'));
      login(user.id);
      return done(user.name || user.username);
    }

    setBusy(true);
    try {
      afterAuth(await signin(identifier.trim(), password));
    } finally {
      setBusy(false);
    }
  };

  const confirmCode = async (code: string) => {
    if (step.kind !== 'code') return;
    setBusy(true);
    const res = await verifyCode(step.challenge, code, 'login');
    setBusy(false);
    if (res.ok && res.user) return done(res.user.name || res.user.username);
    if (res.ok && res.challenge) {
      setStep({ ...step, challenge: res.challenge, expiresAt: res.expiresIn ? Date.now() + res.expiresIn * 1000 : step.expiresAt, devCode: res.devCode });
      return;
    }
    setError(res.attemptsLeft !== undefined && res.attemptsLeft > 0
      ? `${res.detail} ${triesLeft(res.attemptsLeft)}`
      : res.detail || t('wrongCode'));
  };

  const resend = async () => {
    if (step.kind !== 'code' && step.kind !== 'unlockCode') return;
    const res = await resendCode(step.challenge);
    if (res.error) return setError(res.error);
    setStep({
      ...step,
      challenge: res.challenge || step.challenge,
      expiresAt: res.expiresIn ? Date.now() + res.expiresIn * 1000 : undefined,
      devCode: res.devCode,
    });
    setError('');
  };

  const askUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await requestUnlock(identifier.trim());
    setBusy(false);
    if (res.error) return setError(res.error);
    if (res.challenge) {
      setStep({ kind: 'unlockCode', challenge: res.challenge, expiresAt: res.expiresIn ? Date.now() + res.expiresIn * 1000 : undefined, devCode: res.devCode });
      setError('');
      return;
    }
    setError(res.detail || t('e_noacc'));
  };

  const confirmUnlockCode = async (code: string) => {
    if (step.kind !== 'unlockCode') return;
    setBusy(true);
    const res = await confirmUnlock(step.challenge, code);
    setBusy(false);
    if (!res.ok) return setError(res.detail || t('codeExpired'));
    setStep({ kind: 'form' });
    setPassword('');
    setError('');
    setNotice(res.detail || t('unlocked'));
  };

  const google = async () => {
    setError('');
    setBusy(true);
    try {
      const res = db.settings.googleClientId
        ? await googleSignIn({ id_token: await requestGoogleToken(db.settings.googleClientId) })
        : feature('googleDemo') && db.settings.demoGoogle
          ? await googleSignIn({ demo: db.settings.demoGoogle })
          : null;
      if (res) afterAuth(res);
      else if (!API_ENABLED) {
        const user = db.users.find(u => u.provider === 'google') || db.users[0];
        if (!user) setError(t('e_noacc'));
        else {
          login(user.id);
          done(user.name || user.username);
        }
      } else setError(t('googleUnavailable'));
    } catch {
      setError(t('googleUnavailable'));
    } finally {
      setBusy(false);
    }
  };

  // Until /api/meta/ lands the shipped defaults would promise a provider this server cannot finish.
  const showGoogle = API_ENABLED
    ? ready && (!!db.settings.googleClientId || feature('googleLogin') || feature('googleDemo'))
    : !!db.settings.googleClientId || feature('googleLogin') || feature('googleDemo');
  const googleLabel = db.settings.googleClientId ? t('google') : t('demoGoogle');
  const canSubmit = identifier.trim().length > 0 && password.length > 0 && !busy;

  return (
    <div className="login-container">
      <div className="login-content">
        <BrandLogo height={64} className="login-brand" href="/" />
        <h1 className="login-title">{t('loginTitle')}</h1>

        {step.kind === 'form' ? <>
          {showGoogle && (
            <button type="button" className="social-btn" onClick={google} disabled={busy}>
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              <span>{googleLabel}</span>
            </button>
          )}
          {showGoogle && <div className="login-divider">{t('or')}</div>}

          <form onSubmit={submit} noValidate>
            <input
              className="login-input"
              type="text"
              name="exposing-identifier"
              autoComplete="username"
              placeholder={t('identifier')}
              value={identifier}
              onChange={e => setIdentifier(e.target.value)}
            />
            <input
              className="login-input"
              type="password"
              name="exposing-password"
              autoComplete="current-password"
              placeholder={t('password')}
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
            {error ? <p className="signup-error" role="alert">{error}</p> : null}
            {notice ? <p className="auth-notice" role="status">{notice}</p> : null}
            <button type="submit" className={`login-submit ${canSubmit ? 'active' : ''}`} disabled={!canSubmit}>
              {busy ? t('checking') : t('signIn')}
            </button>
            <button type="button" className="auth-code-link auth-unlock-link" onClick={() => { setStep({ kind: 'unlock' }); setError(''); }}>
              {t('unlockAccount')}
            </button>
          </form>
        </> : null}

        {step.kind === 'code' ? (
          <AuthCode
            title={t('codeTitle')}
            detail={t('codeDetail')}
            hint={step.hint ? t('codeSentTo', { email: step.hint }) : undefined}
            expiresAt={step.expiresAt}
            devCode={step.devCode}
            error={error}
            busy={busy}
            submitLabel={t('confirm')}
            resendLabel={t('resendCode')}
            backLabel={t('backToLogin')}
            onCode={confirmCode}
            onResend={resend}
            onBack={() => { setStep({ kind: 'form' }); setError(''); }}
          />
        ) : null}

        {step.kind === 'unlock' ? (
          <div className="auth-code" role="group" aria-label={t('lockedTitle')}>
            <b className="auth-code-title">{t('lockedTitle')}</b>
            <p className="auth-code-detail">{t('lockedDetail')}</p>
            <form onSubmit={askUnlock} noValidate>
              <input
                className="login-input"
                type="text"
                name="exposing-unlock-identifier"
                autoComplete="username"
                placeholder={t('unlockEmail')}
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
              />
              {error ? <p className="signup-error" role="alert">{error}</p> : null}
              <button type="submit" className={`login-submit ${identifier.trim() && !busy ? 'active' : ''}`} disabled={!identifier.trim() || busy}>
                {busy ? t('checking') : t('sendUnlock')}
              </button>
            </form>
            <div className="auth-code-actions">
              <button type="button" className="auth-code-link" onClick={() => { setStep({ kind: 'form' }); setError(''); }}>{t('backToLogin')}</button>
            </div>
          </div>
        ) : null}

        {step.kind === 'unlockCode' ? (
          <AuthCode
            title={t('lockedTitle')}
            detail={t('codeDetail')}
            expiresAt={step.expiresAt}
            devCode={step.devCode}
            error={error}
            busy={busy}
            submitLabel={t('confirm')}
            resendLabel={t('resendCode')}
            backLabel={t('backToLogin')}
            onCode={confirmUnlockCode}
            onResend={resend}
            onBack={() => { setStep({ kind: 'form' }); setError(''); }}
          />
        ) : null}

        <p className="login-footer">
          Don&apos;t have an account? <a href="/signup" onClick={e => { e.preventDefault(); router.push('/signup'); }}>{t('signUp')}</a>
        </p>
        <nav className="auth-legal" aria-label="Legal">
          <a href="/legal/privacy">{t('privacy')}</a>
          <a href="/legal/terms">{t('terms')}</a>
          <a href="/legal/user-policy">{t('userPolicy')}</a>
          <a href="/legal/cookies">{t('cookies')}</a>
        </nav>
      </div>
    </div>
  );
}
