'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AuthCode from '@/components/AuthCode';
import BrandLogo from '@/components/BrandLogo';
import { useApp } from '@/lib/AppContext';
import { API_ENABLED } from '@/lib/api';
import { requestGoogleToken } from '@/lib/google';
import { COUNTRIES, THEME_KEY, ageFromDob, uid } from '@/lib/utils';
import { IC } from '@/lib/icons';
import { SignupProvider, User } from '@/lib/types';

const GOOGLE_KEY = 'exposing-google';
type Prefill = { email: string; name: string; google_sub: string };

export default function SignupPage() {
  const { db, t, feature, ready, login, setDb, showToast, signupAccount, verifyCode, resendCode, googleSignIn } = useApp();
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
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [code, setCode] = useState<{ challenge: string; expiresAt?: number; devCode?: string } | null>(null);

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

  const localAccount = (data: { name: string; username: string; email: string; dob: string; country: string; province?: string; city?: string; provider: SignupProvider }) => {
    const existing = db.users.find(u => u.username.toLowerCase() === data.username.toLowerCase() || u.email.toLowerCase() === data.email.toLowerCase());
    if (existing) {
      login(existing.id);
      showToast(t('welcome', { name: existing.name || existing.username }));
      router.push('/');
      return;
    }
    const user: User = {
      id: uid(), email: data.email.toLowerCase(), username: data.username, name: data.name,
      role: 'user', verified: false, emailVerified: data.provider !== 'email', susp: null,
      provider: data.provider, dob: data.dob, country: data.country,
      province: data.province || '', city: data.city || '', bio: '',
      twoStep: false, joined: Date.now(), coins: 0, warning: null
    };
    setDb(prev => ({ ...prev, users: [...prev.users, user], meId: user.id }));
    showToast(t('welcome', { name: user.name }));
    router.push('/');
  };

  const validate = (): string => {
    if (!name.trim()) return t('fullName');
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return t('e_user');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return t('e_email');
    if (!prefill && password.length < 8) return t('e_pass');
    if (!dob || ageFromDob(dob) < 13) return t('e_dob13');
    if (!ageOk) return t('e_age');
    if (!legalOk) return t('e_legal');
    return '';
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const local = validate();
    if (local) return setError(local);
    setError('');

    if (!API_ENABLED) {
      return localAccount({
        name: name.trim(), username, email, dob, country, province, city,
        provider: prefill ? 'google' : 'email'
      });
    }

    setBusy(true);
    const res = await signupAccount({
      username, email, password, name: name.trim(), dob, country, province, city,
      google: prefill ? { sub: prefill.google_sub, email: prefill.email, name: prefill.name } : undefined,
    });
    setBusy(false);

    if (!res.ok) {
      const first = res.errors && Object.values(res.errors)[0]?.[0];
      return setError(first || res.detail || t('e_email'));
    }
    if (res.user && res.challenge) {
      setCode({
        challenge: res.challenge,
        expiresAt: res.expiresIn ? Date.now() + res.expiresIn * 1000 : undefined,
        devCode: res.devCode,
      });
      return;
    }
    showToast(t('welcome', { name: res.user?.name || name.trim() }));
    router.push('/');
  };

  const confirmCode = async (value: string) => {
    if (!code) return;
    setBusy(true);
    const res = await verifyCode(code.challenge, value, 'verify');
    setBusy(false);
    if (res.ok && res.user) {
      showToast(t('welcome', { name: res.user.name || res.user.username }));
      router.push('/');
      return;
    }
    if (res.ok && res.challenge) {
      setCode({ challenge: res.challenge, expiresAt: res.expiresIn ? Date.now() + res.expiresIn * 1000 : code.expiresAt, devCode: res.devCode });
      return;
    }
    setError(res.attemptsLeft !== undefined && res.attemptsLeft > 0
      ? `${res.detail} ${t(res.attemptsLeft === 1 ? 'codeTryOne' : 'codeTriesLeft', { n: res.attemptsLeft })}`
      : res.detail || t('wrongCode'));
  };

  const resend = async () => {
    if (!code) return;
    const res = await resendCode(code.challenge);
    if (res.error) return setError(res.error);
    setCode({ challenge: res.challenge || code.challenge, expiresAt: res.expiresIn ? Date.now() + res.expiresIn * 1000 : undefined, devCode: res.devCode });
    setError('');
  };

  const startGoogle = async () => {
    setError('');
    setBusy(true);
    try {
      if (db.settings.googleClientId) {
        const res = await googleSignIn({ id_token: await requestGoogleToken(db.settings.googleClientId) });
        if (res.needsSignup && res.prefill) {
          setPrefill(res.prefill);
          setEmail(res.prefill.email);
          setName(res.prefill.name);
        } else if (res.ok && res.user) {
          showToast(t('welcome', { name: res.user.name || res.user.username }));
          router.push('/');
        }
      } else if (feature('googleDemo') && db.settings.demoGoogle) {
        setPrefill({ ...db.settings.demoGoogle, google_sub: db.settings.demoGoogle.sub } as Prefill);
        setEmail(db.settings.demoGoogle.email);
        setName(db.settings.demoGoogle.name);
        setPassword('');
      } else if (!API_ENABLED) {
        const demo = { name: 'Aarav Sharma', username: 'aarav_g', email: 'aarav.sharma@gmail.com', dob: '1998-05-14', city: 'Kathmandu' };
        localAccount({ ...demo, country: 'Nepal', province: 'Bagmati', provider: 'google' });
      } else {
        setError(t('googleUnavailable'));
      }
    } catch {
      setError(t('googleUnavailable'));
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
          <AuthCode
            title={t('codeTitle')}
            detail={t('codeVerifyDetail', { email })}
            hint={t('codeSentTo', { email })}
            expiresAt={code.expiresAt}
            devCode={code.devCode}
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

  const showGoogle = API_ENABLED
    ? ready && (!!db.settings.googleClientId || feature('googleLogin') || feature('googleDemo'))
    : true;

  return (
    <div className="login-container signup-container">
      <div className="login-content signup-content">
        <BrandLogo height={56} className="login-brand" href="/" />
        <h1 className="login-title">{t('signupTitle')}</h1>
        <p className="signup-sub">{t('signupSub')}</p>

        {showGoogle && (
          <button type="button" className="social-btn" onClick={startGoogle} disabled={busy}>
            {IC.g}<span>{db.settings.googleClientId ? t('google') : feature('googleDemo') ? t('demoGoogle') : t('google')}</span>
          </button>
        )}
        {feature('facebookLogin') && !API_ENABLED && (
          <button type="button" className="social-btn" onClick={() => socialAccount('facebook', { name: 'Puja Rai', username: 'puja_fb', email: 'puja.rai@facebook.demo', dob: '1997-09-22', city: 'Dharan' })}>{IC.fb}<span>{t('facebook')}</span></button>
        )}
        {feature('appleLogin') && !API_ENABLED && (
          <button type="button" className="social-btn" onClick={() => socialAccount('apple', { name: 'Niraj Thapa', username: 'niraj_a', email: 'niraj@icloud.demo', dob: '1995-01-30', city: 'Pokhara' })}>{IC.apple}<span>{t('apple')}</span></button>
        )}
        {(showGoogle || feature('facebookLogin') || feature('appleLogin')) && <div className="login-divider">{t('or')}</div>}

        {prefill ? <p className="auth-notice" role="status">{t('googleHandoff', { email: prefill.email })}</p> : null}

        <form onSubmit={submit} className="signup-form" noValidate>
          <label className="signup-field">
            <span>{t('fullName')} *</span>
            <input className="login-input" type="text" value={name} maxLength={60} autoComplete="off" placeholder={t('fullName')} onChange={e => setName(e.target.value)} />
          </label>
          <label className="signup-field">
            <span>{t('username')} *</span>
            <input className="login-input" type="text" value={username} maxLength={20} autoComplete="off" placeholder="sita_k" onChange={e => setUsername(e.target.value.replace(/\s/g, '_'))} />
          </label>
          <label className="signup-field">
            <span>{t('email')} *</span>
            <input className="login-input" type="email" value={email} autoComplete="off" placeholder="you@example.com" readOnly={!!prefill} onChange={e => setEmail(e.target.value)} />
          </label>
          {!prefill && (
            <label className="signup-field">
              <span>{t('password')} *</span>
              <input className="login-input" type="password" value={password} autoComplete="new-password" placeholder="••••••••" onChange={e => setPassword(e.target.value)} />
            </label>
          )}
          <div className="signup-row">
            <label className="signup-field">
              <span>{t('dob')} *</span>
              <input className="login-input" type="date" value={dob} max={new Date().toISOString().slice(0, 10)} onChange={e => setDob(e.target.value)} />
            </label>
            <label className="signup-field">
              <span>{t('country')} *</span>
              <select className="login-input" value={country} onChange={e => setCountry(e.target.value)}>
                {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <div className="signup-row">
            <label className="signup-field">
              <span>{t('province')} ({t('optional')})</span>
              <input className="login-input" type="text" value={province} maxLength={40} autoComplete="off" onChange={e => setProvince(e.target.value)} />
            </label>
            <label className="signup-field">
              <span>{t('city')} ({t('optional')})</span>
              <input className="login-input" type="text" value={city} maxLength={40} autoComplete="off" onChange={e => setCity(e.target.value)} />
            </label>
          </div>

          <label className="signup-check">
            <input type="checkbox" checked={ageOk} onChange={e => setAgeOk(e.target.checked)} />
            <span>{t('ageConfirm')}</span>
          </label>
          <label className="signup-check">
            <input type="checkbox" checked={legalOk} onChange={e => setLegalOk(e.target.checked)} />
            <span>
              {t('legalTick')}{' '}
              <span className="signup-legal-links">
                (<Link href="/legal/terms" target="_blank" rel="noopener">{t('terms')}</Link> · <Link href="/legal/user-policy" target="_blank" rel="noopener">{t('userPolicy')}</Link> · <Link href="/legal/privacy" target="_blank" rel="noopener">{t('privacy')}</Link> · <Link href="/legal/cookies" target="_blank" rel="noopener">{t('cookies')}</Link>)
              </span>
            </span>
          </label>

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
