'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { IC } from '@/lib/icons';
import { ContentKind, PersonPage, ShelfPage } from '@/lib/types';

/**
 * Nobody is handed the number at the end of an address bar, so a desk that needs
 * a target asks for a word instead, a name, an email, a phrase out of the post ,
 * and lists the things that carry it. Picking one of those is the whole point:
 * the seat chooses what it meant rather than guessing at an id.
 *
 * The box answers every keystroke, so three requests for one word can land in
 * any order and each call takes a number; only the newest may paint the list.
 */

export interface Hit {
  key: string;
  /** What the seat reads first. */
  label: string;
  /** Who it belongs to, and the target it stands for. */
  who: string;
  target: string;
  href: string;
  /** What a search box should be filled with to get down to this one thing. */
  fill: string;
}

const LEAST = 2;
const WAIT = 250;
const SHOWN = 6;
const THING: Record<string, string> = { post: 'post', comment: 'comment', listing: 'listing' };

function useFound(ask: (word: string) => Promise<Hit[]>, word: string) {
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [locked, setLocked] = useState<string | null>(null);
  // The screen rebuilds this question on every render; the timer has to ask the
  // newest one without restarting the wait each time the parent repaints.
  const latest = useRef(ask);
  const seq = useRef(0);

  useEffect(() => {
    latest.current = ask;
  });

  useEffect(() => {
    const text = (word || '').trim();
    if (text.length < LEAST) {
      setHits(null);
      setLocked(null);
      return;
    }
    seq.current += 1;
    const mine = seq.current;
    const timer = setTimeout(() => {
      latest.current(text).then(back => {
        if (seq.current !== mine) return;
        setLocked(null);
        setHits(back);
      }, (err: ApiError) => {
        if (seq.current !== mine) return;
        setHits(null);
        setLocked(err.data?.label
          ? `This desk cannot search for it: ${err.data.label} is not on your seat.`
          : null);
      });
    }, WAIT);
    return () => clearTimeout(timer);
  }, [word]);

  return { hits, locked };
}

function Picks({ hits, locked, empty, onPick }: {
  hits: Hit[] | null;
  locked: string | null;
  empty: string;
  onPick: (hit: Hit) => void;
}) {
  if (locked) {
    return (
      <p className="note row" data-picks="locked">
        {IC.alert}<span>{locked}</span>
      </p>
    );
  }
  if (hits === null) return null;
  if (hits.length === 0) {
    return (
      <p className="note row" data-picks="empty">
        {IC.search}<span>{empty}</span>
      </p>
    );
  }
  return (
    <ul className="picks" data-picks>
      {hits.map(hit => (
        <li key={hit.key}>
          <button type="button" className="pick-main" data-pick={hit.target} onClick={() => onPick(hit)}>
            <span className="pick-label">{hit.label}</span>
            <span className="pick-who">{hit.who} · {hit.target}</span>
          </button>
          <Link href={hit.href} className="pick-go" title="Open this instead">{IC.go}</Link>
        </li>
      ))}
    </ul>
  );
}

/** Accounts whose username, email or name carries this word. */
export function PeoplePicks({ query, onPick }: {
  query: string;
  onPick: (hit: Hit) => void;
}) {
  const { hits, locked } = useFound(async (text) => {
    const page = await api<PersonPage>(`admin/people/?q=${encodeURIComponent(text)}`);
    return page.results.slice(0, SHOWN).map(row => ({
      key: `user:${row.id}`,
      label: row.name || row.username,
      who: `@${row.username}${row.email ? ` · ${row.email}` : ''}`,
      target: `user:${row.id}`,
      href: `/people/${row.username}`,
      fill: row.username,
    }));
  }, query);
  return <Picks hits={hits} locked={locked} empty="No account carries that name, username or email." onPick={onPick}/>;
}

/** The thing itself, found by its own words or by whoever wrote it. */
export function ContentPicks({ kind, query, onPick }: {
  kind: Exclude<ContentKind, 'user'>;
  query: string;
  onPick: (hit: Hit) => void;
}) {
  const { hits, locked } = useFound(async (text) => {
    const page = await api<ShelfPage>(
      `admin/content/?type=${kind}&state=all&q=${encodeURIComponent(text)}`,
    );
    return page.results.slice(0, SHOWN).map(row => ({
      key: row.target,
      label: row.content.title || row.content.text || '(it has no words of its own)',
      who: row.content.author ? `@${row.content.author.username}` : 'nobody is credited',
      target: row.target,
      href: `/review/${kind}/${row.content.id}`,
      fill: row.target,
    }));
  }, query);
  return <Picks hits={hits} locked={locked} empty={`Nothing ${THING[kind]} carries those words.`} onPick={onPick}/>;
}
