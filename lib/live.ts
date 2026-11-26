/**
 * The live wire's client half: pulses the server pushed through the bell's
 * stream, offered to whichever mounted surface knows the named object.
 *
 * A surface that misses a pulse misses nothing permanent — every frame carries
 * absolute values and the next pull of that list tells the same truth — so the
 * bus is fire-and-forget on purpose: no queue, no replay, no subscriber can
 * hold the wire hostage. One bad listener is skipped, not fatal.
 */

export type LivePulse = { kind: string; [key: string]: unknown };

const listeners = new Set<(pulse: LivePulse) => void>();

export function onLive(fn: (pulse: LivePulse) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function emitLive(pulse: LivePulse): void {
  for (const fn of Array.from(listeners)) {
    try { fn(pulse); } catch { /* one deaf surface never silences the rest */ }
  }
}
