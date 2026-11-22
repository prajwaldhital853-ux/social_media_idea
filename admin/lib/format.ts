/** The three formats this console keeps repeating: counts, money, waiting. */

export function num(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString('en-US');
}

/** The site writes prices as `NPR 1,500`, so the console says the same thing. */
export function money(value: number | null | undefined): string {
  return `NPR ${num(Math.round(value ?? 0))}`;
}

export function bytes(size: number | null | undefined): string {
  const value = Math.max(0, size ?? 0);
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let scaled = value / 1024;
  let index = 0;
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index += 1;
  }
  return `${scaled.toFixed(scaled < 10 ? 2 : 0)} ${units[index]}`;
}

/** A queue age read the way a person on shift talks about it. */
export function waiting(minutes: number | null | undefined): string {
  const value = Math.max(0, Math.round(minutes ?? 0));
  if (value < 60) return `${value} min`;
  if (value < 1440) return `${Math.round(value / 60)} h`;
  return `${Math.round(value / 1440)} d`;
}

export function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value}%`;
}
