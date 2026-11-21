'use client';

import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/AppContext';

interface AuthCodeProps {
  title: string;
  detail: string;
  /** The address the code went to, shown in monospace so it can be checked at a glance. */
  hint?: string;
  /** Epoch ms when the challenge stops working. */
  expiresAt?: number;
  /** Only present when the server runs in DEBUG and cannot send real email. */
  devCode?: string;
  error?: string;
  busy?: boolean;
  submitLabel?: string;
  resendLabel?: string;
  backLabel?: string;
  onCode: (code: string) => void | Promise<void>;
  onResend?: () => void | Promise<void>;
  onBack?: () => void;
}

const clock = (ms: number) => {
  const left = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
};

export default function AuthCode({
  title, detail, hint, expiresAt, devCode, error, busy,
  submitLabel = 'Confirm', resendLabel = 'Resend code', backLabel = 'Back',
  onCode, onResend, onBack,
}: AuthCodeProps) {
  const { t } = useApp();
  const [code, setCode] = useState('');
  const [left, setLeft] = useState(expiresAt ? expiresAt - Date.now() : 0);
  const [cooldown, setCooldown] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    if (!expiresAt) return;
    setLeft(expiresAt - Date.now());
    const timer = setInterval(() => setLeft(Math.max(0, expiresAt - Date.now())), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  useEffect(() => {
    if (left <= 0) return;
    const timer = setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [left]);

  const submit = (value: string) => {
    if (value.length !== 6 || busy) return;
    void onCode(value);
  };

  return (
    <div className="auth-code" role="group" aria-label={title}>
      <b className="auth-code-title">{title}</b>
      <p className="auth-code-detail">{detail}</p>
      {hint ? <p className="auth-code-hint">{hint}</p> : null}

      <input
        ref={input}
        className="login-input auth-code-input"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="000000"
        aria-label="6-digit code"
        value={code}
        disabled={busy}
        onChange={e => {
          const next = e.target.value.replace(/\D/g, '').slice(0, 6);
          setCode(next);
          submit(next);
        }}
        onKeyDown={e => { if (e.key === 'Enter') submit(code); }}
      />

      {devCode ? (
        <button type="button" className="auth-code-dev" onClick={() => { setCode(devCode); void onCode(devCode); }}>
          {t('devCode')} <b>{devCode}</b>
        </button>
      ) : null}

      {left > 0 ? <p className="auth-code-meta">{t('codeExpiresIn')} {clock(left)}</p> : <p className="auth-code-meta">{t('codeExpired')}</p>}
      {error ? <p className="signup-error" role="alert">{error}</p> : null}

      <button type="button" className={`login-submit ${code.length === 6 && !busy ? 'active' : ''}`} disabled={code.length !== 6 || busy} onClick={() => submit(code)}>
        {busy ? t('checking') : submitLabel}
      </button>

      <div className="auth-code-actions">
        {onResend ? (
          <button type="button" className="auth-code-link" disabled={cooldown > 0 || busy} onClick={() => {
            void onResend();
            setCooldown(30);
            setCode('');
          }}>
            {cooldown > 0 ? `${resendLabel} in ${cooldown}s` : resendLabel}
          </button>
        ) : null}
        {onBack ? <button type="button" className="auth-code-link" onClick={onBack}>{backLabel}</button> : null}
      </div>
    </div>
  );
}
