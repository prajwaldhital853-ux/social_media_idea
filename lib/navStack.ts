/**
 * The in-app trail a back button can trust. window.history.length lies: it
 * counts provider redirects and off-site entries, so history.back() can sit
 * still or leave the site entirely — the "frozen back button" report. Every
 * detail page instead returns to the route this seat actually came from, or
 * falls back to a sensible home when the trail is empty (a link opened cold).
 */

const trail: string[] = [];
let last = '';

export function noteRoute(path: string): void {
  if (!path || path === last) return;
  trail.push(path);
  if (trail.length > 40) trail.shift();
  last = path;
}

export function previousRoute(): string | null {
  return trail.length >= 2 ? trail[trail.length - 2] : null;
}

/** A router slice big enough for the one call the back buttons make. */
type PushRouter = { push: (url: string, options?: { scroll?: boolean }) => void };

export function goBack(router: PushRouter, fallback = '/'): void {
  router.push(previousRoute() || fallback);
}
