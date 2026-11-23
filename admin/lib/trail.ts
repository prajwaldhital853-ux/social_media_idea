'use client';

/**
 * The last few screens this tab opened, oldest first.
 *
 * Every console screen renders its own shell, so switching screens rebuilds the
 * page from nothing and the seat's place in the site exists only in the browser's
 * history. `history.back()` is the obvious answer and the wrong one: a tab opened
 * on a deep link walks out of the console altogether, and it cannot say what the
 * page it leaves was called. This trail is what the Back control reads, and the
 * screen it was written from is what the control can then name out loud.
 */
export interface Stop {
  href: string;
  label: string;
}

let stops: Stop[] = [];

/** Called by the shell on arrival. Re-arrival at the same screen is not a step. */
export function visit(stop: Stop) {
  const last = stops[stops.length - 1];
  if (last && last.href === stop.href) return;
  // A visit back to a screen already in the trail lifts it to the end rather than
  // stamping a second copy, so "back" is never a page the seat is standing on.
  stops = [...stops.filter(item => item.href !== stop.href), stop].slice(-24);
}

/** Where the seat came from, or nothing when this tab opened right here. */
export function cameFrom(): Stop | null {
  return stops.length > 1 ? stops[stops.length - 2] : null;
}
