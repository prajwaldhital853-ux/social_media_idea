'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { IC } from '@/lib/icons';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

type Step = 'wait' | 'credentials' | 'password' | 'enrol' | 'code' | 'codes' | 'forgot' | 'recover';
type Recovery = {
  detail?: string;
  challenge?: number;
  expires_in?: number;
  resend_in?: number;
};

/**
 * Two doors, one screen: the password proves you know something, the
 * authenticator code proves you hold something. Nothing between them hands out a
 * session — the console's own cookie only ever appears after the code is proved.
 * A seat handed out a temporary password has to trade it for its own before the
 * code is even asked for.
 */
export default function LoginPage() {
  const router = useRouter();
  const {
    status, session, challenge, newCodes, error, busy,
    signIn, setPassword: choosePassword, verify, forgetCodes,
  } = useSession();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [fresh, setFresh] = useState('');
  const [repeat, setRepeat] = useState('');
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [restart, setRestart] = useState(false);
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  /** 'ask' = the address, 'code' = the letter it sent, 'off' = the sign-in itself. */
  const [recovering, setRecovering] = useState<'off' | 'ask' | 'code'>('off');
  const [sent, setSent] = useState<Recovery | null>(null);
  const [recoverBusy, setRecoverBusy] = useState(false);
  const [recoverError, setRecoverError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Both waits are server-set, so reloading the page cannot shorten them.
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);

  // Only while something is actually counting down — an idle sign-in screen has
  // nothing to re-render every second.
  useEffect(() => {
    if (lockUntil === null && resendAt === null && expiresAt === null) return;
    setNow(Date.now() / 1000);
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, [lockUntil, resendAt, expiresAt]);

  // An open session normally means "go to the console" — except right after a
  // first enrolment, when the recovery codes have to be written down first.
  useEffect(() => {
    if (status === 'in' && !newCodes) router.replace('/');
  }, [status, newCodes, router]);

  const enrolling = challenge?.code === 'two_factor_enrolment';
  const choosing = challenge?.code === 'password_change_required';
  const enrolment = enrolling ? challenge?.totp : undefined;

  useEffect(() => {
    const url = enrolment?.otpauth_url;
    if (!url) {
      setQr('');
      return;
    }
    let live = true;
    QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: 'M' })
      .then(value => { if (live) setQr(value); })
      .catch(() => { if (live) setQr(''); });
    return () => { live = false; };
  }, [enrolment?.otpauth_url]);

  useEffect(() => {
    const retryIn = Number(challenge?.retry_in || 0);
    setLockUntil(retryIn > 0 ? Date.now() / 1000 + retryIn : null);
  }, [challenge?.code, challenge?.retry_in]);

  // A seat that has lost its password is not in the middle of a sign-in, so the
  // recovery screens take the whole card and hand back the door when they are done.
  const step: Step = recovering === 'ask' ? 'forgot'
    : recovering === 'code' ? 'recover'
    : newCodes ? 'codes'
    : status === 'loading' ? 'wait'
    : restart || !challenge ? 'credentials'
    : choosing ? 'password'
    : enrolling ? 'enrol' : 'code';

  const submitCredentials = async (event: FormEvent) => {
    event.preventDefault();
    setRestart(false);
    setNote(null);
    const outcome = await signIn(identifier.trim(), password);
    if (outcome === 'code') setCode('');
    if (outcome === 'password') {
      // The temporary password is a one-time read: do not keep it in the page
      // while the seat types its own.
      setPassword('');
      setFresh('');
      setRepeat('');
    }
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    await choosePassword(fresh, repeat);
  };

  const submitCode = async (event: FormEvent) => {
    event.preventDefault();
    // No navigation here on purpose: a first enrolment has to stop at the
    // recovery codes, and the effect above moves on once they are put away.
    await verify(code.trim());
  };

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // No permission (plain http, background tab): the text is on screen anyway.
      setCopied(null);
    }
  };

  /** Move the two server-set waits onto the same clock the page ticks against. */
  const arm = (resendIn?: number, expiresIn?: number) => {
    const at = Date.now() / 1000;
    setResendAt(Number(resendIn || 0) > 0 ? at + Number(resendIn) : null);
    setExpiresAt(Number(expiresIn || 0) > 0 ? at + Number(expiresIn) : null);
  };

  const leaveRecovery = () => {
    setRecovering('off');
    setRecoverError(null);
    setSent(null);
    arm(undefined, undefined);
  };

  const askCode = async (event: FormEvent) => {
    event.preventDefault();
    setRecoverBusy(true);
    setRecoverError(null);
    try {
      const out = await api<Recovery>('admin/session/forgot/', {
        method: 'POST',
        body: { email: identifier.trim() },
      });
      setSent(out);
      setCode('');
      setFresh('');
      setRepeat('');
      arm(out.resend_in, out.expires_in);
      setRecovering('code');
    } catch (err) {
      setRecoverError((err as ApiError).message);
    } finally {
      setRecoverBusy(false);
    }
  };

  const resendCode = async () => {
    setRecoverBusy(true);
    setRecoverError(null);
    try {
      const out = await api<Recovery>('admin/session/forgot/resend/', {
        method: 'POST',
        body: { challenge: sent?.challenge },
      });
      setSent(out);
      arm(out.resend_in, out.expires_in);
    } catch (err) {
      // The cooldown arrives as a 429 carrying the seconds left, so the button
      // keeps counting down rather than inviting another press.
      const wait = Number((err as ApiError).data?.resend_in || 0);
      if (wait > 0) arm(wait, undefined);
      setRecoverError((err as ApiError).message);
    } finally {
      setRecoverBusy(false);
    }
  };

  const spendCode = async (event: FormEvent) => {
    event.preventDefault();
    setRecoverBusy(true);
    setRecoverError(null);
    try {
      const out = await api<{ detail?: string; sessions_revoked?: number }>('admin/session/recovery/', {
        method: 'POST',
        body: {
          challenge: sent?.challenge, email: identifier.trim(),
          code: code.trim(), password: fresh, confirm: repeat,
        },
      });
      const kicked = Number(out.sessions_revoked || 0);
      setNote(`${out.detail || 'Your password is changed.'}`
        + (kicked > 0 ? ` ${kicked} signed-in session${kicked === 1 ? '' : 's'} closed.` : ''));
      setPassword('');
      setCode('');
      setFresh('');
      setRepeat('');
      leaveRecovery();
      setRestart(true);
    } catch (err) {
      setRecoverError((err as ApiError).message);
    } finally {
      setRecoverBusy(false);
    }
  };

  const locked = lockUntil !== null && lockUntil > now;
  const waiting = resendAt !== null && resendAt > now;
  const gone = expiresAt !== null && expiresAt <= now;

  return (
    <main className="login">
      <section className="login-brand">
        <h1 className="login-lockup">
          <img className="login-logo" src="/exposing-logo-dark.png" alt="Exposing" width={430} height={180} />
          <span className="login-kicker">Admin console</span>
        </h1>
        <div className="login-brand-foot">
          <p>Lost your phone or your codes? A Superadmin can reset your seat.</p>
        </div>
      </section>

      <section className="login-side">
        {step === 'wait' && (
          <div className="login-card">
            <div className="skeleton-stack">
              <div className="skeleton skeleton-title" />
              <div className="skeleton" />
              <div className="skeleton skeleton-short" />
            </div>
          </div>
        )}

        {step === 'credentials' && (
          <form className="login-card" onSubmit={submitCredentials}>
            <header className="step-head">
              <h2>Staff sign-in</h2>
              <p>Use the email address on the account the Client gave you. An ordinary platform login, and a username, will not open this door.</p>
            </header>
            <label className="field">
              <span>Email on your seat</span>
              <input
                type="email" value={identifier} onChange={event => setIdentifier(event.target.value)}
                autoComplete="email" autoFocus required
                placeholder="you@company.com"
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password" value={password} onChange={event => setPassword(event.target.value)}
                autoComplete="current-password" required placeholder="••••••••"
              />
            </label>
            {error && <p className="card-error">{IC.alert}<span>{error}</span></p>}
            {note && <p className="card-ok">{IC.check}<span>{note}</span></p>}
            <button className="btn primary wide" type="submit" disabled={busy || !identifier || !password}>
              {busy ? 'Checking…' : 'Continue'}
            </button>
            <div className="back-row">
              <button
                type="button" className="link"
                onClick={() => { setNote(null); setRecoverError(null); setRecovering('ask'); }}
              >
                Forgot my password
              </button>
            </div>
            <p className="fineprint">
              Eight tries per minute, then the attempt pauses. Wrong passwords never say whether
              the address holds a seat.
            </p>
          </form>
        )}

        {step === 'password' && (
          <form className="login-card" onSubmit={submitPassword}>
            <header className="step-head">
              <h2>Choose your own password</h2>
              <p>
                {challenge?.username
                  ? <>You signed in as <b>{challenge.username}</b> with the temporary password a Superadmin gave you. That one stops working now — this seat needs a password only you know.</>
                  : <>That was the temporary password a Superadmin gave you. It stops working now — this seat needs a password only you know.</>}
              </p>
            </header>
            <label className="field">
              <span>New password</span>
              <input
                type="password" value={fresh} onChange={event => setFresh(event.target.value)}
                autoComplete="new-password" autoFocus required
                placeholder="At least 10 characters"
              />
            </label>
            <label className="field">
              <span>Type it again</span>
              <input
                type="password" value={repeat} onChange={event => setRepeat(event.target.value)}
                autoComplete="new-password" required
                placeholder="••••••••"
              />
            </label>
            {error && <p className="card-error">{IC.alert}<span>{error}</span></p>}
            <button
              className="btn primary wide" type="submit"
              disabled={busy || fresh.length < 10 || repeat !== fresh}
            >
              {busy ? 'Saving…' : 'Set my password'}
            </button>
            <p className="fineprint">
              At least ten characters with a letter and a number in it. It cannot be the temporary
              one, your own name, your username, a common password, or any password this seat has
              already stood on. The next step is the authenticator code — nothing is signed in until
              that is proved.
            </p>
          </form>
        )}

        {step === 'enrol' && enrolment && (
          <form className="login-card" onSubmit={submitCode}>
            <header className="step-head">
              <h2>Set up your authenticator</h2>
              <p>
                Scan this with Google Authenticator, 1Password or Authy. The code it produces is
                what proves the phone is in your hand — {enrolment.digits} digits, changing every{' '}
                {enrolment.period} seconds.
              </p>
            </header>

            <div className="qr-row">
              {qr
                ? <img className="qr" src={qr} alt={`QR code for ${enrolment.account}`} width={240} height={240}/>
                : <div className="qr qr-empty">{IC.qr}<span>QR unavailable offline</span></div>}
              <div className="qr-manual">
                <span>Or type this key in by hand</span>
                <code>{enrolment.secret}</code>
                <button type="button" className="btn ghost tiny" onClick={() => copy('secret', enrolment.secret)}>
                  {IC.copy}<span>{copied === 'secret' ? 'Copied' : 'Copy key'}</span>
                </button>
                <dl>
                  <div><dt>Issuer</dt><dd>{enrolment.issuer}</dd></div>
                  <div><dt>Account</dt><dd>{enrolment.account}</dd></div>
                  <div><dt>Type</dt><dd>Time-based (TOTP)</dd></div>
                </dl>
              </div>
            </div>

            <label className="field">
              <span>Code from the app</span>
              <input
                inputMode="numeric" autoComplete="one-time-code" autoFocus
                value={code} onChange={event => setCode(event.target.value)}
                placeholder="123456"
              />
            </label>
            {error && <p className="card-error">{IC.alert}<span>{error}</span></p>}
            <button className="btn primary wide" type="submit" disabled={busy || code.trim().length < 6}>
              {busy ? 'Checking…' : 'Finish setup'}
            </button>
            <p className="fineprint">
              Ten one-time recovery codes appear next. They are the only way back in if the phone
              is gone, and nothing will ever show them to you again.
            </p>
          </form>
        )}

        {step === 'code' && (
          <form className="login-card" onSubmit={submitCode}>
            <header className="step-head">
              <h2>Authenticator code</h2>
              <p>
                {challenge?.username
                  ? <>Enter the code for <b>{challenge.username}</b>.</>
                  : <>Enter your code.</>}
                {typeof challenge?.recovery_left === 'number' && challenge.recovery_left > 0
                  && <> {challenge.recovery_left} recovery code{challenge.recovery_left === 1 ? '' : 's'} left.</>}
              </p>
            </header>
            <label className="field">
              <span>{useRecovery ? 'Recovery code' : 'Six-digit code'}</span>
              <input
                inputMode={useRecovery ? 'text' : 'numeric'} autoComplete="one-time-code" autoFocus
                value={code} onChange={event => setCode(event.target.value)}
                placeholder={useRecovery ? 'XXXX-XXXX-XXXX' : '123456'}
              />
            </label>
            {locked && (
              <p className="card-warn">
                {IC.alert}
                <span>Codes are paused after five wrong reads. Usable again in {countdown(lockUntil! - now)}.</span>
              </p>
            )}
            {error && <p className="card-error">{IC.alert}<span>{error}</span></p>}
            <button className="btn primary wide" type="submit" disabled={busy || code.trim().length < 6}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <div className="back-row">
              <button type="button" className="link" onClick={() => setUseRecovery(!useRecovery)}>
                {useRecovery ? 'Use the app code' : 'Lost my phone — use a recovery code'}
              </button>
              <button type="button" className="link" onClick={() => { setRestart(true); setCode(''); }}>
                Different account
              </button>
            </div>
          </form>
        )}

        {step === 'forgot' && (
          <form className="login-card" onSubmit={askCode}>
            <header className="step-head">
              <h2>Forgot your password</h2>
              <p>
                A six-digit code goes to the email address on your seat. It opens this door only —
                your authenticator setup is not touched, so a stranger who reads your mail still
                cannot sign in.
              </p>
            </header>
            <label className="field">
              <span>Email on your seat</span>
              <input
                type="email" value={identifier} onChange={event => setIdentifier(event.target.value)}
                autoComplete="email" autoFocus required placeholder="you@company.com"
              />
            </label>
            {recoverError && <p className="card-error">{IC.alert}<span>{recoverError}</span></p>}
            <button className="btn primary wide" type="submit" disabled={recoverBusy || !identifier.trim()}>
              {recoverBusy ? 'Sending…' : 'Send me a code'}
            </button>
            <div className="back-row">
              <button type="button" className="link" onClick={leaveRecovery}>Back to sign-in</button>
              <span className="dim">Three codes an hour, five minutes each.</span>
            </div>
            <p className="fineprint">
              The answer is the same whether or not the address holds a seat. Check the spam folder
              before asking again, and a Superadmin can always rebuild the desk from the staff page.
            </p>
          </form>
        )}

        {step === 'recover' && (
          <form className="login-card" onSubmit={spendCode}>
            <header className="step-head">
              <h2>The code from your email</h2>
              <p>
                {sent?.detail || 'A code is on its way.'}
                {expiresAt !== null && !gone && <> It stops working in {countdown(expiresAt - now)}.</>}
                {gone && <> It has stopped working — ask for a new one.</>}
              </p>
            </header>
            <label className="field">
              <span>Six-digit code</span>
              <input
                inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6}
                value={code} onChange={event => setCode(event.target.value)}
                placeholder="123456"
              />
            </label>
            <label className="field">
              <span>New password</span>
              <input
                type="password" value={fresh} onChange={event => setFresh(event.target.value)}
                autoComplete="new-password" required placeholder="At least 10 characters"
              />
            </label>
            <label className="field">
              <span>Type it again</span>
              <input
                type="password" value={repeat} onChange={event => setRepeat(event.target.value)}
                autoComplete="new-password" required placeholder="••••••••"
              />
            </label>
            {recoverError && <p className="card-error">{IC.alert}<span>{recoverError}</span></p>}
            <button
              className="btn primary wide" type="submit"
              disabled={recoverBusy || gone || code.trim().length < 6 || fresh.length < 10 || repeat !== fresh}
            >
              {recoverBusy ? 'Saving…' : 'Set my password'}
            </button>
            <div className="back-row">
              <button
                type="button" className="link" disabled={recoverBusy || waiting} onClick={resendCode}
                title={waiting ? 'The wait is counted on the server' : 'Burn this code and mail a new one'}
              >
                {waiting ? `Send another in ${countdown(resendAt! - now)}` : 'Send another code'}
              </button>
              <button type="button" className="link" onClick={leaveRecovery}>Back to sign-in</button>
            </div>
            <p className="fineprint">
              Ten wrong codes burn the letter. The password cannot be one this seat has already
              stood on. Every device signed in to this account is closed when it is set, and the
              address is mailed about it.
            </p>
          </form>
        )}

        {step === 'codes' && newCodes && (
          <div className="login-card">
            <header className="step-head">
              <h2>Recovery codes</h2>
              <p>
                Save these somewhere outside the phone. Each one signs you in <b>once</b>, then it is
                gone. The console keeps only a scrambled copy, so a lost list cannot be read back.
              </p>
            </header>
            <div className="codes-grid">
              {newCodes.map(value => (
                <code key={value}>{value}</code>
              ))}
            </div>
            <div className="codes-actions">
              <button
                type="button" className="btn ghost"
                onClick={() => copy('codes', newCodes.join('\n'))}
              >
                {IC.copy}<span>{copied === 'codes' ? 'Copied all ten' : 'Copy all ten'}</span>
              </button>
              <button type="button" className="btn primary" onClick={() => forgetCodes()}>
                {IC.check}<span>I have saved them</span>
              </button>
            </div>
            <p className="fineprint">
              {session?.user.username} · {session?.role} — the seat is live now. Codes stay
              here until you close this screen.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

function countdown(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return minutes > 0 ? `${minutes}m ${rest.toString().padStart(2, '0')}s` : `${rest}s`;
}
