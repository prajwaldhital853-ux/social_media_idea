/** Minutes, hours, days — the way a duty roster reads them, not ISO spans. */
export function ago(value: string | number | null | undefined): string {
  if (!value) return 'never';
  const at = typeof value === 'number' ? value * 1000 : Date.parse(value);
  if (Number.isNaN(at)) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(at).toLocaleDateString();
}

export function stamp(value: string | number | null | undefined): string {
  if (!value) return '—';
  const at = typeof value === 'number' ? value * 1000 : Date.parse(value);
  if (Number.isNaN(at)) return '—';
  return new Date(at).toLocaleString();
}

/** A countdown for the 30-minute admin window, ticking down in the top bar. */
export function left(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return '—';
  const seconds = Math.round(unixSeconds - Date.now() / 1000);
  if (seconds <= 0) return 'expired';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return `${seconds}s left`;
  return `${minutes} min left`;
}

export function secondsLeft(unixSeconds: number | null | undefined): number {
  if (!unixSeconds) return 0;
  return Math.max(0, Math.round(unixSeconds - Date.now() / 1000));
}
