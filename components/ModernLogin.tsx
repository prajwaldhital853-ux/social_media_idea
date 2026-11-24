'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthCode from './AuthCode';
import BrandLogo from './BrandLogo';
import { AuthResult, useApp } from '@/lib/AppContext';
import { API_ENABLED } from '@/lib/api';
import GoogleButton from '@/components/GoogleButton';

type Step =
  | { kind: 'form' }
  | { kind: 'code'; challenge: string; expiresAt?: number; hint?: string };

const GOOGLE_KEY = 'exposing-google';
/** 4:59, or 6:20:00 — a repeat guesser is told the truth about a longer wait. */
const clock = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

export default function ModernLogin() {
  const { db, t, ready, waking, login, signin, verifyCode, resendCode, googleSignIn, showToast } = useApp();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  /** Seconds left on the cooloff, or null once it is over. */
  const [lockedFor, setLockedFor] = useState<number | null>(null);
  /** Which door the server closed: the account, this browser, or a staff-banned connection. */
  const [banScope, setBanScope] = useState('email');

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
        hint: res.emailHint || undefined,
      });
      return;
    }
    if (needsSignup(res)) return;
    // Nothing was guessed wrong here: the account simply has no password to type,
    // because Google opened it. That is a pointer, not a failure, so it is not
    // written in red and it spends none of the three tries.
    if (res.googleOnly) {
      setError('');
      setNotice(res.detail || t('googleOnlyHint'));
      return;
    }
    // A suspended seat is not a wrong guess. The server says the reason and when
    // it ends, so the screen repeats it instead of a red "wrong password" that
    // would send the person trying the same Google account a fourth time.
    if (res.suspended) {
      setError('');
      setNotice(res.detail || t('suspNotice'));
      return;
    }
    if (res.locked) {
      setError('');
      setNotice('');
      setBanScope(res.banScope === 'ip' || res.banScope === 'device' ? res.banScope : 'email');
      const secs = res.retryIn ?? (res.lockedUntil ? Math.ceil((res.lockedUntil - Date.now()) / 1000) : null);
      // The wait is the server's number, not this screen's guess: a repeat guesser
      // is locked for longer than the first cooloff and must see that.
      setLockedFor(secs === null || secs <= 0 ? 0 : secs);
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
      if (!user || id.endsWith('@demo.test')) return setError(t('e_noacc'));
      login(user.id);
      return done(user.name || user.username);
    }

    void run(value.toLowerCase(), password);
  };

  const confirmCode = async (code: string) => {
    if (step.kind !== 'code') return;
    setBusy(true);
    try {
      const res = await verifyCode(step.challenge, code);
      if (res.ok && res.user) return done(res.user.name || res.user.username);
      if (res.ok && res.challenge) {
        setStep({ ...step, challenge: res.challenge, expiresAt: res.expiresIn ? Date.now() + res.expiresIn * 1000 : step.expiresAt });
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
      });
      setError('');
    } finally {
      setBusy(false);
    }
  };

  // Google's own button hands back the token; this is the half that spends it.
  const googleToken = async (token: string) => {
    setError('');
    try {
      const res = await googleSignIn({ id_token: token });
      if (res) afterAuth(res);
    } catch (err) {
      setError((err as Error)?.message || t('googleUnavailable'));
    }
  };

  const showGoogle = ready && !!db.settings.googleClientId;
  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;
  // One panel, three answers: the account cooled off, this browser is barred, or
  // the network outside it is. They wait differently, so they must read differently.
  const banTitle = banScope === 'ip' ? t('banIpTitle') : banScope === 'device' ? t('banDeviceTitle') : t('lockedTitle');
  const banDetail = banScope === 'ip' ? t('banIpDetail') : banScope === 'device' ? t('banDeviceDetail') : t('lockedDetail');

  return (
    <div className="login-container">
      <div className="login-content">
        <BrandLogo height={64} className="login-brand" href="/" />
        <h1 className="login-title">{t('loginTitle')}</h1>
        {waking ? <p className="auth-notice" role="status">{t('waking')}</p> : null}

        {step.kind === 'form' && lockedFor === null ? <>
          {showGoogle && (
            <GoogleButton clientId={db.settings.googleClientId!} onToken={googleToken} onError={setError} fallback={null} />
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
            <button type="button" className="login-forgot" onClick={() => router.push('/forgot')}>
              {t('forgot')}
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
          <div className="auth-code" role="group" aria-label={banTitle}>
            <b className="auth-code-title">{banTitle}</b>
            <p className="auth-code-detail">{banDetail}</p>
            {lockedFor > 0 ? (
              <p className="auth-lock-clock" role="timer">{t('lockedWait', { time: clock(lockedFor) })}</p>
            ) : (
              <div className="auth-code-actions">
                <button type="button" className="auth-code-link" onClick={() => setLockedFor(null)}>{t('backToLogin')}</button>
              </div>
            )}
          </div>
        ) : null}

        {/* A locked account gets no side doors on this screen: not another signup,
            not a reset letter, not the Google button. Only the wait is offered. */}
        {lockedFor === null ? (
          <p className="login-footer">
            Don&apos;t have an account? <a href="/signup" onClick={e => { e.preventDefault(); router.push('/signup'); }}>{t('signUp')}</a>
          </p>
        ) : null}
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
