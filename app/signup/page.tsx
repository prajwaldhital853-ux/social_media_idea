'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AuthCode from '@/components/AuthCode';
import BrandLogo from '@/components/BrandLogo';
import { AuthResult, useApp } from '@/lib/AppContext';
import { API_ENABLED } from '@/lib/api';
import { rememberGoogleAccount } from '@/lib/google';
import { COUNTRIES, THEME_KEY, ageFromDob, uid } from '@/lib/utils';
import { IC } from '@/lib/icons';
import { SignupProvider, User } from '@/lib/types';
import type { TranslationKey } from '@/lib/i18n';

const GOOGLE_KEY = 'exposing-google';
type Prefill = { email: string; name: string; google_sub: string };
type FieldName = 'name' | 'username' | 'email' | 'password' | 'dob' | 'country' | 'province' | 'city' | 'age' | 'legal';
type FieldErrors = Partial<Record<FieldName, string>>;
const FIELD_ORDER: FieldName[] = ['name', 'username', 'email', 'password', 'dob', 'country', 'province', 'city'];

/**
 * A failure the server wrote itself carries the handle for its own log line,
 * which is the one thing a visitor can quote back to someone who can read it.
 */
const serverRef = (res: AuthResult) => (res.requestId && res.status >= 500 && res.detail
  ? `${res.detail} (ref ${res.requestId})`
  : res.detail);

/**
 * A lock closes the sign-up door as well: the account or browser is paused.
 * A connection appears only for a deliberate staff ban, so this page says which
 * door is holding and for how long instead of blaming the email box.
 */
const banLine = (res: AuthResult, t: (key: TranslationKey, vars?: Record<string, string | number>) => string) =>
  t(res.banScope === 'device' ? 'e_bannedDevice' : res.banScope === 'ip' ? 'e_bannedIp' : 'e_locked',
    { time: Math.max(1, Math.ceil((res.retryIn || 0) / 60)) });

export default function SignupPage() {
  const { db, t, feature, waking, setDb, showToast, signupAccount, verifyCode, resendCode } = useApp();
  const router = useRouter();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [dob, setDob] = useState('');
  const [country, setCountry] = useState('Nepal');
  const [province, setProvince] = useState('');
  const [city, setCity] = useState('');
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [ageOk, setAgeOk] = useState(false);
  const [legalOk, setLegalOk] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const fields = useRef<Partial<Record<FieldName, HTMLElement | null>>>({});
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [code, setCode] = useState<{ challenge: string; expiresAt?: number } | null>(null);

  useEffect(() => {
    setMounted(true);
    const raw = sessionStorage.getItem(GOOGLE_KEY);
    if (!raw) return;
    sessionStorage.removeItem(GOOGLE_KEY);
    try {
      const next = JSON.parse(raw) as Prefill;
      setPrefill(next);
      setEmail(next.email);
      setName(next.name);
    } catch { /* a malformed hand-off is just no hand-off */ }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', 'dark');
    return () => {
      const saved = localStorage.getItem(THEME_KEY);
      root.setAttribute('data-theme', saved === 'dark' ? 'dark' : 'light');
    };
  }, []);

  const showFieldError = (field: FieldName, message: string) => {
    setError('');
    setFieldErrors({ [field]: message });
    requestAnimationFrame(() => {
      const input = fields.current[field];
      if (!input) return;
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      input.focus({ preventScroll: true });
    });
  };

  const clearFieldError = (field: FieldName) => setFieldErrors(prev => {
    if (!prev[field]) return prev;
    const next = { ...prev };
    delete next[field];
    return next;
  });

  const localAccount = (data: { name: string; username: string; email: string; dob: string; country: string; province?: string; city?: string; provider: SignupProvider }) => {
    // Signing up is never a second way in. An address or handle that already
    // belongs to someone has to be refused, not handed out as their session.
    const clash = db.users.find(u => u.username.toLowerCase() === data.username.toLowerCase() || u.email.toLowerCase() === data.email.toLowerCase());
    if (clash) {
      return clash.username.toLowerCase() === data.username.toLowerCase()
        ? showFieldError('username', t('e_taken'))
        : showFieldError('email', t('e_hasacc'));
    }
    const user: User = {
      id: uid(), email: data.email.toLowerCase(), username: data.username, name: data.name,
      role: 'user', verified: false, emailVerified: data.provider !== 'email', susp: null,
      provider: data.provider, dob: data.dob, country: data.country,
      province: data.province || '', city: data.city || '', bio: '',
      twoStep: false, joined: Date.now(), coins: 0, warning: null
    };
    setDb(prev => ({ ...prev, users: [...prev.users, user], meId: user.id }));
    rememberGoogleAccount(user.email);
    showToast(t('welcome', { name: user.name }));
    router.push('/');
  };

  const validate = (): { field: FieldName; message: string } | null => {
    if (!name.trim()) return { field: 'name', message: t('fullName') };
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return { field: 'username', message: t('e_user') };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { field: 'email', message: t('e_email') };
    if (!prefill && password.length < 10) return { field: 'password', message: t('e_pass') };
    if (!dob || ageFromDob(dob) < 13) return { field: 'dob', message: t('e_dob13') };
    if (!ageOk) return { field: 'age', message: t('e_age') };
    if (!legalOk) return { field: 'legal', message: t('e_legal') };
    return null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = validate();
    if (invalid) return showFieldError(invalid.field, invalid.message);
    setError('');
    setFieldErrors({});

    if (!API_ENABLED) {
      return localAccount({
        name: name.trim(), username, email, dob, country, province, city,
        provider: prefill ? 'google' : 'email'
      });
    }

    setBusy(true);
    try {
      const res = await signupAccount({
        username, email, password, name: name.trim(), dob, country, province, city,
        google: prefill ? { sub: prefill.google_sub, email: prefill.email, name: prefill.name } : undefined,
      });
      if (!res.ok) {
        if (res.locked) return setError(banLine(res, t));
        const detail = serverRef(res) || '';
        const field = FIELD_ORDER.find(name => res.errors?.[name]?.length) || (
          /password/i.test(detail) ? 'password'
            : /username/i.test(detail) ? 'username'
              : /email/i.test(detail) ? 'email'
                : /date of birth/i.test(detail) ? 'dob'
                  : /country/i.test(detail) ? 'country' : undefined
        );
        if (field) return showFieldError(field, res.errors?.[field]?.[0] || detail || t('e_email'));
        setError(detail || t('e_email'));
        return;
      }
      if (res.challenge) {
        setCode({
          challenge: res.challenge,
          expiresAt: res.expiresIn ? Date.now() + res.expiresIn * 1000 : undefined,
        });
        return;
      }
      showToast(t('welcome', { name: res.user?.name || name.trim() }));
      router.push('/');
    } finally {
      setBusy(false);
    }
  };

  const confirmCode = async (value: string) => {
    if (!code) return;
    setBusy(true);
    try {
      const res = await verifyCode(code.challenge, value);
      if (res.ok && res.user) {
        showToast(t('welcome', { name: res.user.name || res.user.username }));
        router.push('/');
        return;
      }
      if (res.ok && res.challenge) {
        setCode({ challenge: res.challenge, expiresAt: res.expiresIn ? Date.now() + res.expiresIn * 1000 : code.expiresAt });
        return;
      }
      setError(res.attemptsLeft !== undefined && res.attemptsLeft > 0
        ? `${serverRef(res)} ${t(res.attemptsLeft === 1 ? 'codeTryOne' : 'codeTriesLeft', { n: res.attemptsLeft })}`
        : serverRef(res) || t('wrongCode'));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!code) return;
    setBusy(true);
    try {
      const res = await resendCode(code.challenge);
      if (res.error) return setError(res.error);
      setCode({ challenge: res.challenge || code.challenge, expiresAt: res.expiresIn ? Date.now() + res.expiresIn * 1000 : undefined });
      setError('');
    } finally {
      setBusy(false);
    }
  };

  const socialAccount = (provider: 'facebook' | 'apple', demo: { name: string; username: string; email: string; dob: string; city: string }) => {
    localAccount({ ...demo, country: 'Nepal', province: 'Bagmati', provider });
  };

  if (!mounted) return null;

  if (code) {
    return (
      <div className="login-container signup-container">
        <div className="login-content signup-content">
          <BrandLogo height={56} className="login-brand" href="/" />
          {waking ? <p className="auth-notice" role="status">{t('waking')}</p> : null}
          <AuthCode
            title={t('codeTitle')}
            detail={t('codeVerifyDetail', { email })}
            hint={t('codeSentTo', { email })}
            expiresAt={code.expiresAt}
            error={error}
            busy={busy}
            submitLabel={t('confirm')}
            resendLabel={t('resendCode')}
            backLabel={t('backToLogin')}
            onCode={confirmCode}
            onResend={resend}
            onBack={() => { setCode(null); setError(''); }}
          />
        </div>
      </div>
    );
  }

  const showSocial = !API_ENABLED && (feature('facebookLogin') || feature('appleLogin'));

  return (
    <div className="login-container signup-container">
      <div className="login-content signup-content">
        <BrandLogo height={56} className="login-brand" href="/" />
        <h1 className="login-title">{t('signupTitle')}</h1>
        <p className="signup-sub">{t('signupSub')}</p>
        {waking ? <p className="auth-notice" role="status">{t('waking')}</p> : null}

        {feature('facebookLogin') && !API_ENABLED && (
          <button type="button" className="social-btn" onClick={() => socialAccount('facebook', { name: 'Puja Rai', username: 'puja_fb', email: 'puja.rai@facebook.demo', dob: '1997-09-22', city: 'Dharan' })}>{IC.fb}<span>{t('facebook')}</span></button>
        )}
        {feature('appleLogin') && !API_ENABLED && (
          <button type="button" className="social-btn" onClick={() => socialAccount('apple', { name: 'Niraj Thapa', username: 'niraj_a', email: 'niraj@icloud.demo', dob: '1995-01-30', city: 'Pokhara' })}>{IC.apple}<span>{t('apple')}</span></button>
        )}
        {showSocial && <div className="login-divider">{t('or')}</div>}

        {prefill ? <p className="auth-notice" role="status">{t('googleHandoff', { email: prefill.email })}</p> : null}

        <form onSubmit={submit} className="signup-form" noValidate>
          <label className="signup-field">
            <span>{t('fullName')} *</span>
            <input
              ref={el => { fields.current.name = el; }}
              className="login-input"
              type="text"
              value={name}
              maxLength={60}
              autoComplete="off"
              placeholder={t('fullName')}
              aria-invalid={!!fieldErrors.name}
              aria-describedby={fieldErrors.name ? 'signup-name-error' : undefined}
              onChange={e => { setName(e.target.value); clearFieldError('name'); }}
            />
            {fieldErrors.name ? <span className="signup-field-error" id="signup-name-error" role="alert">{fieldErrors.name}</span> : null}
          </label>
          <label className="signup-field">
            <span>{t('username')} *</span>
            <input
              ref={el => { fields.current.username = el; }}
              className="login-input"
              type="text"
              value={username}
              maxLength={20}
              autoComplete="off"
              placeholder="sita_k"
              aria-invalid={!!fieldErrors.username}
              aria-describedby={fieldErrors.username ? 'signup-username-error' : undefined}
              onChange={e => { setUsername(e.target.value.replace(/\s/g, '_')); clearFieldError('username'); }}
            />
            {fieldErrors.username ? <span className="signup-field-error" id="signup-username-error" role="alert">{fieldErrors.username}</span> : null}
          </label>
          <label className="signup-field">
            <span>{t('email')} *</span>
            <input
              ref={el => { fields.current.email = el; }}
              className="login-input"
              type="email"
              value={email}
              autoComplete="off"
              placeholder="you@example.com"
              readOnly={!!prefill}
              aria-invalid={!!fieldErrors.email}
              aria-describedby={fieldErrors.email ? 'signup-email-error' : undefined}
              onChange={e => { setEmail(e.target.value); clearFieldError('email'); }}
            />
            {fieldErrors.email ? <span className="signup-field-error" id="signup-email-error" role="alert">{fieldErrors.email}</span> : null}
          </label>
          {!prefill && (
            <label className="signup-field">
              <span>{t('password')} *</span>
              <input
                ref={el => { fields.current.password = el; }}
                className="login-input"
                type="password"
                value={password}
                autoComplete="new-password"
                placeholder="••••••••"
                aria-invalid={!!fieldErrors.password}
                aria-describedby={fieldErrors.password ? 'signup-password-error' : undefined}
                onChange={e => { setPassword(e.target.value); clearFieldError('password'); }}
              />
              {fieldErrors.password ? <span className="signup-field-error" id="signup-password-error" role="alert">{fieldErrors.password}</span> : null}
            </label>
          )}
          <div className="signup-row">
            <label className="signup-field">
              <span>{t('dob')} *</span>
              <input
                ref={el => { fields.current.dob = el; }}
                className="login-input"
                type="date"
                value={dob}
                max={new Date().toISOString().slice(0, 10)}
                aria-invalid={!!fieldErrors.dob}
                aria-describedby={fieldErrors.dob ? 'signup-dob-error' : undefined}
                onChange={e => { setDob(e.target.value); clearFieldError('dob'); }}
              />
              {fieldErrors.dob ? <span className="signup-field-error" id="signup-dob-error" role="alert">{fieldErrors.dob}</span> : null}
            </label>
            <label className="signup-field">
              <span>{t('country')} *</span>
              <select
                ref={el => { fields.current.country = el; }}
                className="login-input"
                value={country}
                aria-invalid={!!fieldErrors.country}
                aria-describedby={fieldErrors.country ? 'signup-country-error' : undefined}
                onChange={e => { setCountry(e.target.value); clearFieldError('country'); }}
              >
                {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {fieldErrors.country ? <span className="signup-field-error" id="signup-country-error" role="alert">{fieldErrors.country}</span> : null}
            </label>
          </div>
          <div className="signup-row">
            <label className="signup-field">
              <span>{t('province')} ({t('optional')})</span>
              <input
                ref={el => { fields.current.province = el; }}
                className="login-input"
                type="text"
                value={province}
                maxLength={40}
                autoComplete="off"
                aria-invalid={!!fieldErrors.province}
                aria-describedby={fieldErrors.province ? 'signup-province-error' : undefined}
                onChange={e => { setProvince(e.target.value); clearFieldError('province'); }}
              />
              {fieldErrors.province ? <span className="signup-field-error" id="signup-province-error" role="alert">{fieldErrors.province}</span> : null}
            </label>
            <label className="signup-field">
              <span>{t('city')} ({t('optional')})</span>
              <input
                ref={el => { fields.current.city = el; }}
                className="login-input"
                type="text"
                value={city}
                maxLength={40}
                autoComplete="off"
                aria-invalid={!!fieldErrors.city}
                aria-describedby={fieldErrors.city ? 'signup-city-error' : undefined}
                onChange={e => { setCity(e.target.value); clearFieldError('city'); }}
              />
              {fieldErrors.city ? <span className="signup-field-error" id="signup-city-error" role="alert">{fieldErrors.city}</span> : null}
            </label>
          </div>

          <div className="signup-check-wrap">
            <label className="signup-check">
              <input
                ref={el => { fields.current.age = el; }}
                type="checkbox"
                checked={ageOk}
                aria-invalid={!!fieldErrors.age}
                aria-describedby={fieldErrors.age ? 'signup-age-error' : undefined}
                onChange={e => { setAgeOk(e.target.checked); clearFieldError('age'); }}
              />
              <span>{t('ageConfirm')}</span>
            </label>
            {fieldErrors.age ? <span className="signup-field-error" id="signup-age-error" role="alert">{fieldErrors.age}</span> : null}
          </div>
          <div className="signup-check-wrap">
            <label className="signup-check">
              <input
                ref={el => { fields.current.legal = el; }}
                type="checkbox"
                checked={legalOk}
                aria-invalid={!!fieldErrors.legal}
                aria-describedby={fieldErrors.legal ? 'signup-legal-error' : undefined}
                onChange={e => { setLegalOk(e.target.checked); clearFieldError('legal'); }}
              />
              <span>
                {t('legalTick')}{' '}
                <span className="signup-legal-links">
                  (<Link href="/legal/terms" target="_blank" rel="noopener">{t('terms')}</Link> · <Link href="/legal/user-policy" target="_blank" rel="noopener">{t('userPolicy')}</Link> · <Link href="/legal/privacy" target="_blank" rel="noopener">{t('privacy')}</Link> · <Link href="/legal/cookies" target="_blank" rel="noopener">{t('cookies')}</Link>)
                </span>
              </span>
            </label>
            {fieldErrors.legal ? <span className="signup-field-error" id="signup-legal-error" role="alert">{fieldErrors.legal}</span> : null}
          </div>

          {error && <p className="signup-error" role="alert">{error}</p>}
          <button type="submit" className={`login-submit ${busy ? '' : 'active'}`} disabled={busy}>{busy ? t('checking') : t('signup')}</button>
        </form>

        <p className="login-footer">
          {t('haveAccount')} <Link href="/login">{t('signIn')}</Link>
        </p>
      </div>
    </div>
  );
}
