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
  | { kind: 'code'; challenge: string; expiresAt?: number; devCode?: string; hint?: string };

const GOOGLE_KEY = 'exposing-google';
/** The account seed_demo fills with posts, chats, reels and listings. */
const DEMO = { email: 'sita@demo.test', password: 'exposing-demo-1' };
/** What the server locks for when the third password is wrong. */
const LOCK_SECONDS = 5 * 60;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function ModernLogin() {
  const { db, t, feature, ready, waking, login, signin, verifyCode, resendCode, googleSignIn, showToast } = useApp();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  /** Seconds left on the cooloff, or null once it is over. */
  const [lockedFor, setLockedFor] = useState<number | null>(null);

  useEffect(() => {
    if (db.meId) router.replace('/');
  }, [db.meId, router]);

  useEffect(() => {
    if (!lockedFor) return;
    if (lockedFor <= 1) {
      setLockedFor(null);
      setNotice(t('lockedReady'));
      return;
    }
    const id = setTimeout(() => setLockedFor(lockedFor - 1), 1000);
    return () => clearTimeout(id);
  }, [lockedFor, t]);

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

  /**
   * A failure that came from the server's own bug is the one message worth
   * quoting back with its handle: that id is the line in the log, and the person
   * staring at it cannot read the log.
   */
  const withRef = (res: AuthResult) => (res.requestId && res.status >= 500 && res.detail
    ? `${res.detail} (ref ${res.requestId})`
    : res.detail);

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
      setError('');
      setNotice('');
      const secs = res.retryIn ?? (res.lockedUntil ? Math.ceil((res.lockedUntil - Date.now()) / 1000) : null);
      setLockedFor(secs === null || secs <= 0 ? 0 : Math.min(secs, LOCK_SECONDS));
      return;
    }
    // The password was right and the address was never confirmed, which the old
    // build answered with a box that said nothing useful. Say which it is, then
    // hand over the code it just sent — with the resend the server offers.
    if (res.emailNotVerified && res.challenge) {
      setError('');
      setNotice(t('emailNotVerified'));
      setStep({
        kind: 'code',
        challenge: res.challenge,
        expiresAt: res.expiresIn ? Date.now() + res.expiresIn * 1000 : undefined,
        devCode: res.devCode,
        hint: res.emailHint || email.trim(),
      });
      return;
    }
    setError(res.attemptsLeft !== undefined && res.attemptsLeft > 0
      ? `${withRef(res)} ${attemptsLeftText(res.attemptsLeft)}`
      : withRef(res) || t('needEmail'));
  };

  const run = async (id: string, pass: string) => {
    setBusy(true);
    try {
      afterAuth(await signin(id, pass));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!value) return setError(t('needEmail'));
    // Caught here rather than at the server so the box can say what it wants
    // before a person spends one of their three password tries on a username.
    if (!value.includes('@')) return setError(t('needEmailAt'));
    if (!password) return setError(t('e_nopass'));
    setError('');
    setNotice('');

    if (!API_ENABLED) {
      const id = value.toLowerCase();
      const user = db.users.find(u => (u.email || '').toLowerCase() === id);
      if (!user) return setError(t('e_noacc'));
      login(user.id);
      return done(user.name || user.username);
    }

    void run(value.toLowerCase(), password);
  };

  /** One tap, because a reviewer should not have to type a seeded password. */
  const useDemo = () => {
    setError('');
    setNotice('');
    setEmail(DEMO.email);
    setPassword(DEMO.password);
    if (!API_ENABLED) {
      const user = db.users.find(u => (u.email || '').toLowerCase() === DEMO.email);
      if (!user) return setError(t('e_noacc'));
      login(user.id);
      return done(user.name || user.username);
    }
    void run(DEMO.email, DEMO.password);
  };

  const confirmCode = async (code: string) => {
    if (step.kind !== 'code') return;
    setBusy(true);
    try {
      const res = await verifyCode(step.challenge, code);
      if (res.ok && res.user) return done(res.user.name || res.user.username);
      if (res.ok && res.challenge) {
        setStep({ ...step, challenge: res.challenge, expiresAt: res.expiresIn ? Date.now() + res.expiresIn * 1000 : step.expiresAt, devCode: res.devCode });
        return;
      }
      setError(res.attemptsLeft !== undefined && res.attemptsLeft > 0
        ? `${withRef(res)} ${triesLeft(res.attemptsLeft)}`
        : withRef(res) || t('wrongCode'));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (step.kind !== 'code') return;
    setBusy(true);
    try {
      const res = await resendCode(step.challenge);
      if (res.error) return setError(res.error);
      setStep({
        ...step,
        challenge: res.challenge || step.challenge,
        expiresAt: res.expiresIn ? Date.now() + res.expiresIn * 1000 : undefined,
        devCode: res.devCode,
      });
      setError('');
    } finally {
      setBusy(false);
    }
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
    } catch (err) {
      // Which half failed matters to the visitor: a cancelled chooser and a browser
      // that cannot show one are different dead ends.
      setError((err as Error)?.message || t('googleUnavailable'));
    } finally {
      setBusy(false);
    }
  };

  // Until /api/meta/ lands the shipped defaults would promise a provider this server cannot finish.
  const showGoogle = API_ENABLED
    ? ready && (!!db.settings.googleClientId || feature('googleLogin') || feature('googleDemo'))
    : !!db.settings.googleClientId || feature('googleLogin') || feature('googleDemo');
  const googleLabel = db.settings.googleClientId ? t('google') : t('demoGoogle');
  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  return (
    <div className="login-container">
      <div className="login-content">
        <BrandLogo height={64} className="login-brand" href="/" />
        <h1 className="login-title">{t('loginTitle')}</h1>
        {waking ? <p className="auth-notice" role="status">{t('waking')}</p> : null}

        {step.kind === 'form' && lockedFor === null ? <>
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
              type="email"
              name="exposing-email"
              autoComplete="email"
              placeholder={t('email')}
              value={email}
              onChange={e => setEmail(e.target.value)}
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
            <button type="button" className="login-demo" onClick={useDemo} disabled={busy}>
              <b>{t('demoSignIn')}</b>
              <span>{t('demoCreds')}</span>
            </button>
          </form>
        </> : null}

        {step.kind === 'code' ? (
          <>
            {notice ? <p className="auth-notice" role="status">{notice}</p> : null}
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
              onBack={() => { setStep({ kind: 'form' }); setError(''); setNotice(''); }}
            />
          </>
        ) : null}

        {lockedFor !== null ? (
          <div className="auth-code" role="group" aria-label={t('lockedTitle')}>
            <b className="auth-code-title">{t('lockedTitle')}</b>
            <p className="auth-code-detail">{t('lockedDetail')}</p>
            {lockedFor > 0 ? (
              <p className="auth-lock-clock" role="timer">{t('lockedWait', { time: mmss(lockedFor) })}</p>
            ) : (
              <div className="auth-code-actions">
                <button type="button" className="auth-code-link" onClick={() => setLockedFor(null)}>{t('backToLogin')}</button>
              </div>
            )}
          </div>
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
