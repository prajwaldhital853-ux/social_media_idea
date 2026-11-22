'use client';

import { IC } from '@/lib/icons';

/**
 * The three pieces every list screen repeats, kept here so a screen is only
 * ever its columns. They are the shape the Client's screenshots showed: a row
 * of chips for the one filter that matters, a wide search with a scope beside
 * it, and a table that opens a row instead of burying it in a card.
 */

export interface Chip {
  id: string;
  label: string;
  /** The count the server says sits behind this chip, when it says. */
  n?: number | null;
}

export function Chips({
  chips, value, onPick, label,
}: { chips: Chip[]; value: string; onPick: (id: string) => void; label: string }) {
  return (
    <div className="filters" role="group" aria-label={label}>
      {chips.map(chip => (
        <button
          key={chip.id} type="button" data-chip={chip.id}
          className={`fchip${chip.id === value ? ' on' : ''}`}
          aria-pressed={chip.id === value}
          onClick={() => onPick(chip.id)}
        >
          {chip.label}
          {chip.n !== undefined && chip.n !== null && <b>&nbsp;{chip.n}</b>}
        </button>
      ))}
    </div>
  );
}

export function More({
  hasMore, busy, onMore, label,
}: { hasMore: boolean; busy: boolean; onMore: () => void; label: string }) {
  if (!hasMore) return null;
  return (
    <p className="load-more">
      <button type="button" className="btn wide" disabled={busy} onClick={onMore}>
        <span>{busy ? 'Loading…' : label}</span>{IC.go}
      </button>
    </p>
  );
}

/** One of the four icons at the end of a row. The word is in the title, not under the glyph. */
export function Act({
  icon, label, onClick, disabled, tone,
}: {
  icon: keyof typeof IC; label: string; onClick: () => void; disabled?: boolean; tone?: 'dead';
}) {
  return (
    <button
      type="button" className="iact" onClick={onClick} disabled={disabled}
      title={label} aria-label={label}
      style={tone === 'dead' ? { color: '#A3121A' } : undefined}
    >
      {IC[icon]}
    </button>
  );
}
