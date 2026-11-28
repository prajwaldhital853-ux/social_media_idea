/**
 * The in-app trail a back button can trust. window.history.length lies: it
 * counts provider redirects and off-site entries, so history.back() can sit
 * still or leave the site entirely — the "frozen back button" report. Every
 * detail page instead returns to the route this seat actually came from, or
 * falls back to a sensible home when the trail is empty (a link opened cold).
 *
 * The trail is a stack, not a log. Backing out of a page leaves it behind, so
 * a reader walking feed → post → photo → back → back reaches the feed instead
 * of being handed the photo again — the pair used to bounce between the last
 * two pages forever, which is what "can't go back" on an iPhone was.
 *
 * It also lives in sessionStorage, because iPhone Safari quietly drops a tab's
 * script and reloads the address whenever it wants the memory back. A trail
 * that died with the script turned every arrow into "go home" even when the
 * reader had come from a profile, a search or a notification.
 */

const KEY = 'exposing-trail';
const MAX = 40;

function read(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const rows = JSON.parse(sessionStorage.getItem(KEY) || '[]');
    return Array.isArray(rows) ? rows.filter(row => typeof row === 'string') : [];
  } catch { return []; }
}

let trail: string[] = read();

function save(): void {
  if (typeof window === 'undefined') return;
  // A private tab that refuses to store still navigates; the trail just lives
  // in memory for as long as the page does.
  try { sessionStorage.setItem(KEY, JSON.stringify(trail)); } catch { /* carried in memory only */ }
}

export function noteRoute(path: string): void {
  if (!path || trail[trail.length - 1] === path) return;
  // The browser moved on its own — Safari's edge swipe, Android's back gesture,
  // a desk keyboard Backspace — and landed on the page already under the top.
  // Leave that top off rather than stacking a second copy of where the reader
  // now stands, which would make the next press hand them the page they left.
  if (trail.length >= 2 && trail[trail.length - 2] === path) { trail.pop(); save(); return; }
  trail.push(path);
  if (trail.length > MAX) trail.shift();
  save();
}

/** A router slice big enough for the one call the back buttons make. */
type PushRouter = { push: (url: string, options?: { scroll?: boolean }) => void };

export function goBack(router: PushRouter, fallback = '/'): void {
  const here = typeof window === 'undefined' ? '' : window.location.pathname;
  // A reload, or a back taken by hand that the trail never saw, can leave it
  // out of step with the address bar. Start again from the page the reader is
  // actually standing on rather than offering them some page they never came
  // from — that is how an arrow ends up pointing at the page it is on.
  if (trail[trail.length - 1] !== here) trail = here ? [here] : [];
  trail.pop();
  save();
  const target = trail[trail.length - 1] || fallback;
  router.push(target === here ? fallback : target);
}
