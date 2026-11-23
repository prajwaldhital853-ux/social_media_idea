'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import BrandLogo from '@/components/BrandLogo';
import { useApp } from '@/lib/AppContext';
import { API_ENABLED } from '@/lib/api';
import { THEME_KEY } from '@/lib/utils';

type Step = 'ask' | 'code' | 'done';

/** 1:58 — both clocks on this screen are minutes and seconds. */
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function ForgotPage() {
  const { t, requestPasswordReset, confirmPasswordReset, resendCode } = useApp();
  const router = useRouter();
  const [step, setStep] = useState<Step>('ask');
  const [email, setEmail] = useState('');
  const [challenge, setChallenge] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [devCode, setDevCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  // Two deadlines, kept as instants and read against one ticking clock, so a
  // backgrounded tab that skipped ticks still shows the true remaining time.
  const [resendAt, setResendAt] = useState(0);
  const [expiresAt, setExpiresAt] = useState(0);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', 'dark');
    return () => {
      const saved = localStorage.getItem(THEME_KEY);
      root.setAttribute('data-theme', saved === 'dark' ? 'dark' : 'light');
    };
  }, []);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const resendLeft = resendAt > now ? Math.ceil((resendAt - now) / 1000) : 0;
  const expiresLeft = expiresAt > now ? Math.ceil((expiresAt - now) / 1000) : 0;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!value) return setError(t('needEmail'));
    if (!value.includes('@')) return setError(t('needEmailAt'));
    if (!API_ENABLED) return setError(t('resetNeedsServer'));
    setError('');
    setNotice('');
    setBusy(true);
    const res = await requestPasswordReset(value);
    setBusy(false);
    if (res.error) return setError(res.error);
    // The letter is the same whether or not an account stands behind the address,
    // so the screen says that much and nothing more.
    setNotice(t('resetSent'));
    if (!res.challenge) return;
    setChallenge(res.challenge);
    setDevCode(res.devCode || '');
    setExpiresAt(Date.now() + (res.expiresIn || 600) * 1000);
    setResendAt(Date.now() + (res.resendIn || 120) * 1000);
    setStep('code');
  };

  const resend = async () => {
    if (!challenge || resendLeft > 0 || busy) return;
    setBusy(true);
    setError('');
    const res = await resendCode(challenge);
    setBusy(false);
    if (res.error) {
      // The server holds the real wait, so its number wins over this screen's.
      if (res.resendIn) setResendAt(Date.now() + res.resendIn * 1000);
      return setError(res.error);
    }
    if (!res.challenge) return;
    setChallenge(res.challenge);
    setDevCode(res.devCode || '');
    setExpiresAt(Date.now() + (res.expiresIn || 600) * 1000);
    setResendAt(Date.now() + (res.resendIn || 120) * 1000);
    setCode('');
    setNotice(t('resetResent'));
  };

  const apply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return setError(t('wrongCode'));
    if (!password) return setError(t('e_nopass'));
    if (password !== again) return setError(t('passwordMismatch'));
    setBusy(true);
    setError('');
    const res = await confirmPasswordReset(challenge, code, password, email.trim());
    setBusy(false);
    if (!res.ok) return setError(res.detail || t('wrongCode'));
    setStep('done');
    setNotice(t('resetDone'));
    setError('');
  };

  return (
    <div className="login-container">
      <div className="login-content">
        <BrandLogo height={64} className="login-brand" href="/" />
        <h1 className="login-title">{t('forgotTitle')}</h1>
        <p className="auth-code-detail">{t('forgotDetail')}</p>

        {step === 'ask' ? (
          <form onSubmit={send} noValidate>
            <input
              className="login-input"
              type="email"
              name="exposing-email"
              autoComplete="email"
              placeholder={t('email')}
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
            {error ? <p className="signup-error" role="alert">{error}</p> : null}
            {notice ? <p className="auth-notice" role="status">{notice}</p> : null}
            <button type="submit" className={`login-submit ${email.trim() && !busy ? 'active' : ''}`} disabled={!email.trim() || busy}>
              {busy ? t('checking') : t('sendCode')}
            </button>
          </form>
        ) : null}

        {step === 'code' ? (
          <form onSubmit={apply} noValidate>
            {notice ? <p className="auth-notice" role="status">{notice}</p> : null}
            <p className="auth-code-hint">{t('codeSentTo', { email })}</p>
            <input
              className="login-input auth-code-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              aria-label={t('codeTitle')}
              value={code}
              disabled={busy}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            {devCode ? (
              <button type="button" className="auth-code-dev" onClick={() => setCode(devCode)}>
                {t('devCode')} <b>{devCode}</b>
              </button>
            ) : null}
            <input
              className="login-input"
              type="password"
              name="exposing-new-password"
              autoComplete="new-password"
              placeholder={t('newPassword')}
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
            <input
              className="login-input"
              type="password"
              name="exposing-new-password-again"
              autoComplete="new-password"
              placeholder={t('confirmPassword')}
              value={again}
              onChange={e => setAgain(e.target.value)}
            />
            <p className="auth-code-meta">
              {expiresLeft > 0 ? `${t('codeExpiresIn')} ${clock(expiresLeft)}` : t('codeExpired')}
            </p>
            {resendLeft > 0 ? <p className="auth-code-meta" role="timer">{t('nextCodeIn', { time: clock(resendLeft) })}</p> : null}
            {error ? <p className="signup-error" role="alert">{error}</p> : null}
            <button
              type="submit"
              className={`login-submit ${code.length === 6 && password && again && !busy ? 'active' : ''}`}
              disabled={code.length !== 6 || !password || !again || busy}
            >
              {busy ? t('checking') : t('setPassword')}
            </button>
            <div className="auth-code-actions">
              <button type="button" className="auth-code-link" disabled={resendLeft > 0 || busy} onClick={() => void resend()}>
                {resendLeft > 0 ? `${t('resendCode')} in ${clock(resendLeft)}` : t('resendCode')}
              </button>
              <button
                type="button"
                className="auth-code-link"
                onClick={() => { setStep('ask'); setChallenge(''); setCode(''); setPassword(''); setAgain(''); setError(''); setNotice(''); }}
              >
                {t('backToLogin')}
              </button>
            </div>
          </form>
        ) : null}

        {step === 'done' ? (
          <div className="auth-code" role="group" aria-label={t('passwordChanged')}>
            <b className="auth-code-title">{t('passwordChanged')}</b>
            <p className="auth-code-detail">{notice}</p>
            <div className="auth-code-actions">
              <button type="button" className="auth-code-link" onClick={() => router.push('/login')}>{t('signIn')}</button>
            </div>
          </div>
        ) : null}

        <p className="login-footer">
          {t('haveAccount')}{' '}
          <a href="/login" onClick={e => { e.preventDefault(); router.push('/login'); }}>{t('signIn')}</a>
        </p>
        <nav className="auth-legal" aria-label="Legal">
          <a href="/legal/privacy">{t('privacy')}</a>
          <a href="/legal/terms">{t('terms')}</a>
        </nav>
      </div>
    </div>
  );
}
