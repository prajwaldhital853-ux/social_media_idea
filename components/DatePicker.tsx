'use client';

import { useEffect, useRef, useState } from 'react';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const SHORT = MONTHS.map(name => name.slice(0, 3));
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const pad = (n: number, width = 2) => String(n).padStart(width, '0');
const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();

/** Today as the box reads it, in the browser's own day rather than UTC's. */
export const todayIso = () => {
  const now = new Date();
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** The yyyy-mm-dd string the rest of the app already stores, or empty when unfinished. */
const iso = (y: string, m: string, d: string) => `${y}-${m}-${d}`;

const parts = (value: string) => {
  const [y = '', m = '', d = ''] = (value || '').split('-');
  return { y, m, d };
};

type Segment = 'd' | 'm' | 'y';
type Pane = 'day' | 'month' | 'year';

// Measured so the sheet is placed where it fits before it is drawn: a birthday
// box sits low on a phone, and a sheet that runs off the bottom is unusable.
const SHEET_WIDTH = 322;
const SHEET_HEIGHT: Record<Pane, number> = { day: 356, month: 236, year: 336 };

type Props = {
  value: string;
  onChange: (next: string) => void;
  /** Highest pickable day, yyyy-mm-dd. A birthday form passes today. */
  max?: string;
  min?: string;
  /** The element an error message scrolls to and focuses. */
  register?: (el: HTMLElement | null) => void;
  className?: string;
  invalid?: boolean;
  describedBy?: string;
};

/**
 * A birthday box a person can actually drive. The browser's own date control on
 * iOS is a wheel that needs a tap on the small year heading before the digits
 * will move, which is the single place this form lost people: here the day, the
 * month and the year are three separate fields, each editable by tapping it,
 * and the calendar sheet lets any of the three be chosen by touching it.
 */
export default function DatePicker({ value, onChange, max, min, register, className = '', invalid, describedBy }: Props) {
  const seed = parts(value);
  const [d, setD] = useState(seed.d);
  const [m, setM] = useState(seed.m);
  const [y, setY] = useState(seed.y);
  const [typed, setTyped] = useState<Segment | ''>('');
  const [pane, setPane] = useState<'' | Pane>('');
  const [place, setPlace] = useState({ top: 0, left: 0, width: SHEET_WIDTH });
  const [view, setView] = useState(() => {
    const now = new Date();
    return { y: Number(seed.y) || now.getFullYear(), m: Number(seed.m) || now.getMonth() + 1 };
  });

  const box = useRef<HTMLDivElement | null>(null);
  const pop = useRef<HTMLDivElement | null>(null);
  const years = useRef<HTMLDivElement | null>(null);
  const seg = { d: useRef<HTMLInputElement | null>(null), m: useRef<HTMLInputElement | null>(null), y: useRef<HTMLInputElement | null>(null) };
  const written = useRef(value);
  const emit = useRef(onChange);
  emit.current = onChange;

  // The sheet is placed against the box it belongs to, flipped above it when the
  // bottom of the screen has no room, and narrowed to the screen when the phone is
  // smaller than the sheet.
  const anchor = (which: Pane) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(SHEET_WIDTH, window.innerWidth - 16);
    const height = SHEET_HEIGHT[which];
    const gap = 8;
    let top = rect.bottom + gap;
    if (top + height > window.innerHeight - gap) top = rect.top - height - gap;
    if (top < gap) top = Math.max(gap, window.innerHeight - height - gap);
    setPlace({ top, left: Math.min(window.innerWidth - width - gap, Math.max(gap, rect.left)), width });
  };

  useEffect(() => {
    if (value === written.current) return;
    const next = parts(value);
    setD(next.d); setM(next.m); setY(next.y);
    written.current = value;
  }, [value]);

  // Once three fields are full the date is either real or it is not; a day past
  // the end of a short month is pulled back rather than rolled into the next one.
  // Half a date is no date, so the form is handed an empty one the moment a field
  // is cleared — a stale birthday must not survive the keystroke that broke it.
  useEffect(() => {
    const complete = d.length === 2 && m.length === 2 && y.length === 4;
    if (!complete) {
      if (written.current === '') return;
      written.current = '';
      emit.current('');
      return;
    }
    const month = Number(m), day = Number(d), year = Number(y);
    if (month < 1 || month > 12) return;
    const lastDay = daysInMonth(year, month);
    if (day > lastDay) { setD(pad(lastDay)); return; }
    const next = iso(y, m, d);
    if (next === written.current) return;
    written.current = next;
    emit.current(next);
  }, [d, m, y]);

  useEffect(() => {
    if (!pane) return;
    const away = (event: PointerEvent) => {
      if (box.current?.contains(event.target as Node) || pop.current?.contains(event.target as Node)) return;
      setPane('');
    };
    const keys = (event: KeyboardEvent) => { if (event.key === 'Escape') setPane(''); };
    // A phone puts its keyboard away the moment a thumb lands on the sheet, which
    // moves the page and every measurement taken from it. Closing on that movement
    // is what made the calendar vanish under a touch before it could be read, so it
    // re-anchors where it stands instead of going away.
    let raf = 0;
    const move = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; anchor(pane); });
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', keys);
    window.addEventListener('scroll', move, true);
    window.addEventListener('resize', move);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', keys);
      window.removeEventListener('scroll', move, true);
      window.removeEventListener('resize', move);
    };
  }, [pane]);

  useEffect(() => {
    if (pane !== 'year' || !years.current) return;
    const chosen = years.current.querySelector<HTMLButtonElement>('[data-on="1"]');
    if (chosen) years.current.scrollTop = Math.max(0, chosen.offsetTop - 72);
  }, [pane, y]);

  const show = (key: Segment) => (key === 'm' && typed !== 'm' && m
    ? (SHORT[Number(m) - 1] || m)
    : key === 'd' ? d : key === 'm' ? m : y);

  const step = (from: Segment, forward: boolean) => {
    const order: Segment[] = ['d', 'm', 'y'];
    const at = order.indexOf(from) + (forward ? 1 : -1);
    if (at < 0 || at >= order.length) return;
    seg[order[at]].current?.focus();
  };

  const type = (key: Segment, limit: number, full: number) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const digits = event.target.value.replace(/\D/g, '').slice(0, limit);
    // "9" can only ever mean the ninth day or the ninth month, so it closes the
    // field on its own instead of waiting for a leading zero nobody types.
    const done = digits.length === 1 && Number(digits) > full;
    const next = done ? pad(Number(digits)) : digits;
    if (key === 'd') setD(next); else if (key === 'm') setM(next); else setY(next);
    if (next.length === limit) step(key, true);
  };

  const back = (key: Segment) => (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !event.currentTarget.value) { step(key, false); return; }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const at = event.target as HTMLInputElement;
      if ((event.key === 'ArrowRight' && at.selectionEnd === at.value.length)
        || (event.key === 'ArrowLeft' && at.selectionStart === 0)) {
        event.preventDefault();
        step(key, event.key === 'ArrowRight');
      }
    }
  };

  const focusSeg = (key: Segment) => (event: React.FocusEvent<HTMLInputElement>) => {
    setTyped(key);
    event.target.select();
  };

  const allowed = (day: number) => {
    if (!day) return false;
    const candidate = iso(pad(view.y, 4), pad(view.m), pad(day));
    if (max && candidate > max) return false;
    if (min && candidate < min) return false;
    return true;
  };

  const toggle = (next: Pane) => {
    if (pane === next) { setPane(''); return; }
    anchor(next);
    setPane(next);
  };

  const pickDay = (day: number) => {
    setD(pad(day)); setM(pad(view.m)); setY(pad(view.y, 4));
    setPane('');
  };

  const shift = (delta: number) => {
    const next = view.m - 1 + delta;
    setView({ y: view.y + Math.floor(next / 12), m: (next % 12 + 12) % 12 + 1 });
  };

  const yearList = (() => {
    const newest = Number(max?.slice(0, 4)) || new Date().getFullYear();
    const oldest = Number(min?.slice(0, 4)) || Math.min(1930, newest - 90);
    const top = Math.max(newest, y ? Number(y) : 0);
    const out: number[] = [];
    for (let at = top; at >= oldest; at--) out.push(at);
    return out;
  })();

  const firstWeekday = new Date(view.y, view.m - 1, 1).getDay();
  const last = daysInMonth(view.y, view.m);
  const chosen = y && m && d ? iso(y, m, d) : '';

  return (
    <div className="dp" ref={el => { box.current = el; register?.(el); }}>
      <div
        className={`dp-box${className ? ` ${className}` : ''}`}
        role="group"
        aria-label="Date of birth"
        aria-invalid={invalid ? 'true' : undefined}
        aria-describedby={describedBy}
      >
        <input
          ref={seg.d}
          className="dp-seg"
          value={d}
          inputMode="numeric"
          autoComplete="off"
          placeholder="DD"
          aria-label="Day"
          maxLength={2}
          onFocus={focusSeg('d')}
          onBlur={() => setTyped('')}
          onChange={type('d', 2, 3)}
          onKeyDown={back('d')}
        />
        <span className="dp-dot">/</span>
        <input
          ref={seg.m}
          className="dp-seg dp-seg-mon"
          value={show('m')}
          inputMode="numeric"
          autoComplete="off"
          placeholder="Mon"
          aria-label="Month"
          maxLength={3}
          onFocus={focusSeg('m')}
          onBlur={() => setTyped('')}
          onChange={type('m', 2, 1)}
          onKeyDown={back('m')}
        />
        <span className="dp-dot">/</span>
        <input
          ref={seg.y}
          className="dp-seg dp-seg-yr"
          value={y}
          inputMode="numeric"
          autoComplete="off"
          placeholder="YYYY"
          aria-label="Year"
          maxLength={4}
          onFocus={focusSeg('y')}
          onBlur={() => setTyped('')}
          onChange={type('y', 4, 9)}
          onKeyDown={back('y')}
        />
        <button
          type="button"
          className="dp-open"
          aria-label="Pick the date from a calendar"
          aria-expanded={pane ? 'true' : 'false'}
          onClick={() => toggle('day')}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
            <path d="M8 3.5v3M16 3.5v3M3.5 10h17" />
          </svg>
        </button>
      </div>

      {pane && (
        <div className="dp-pop" ref={pop} style={{ top: place.top, left: place.left, width: place.width }} role="dialog" aria-label="Choose a date">
          {pane === 'day' && (
            <>
              <div className="dp-head">
                <button type="button" className="dp-nav" aria-label="Previous month" onClick={() => shift(-1)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
                </button>
                <button type="button" className="dp-pick" onClick={() => toggle('month')}>{MONTHS[view.m - 1]}</button>
                <button type="button" className="dp-pick" onClick={() => toggle('year')}>{view.y}</button>
                <button type="button" className="dp-nav" aria-label="Next month" onClick={() => shift(1)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
                </button>
              </div>
              <div className="dp-week" aria-hidden="true">{WEEKDAYS.map((w, i) => <span key={i}>{w}</span>)}</div>
              <div className="dp-grid">
                {Array.from({ length: firstWeekday }, (_, i) => <span className="dp-blank" key={`b${i}`} />)}
                {Array.from({ length: last }, (_, i) => {
                  const day = i + 1;
                  const on = chosen && Number(y) === view.y && Number(m) === view.m && Number(d) === day;
                  return (
                    <button
                      type="button"
                      key={day}
                      className={`dp-cell${on ? ' on' : ''}`}
                      disabled={!allowed(day)}
                      onClick={() => pickDay(day)}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {pane === 'month' && (
            <div className="dp-mon-grid">
              {MONTHS.map((name, i) => (
                <button
                  type="button"
                  key={name}
                  className={`dp-cell dp-tall${Number(m) === i + 1 ? ' on' : ''}`}
                  onClick={() => { setM(pad(i + 1)); setView({ y: view.y, m: i + 1 }); setPane('day'); }}
                >
                  {SHORT[i]}
                </button>
              ))}
            </div>
          )}

          {pane === 'year' && (
            <div className="dp-years" ref={years}>
              {yearList.map(at => (
                <button
                  type="button"
                  key={at}
                  data-on={at === Number(y) ? '1' : undefined}
                  className={`dp-cell${at === Number(y) ? ' on' : ''}`}
                  onClick={() => { setY(pad(at, 4)); setView({ y: at, m: view.m }); setPane('day'); }}
                >
                  {at}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
