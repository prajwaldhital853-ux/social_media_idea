'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import BrandLogo from '@/components/BrandLogo';
import { useApp } from '@/lib/AppContext';
import { COUNTRIES, THEME_KEY, ageFromDob, uid } from '@/lib/utils';
import { IC } from '@/lib/icons';
import { SignupProvider, User } from '@/lib/types';

const SOCIAL_DEMOS: Record<'google' | 'facebook' | 'apple', { name: string; username: string; email: string; dob: string; city: string }> = {
  google: { name: 'Aarav Sharma', username: 'aarav_g', email: 'aarav.sharma@gmail.com', dob: '1998-05-14', city: 'Kathmandu' },
  facebook: { name: 'Puja Rai', username: 'puja_fb', email: 'puja.rai@facebook.demo', dob: '1997-09-22', city: 'Dharan' },
  apple: { name: 'Niraj Thapa', username: 'niraj_a', email: 'niraj@icloud.demo', dob: '1995-01-30', city: 'Pokhara' }
};

export default function SignupPage() {
  const { db, t, feature, login, setDb, showToast } = useApp();
  const router = useRouter();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [dob, setDob] = useState('');
  const [country, setCountry] = useState('Nepal');
  const [province, setProvince] = useState('');
  const [city, setCity] = useState('');
  const [ageOk, setAgeOk] = useState(false);
  const [legalOk, setLegalOk] = useState(false);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', 'dark');
    return () => {
      const saved = localStorage.getItem(THEME_KEY);
      root.setAttribute('data-theme', saved === 'dark' ? 'dark' : 'light');
    };
  }, []);

  const createAccount = (data: { name: string; username: string; email: string; dob: string; country: string; province?: string; city?: string; provider: SignupProvider }) => {
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

  const social = (provider: 'google' | 'facebook' | 'apple') => {
    const demo = SOCIAL_DEMOS[provider];
    createAccount({ ...demo, country: 'Nepal', province: 'Bagmati', provider });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError(t('fullName'));
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return setError(t('e_user'));
    if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) return setError(t('e_taken'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError(t('e_email'));
    if (db.users.some(u => u.email.toLowerCase() === email.toLowerCase())) return setError(t('e_hasacc'));
    if (password.length < 8) return setError(t('e_pass'));
    if (!dob || ageFromDob(dob) < 13) return setError(t('e_dob13'));
    if (!ageOk) return setError(t('e_age'));
    if (!legalOk) return setError(t('e_legal'));
    setError('');
    createAccount({ name: name.trim(), username, email, dob, country, province, city, provider: 'email' });
  };

  if (!mounted) return null;

  return (
    <div className="login-container signup-container">
      <div className="login-content signup-content">
        <BrandLogo height={56} className="login-brand" href="/" />
        <h1 className="login-title">{t('signupTitle')}</h1>
        <p className="signup-sub">{t('signupSub')}</p>

        {feature('googleLogin') && (
          <button type="button" className="social-btn" onClick={() => social('google')}>{IC.g}<span>{t('google')}</span></button>
        )}
        {feature('facebookLogin') && (
          <button type="button" className="social-btn" onClick={() => social('facebook')}>{IC.fb}<span>{t('facebook')}</span></button>
        )}
        {feature('appleLogin') && (
          <button type="button" className="social-btn" onClick={() => social('apple')}>{IC.apple}<span>{t('apple')}</span></button>
        )}
        {(feature('googleLogin') || feature('facebookLogin') || feature('appleLogin')) && <div className="login-divider">{t('or')}</div>}

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
            <input className="login-input" type="email" value={email} autoComplete="off" placeholder="you@example.com" onChange={e => setEmail(e.target.value)} />
          </label>
          <label className="signup-field">
            <span>{t('password')} *</span>
            <input className="login-input" type="password" value={password} autoComplete="new-password" placeholder="••••••••" onChange={e => setPassword(e.target.value)} />
          </label>
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
          <button type="submit" className="login-submit active">{t('signup')}</button>
        </form>

        <p className="login-footer">
          {t('haveAccount')} <Link href="/login">{t('signIn')}</Link>
        </p>
      </div>
    </div>
  );
}