'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ReactNode } from 'react';
import { api, ApiError } from './api';
import { Session, SignInChallenge, SignedIn } from './types';

type Status = 'loading' | 'out' | 'in';

interface SessionValue {
  status: Status;
  session: Session | null;
  /** What step two of the sign-in has to ask for: a QR, or a code. */
  challenge: SignInChallenge | null;
  /** True when a screen hit the door mid-work: the 30-minute window ran out. */
  lapsed: boolean;
  /** Recovery codes handed out at first enrolment — shown once, then gone. */
  newCodes: string[] | null;
  error: string | null;
  busy: boolean;
  signIn: (identifier: string, password: string) => Promise<'enrol' | 'code' | 'rejected'>;
  verify: (code: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  resume: () => Promise<void>;
  forgetCodes: () => void;
  /** Hand a screen's error here: the door codes are the shell's business. */
  noteGate: (err: unknown) => boolean;
  clearLapsed: () => void;
  can: (key: string) => boolean;
  isSuperadmin: boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must run inside <SessionProvider>');
  return value;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [challenge, setChallenge] = useState<SignInChallenge | null>(null);
  const [lapsed, setLapsed] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await api<Session>('admin/session/');
      setSession(next);
      setStatus('in');
      setLapsed(false);
      setChallenge(null);
      setNewCodes(null);
    } catch (err) {
      // Anything else is simply "not at the desk right now": no session cookie,
      // a non-staff visitor, or an admin window that has since closed.
      setSession(null);
      setStatus('out');
      if (err instanceof ApiError && err.code === 'two_factor_required') setLapsed(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const signIn = useCallback(async (identifier: string, password: string) => {
    setBusy(true);
    setError(null);
    setNewCodes(null);
    try {
      const started = await api<SignInChallenge>('admin/session/login/', {
        method: 'POST',
        body: { username: identifier, password },
      });
      setChallenge(started);
      setLapsed(false);
      return started.code === 'two_factor_enrolment' ? 'enrol' : 'code';
    } catch (err) {
      const failure = err as ApiError;
      setError(failure.message);
      setChallenge(null);
      // A locked authenticator still knows who is knocking, so the code box can
      // count the minutes down instead of inviting more wrong guesses.
      if (failure.code === 'two_factor_locked') {
        setChallenge({ detail: failure.message, code: failure.code as SignInChallenge['code'], username: identifier, retry_in: Number(failure.data.retry_in || 0) });
      }
      return 'rejected';
    } finally {
      setBusy(false);
    }
  }, []);

  const verify = useCallback(async (code: string) => {
    setBusy(true);
    setError(null);
    try {
      const granted = await api<SignedIn>('admin/session/verify/', {
        method: 'POST',
        body: { code },
      });
      setSession(granted);
      setStatus('in');
      setChallenge(null);
      setLapsed(false);
      // First enrolment is the only time the plaintext codes exist anywhere; the
      // server keeps hashes, so if this screen is closed they cannot be shown again.
      setNewCodes(granted.recovery_codes && granted.recovery_codes.length ? granted.recovery_codes : null);
      return true;
    } catch (err) {
      const failure = err as ApiError;
      setError(failure.message);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await api('admin/session/logout/', { method: 'POST', body: {} }).catch(() => undefined);
    setSession(null);
    setStatus('out');
    setChallenge(null);
    setLapsed(false);
    setNewCodes(null);
  }, []);

  const noteGate = useCallback((err: unknown) => {
    if (!(err instanceof ApiError)) return false;
    if (err.code === 'two_factor_required') {
      setLapsed(true);
      return true;
    }
    if (err.code === 'staff_disabled') {
      // Access ended while this tab was open. Say so, then hand back the door.
      setSession(null);
      setStatus('out');
      setError(err.message);
      return true;
    }
    return false;
  }, []);

  const value = useMemo<SessionValue>(() => ({
    status,
    session,
    challenge,
    lapsed,
    newCodes,
    error,
    busy,
    signIn,
    verify,
    signOut,
    resume: load,
    noteGate,
    forgetCodes: () => setNewCodes(null),
    clearLapsed: () => setLapsed(false),
    can: (key: string) => !!session && (session.role === 'superadmin' || session.permissions.includes(key)),
    isSuperadmin: session?.role === 'superadmin',
  }), [status, session, challenge, lapsed, newCodes, error, busy, signIn, verify, signOut, load, noteGate]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
