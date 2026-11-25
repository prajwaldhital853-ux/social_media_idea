'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { num } from '@/lib/format';
import { SeriesPoint } from '@/lib/types';

/** One line of the activity chart. The colour arrives with it because the tile
 *  it came from owns the colour everywhere else on the screen, the legend, the
 *  tile's own sparkline and this chart must not disagree. */
export interface ChartSeries {
  id: string;
  label: string;
  color: string;
  points: SeriesPoint[];
}

export interface RingSlice {
  id: string;
  label: string;
  value: number;
  color: string;
}

const W = 780;
const H = 232;
const PLOT = { top: 14, right: 12, bottom: 28, left: 46 };
/** A day key is `YYYY-MM-DD`; the axis only has room for "12 Nov". */
function dayLabel(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value.slice(5)
    : `${parsed.getDate()} ${parsed.toLocaleString('en', { month: 'short' })}`;
}

/** Round the top of the scale up to something a person can read off an axis. */
function axisTop(peak: number) {
  if (peak <= 4) return 4;
  const step = peak <= 20 ? 5 : peak <= 60 ? 10 : peak <= 200 ? 40 : 100;
  return Math.ceil(peak / step) * step;
}

export function ActivityChart({ series, hint }: { series: ChartSeries[]; hint?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const [at, setAt] = useState<number | null>(null);
  // The plot is drawn in real pixels, not in a fixed box stretched to fit: a
  // 780-unit viewBox inside a 1130px panel leaves the axis sitting in the
  // middle of the panel with two empty gutters either side of it.
  const [wide, setWide] = useState(W);

  useEffect(() => {
    const holder = box.current;
    if (!holder || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(entries => {
      const width = Math.round(entries[0].contentRect.width);
      if (width > 0) setWide(width);
    });
    watch.observe(holder);
    return () => watch.disconnect();
  }, []);

  // Every tile is counted over the same window, but a series can be shorter if
  // the platform is younger than the window, so the axis comes from the longest.
  const days = useMemo(() => {
    const seen: string[] = [];
    series.forEach(line => line.points.forEach(point => {
      if (!seen.includes(point.day)) seen.push(point.day);
    }));
    return seen.sort();
  }, [series]);

  // The server decides how many days it counts back, so the choices are cut from
  // what actually arrived rather than offering a month that is really two weeks.
  const ranges = useMemo(() => {
    const offered: number[] = [];
    [7, 14].forEach(size => {
      if (size < days.length) offered.push(size);
    });
    offered.push(0);
    return offered;
  }, [days.length]);

  const [range, setRange] = useState(0);

  const shown = useMemo(() => {
    const window = range ? days.slice(-range) : days;
    const start = days.length - window.length;
    const index = new Map(days.map((day, position) => [day, position]));
    return {
      window,
      lines: series
        .filter(line => !hidden.includes(line.id))
        .map(line => {
          const values = new Array(window.length).fill(0);
          line.points.forEach(point => {
            const position = index.get(point.day);
            if (position !== undefined && position >= start) values[position - start] = point.n;
          });
          return { ...line, values, total: values.reduce((sum, value) => sum + value, 0) };
        }),
    };
  }, [days, hidden, range, series]);

  const peak = axisTop(Math.max(1, ...shown.lines.flatMap(line => line.values)));
  const innerW = wide - PLOT.left - PLOT.right;
  const innerH = H - PLOT.top - PLOT.bottom;
  const step = shown.window.length > 1 ? innerW / (shown.window.length - 1) : 0;
  const x = (position: number) => PLOT.left + position * step;
  const y = (value: number) => PLOT.top + innerH - (value / peak) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(part => Math.round(peak * part));
  const labelEvery = Math.max(1, Math.ceil(shown.window.length / 8));

  const move = (event: React.PointerEvent) => {
    if (!box.current || !shown.window.length) return;
    const rect = box.current.getBoundingClientRect();
    setAt(Math.min(shown.window.length - 1, Math.max(0, Math.round((event.clientX - rect.left - PLOT.left) / (step || 1)))));
  };

  const best = shown.window.map((_, position) => (
    shown.lines.reduce((top, line) => Math.max(top, line.values[position] ?? 0), 0)
  ));
  const busiest = shown.window.length ? best.indexOf(Math.max(...best)) : -1;
  // The busiest day is marked with a column, and the column has to stay inside
  // the plot: on the last day of the window half of it would otherwise hang out
  // over the panel as a grey flap.
  const bandLeft = clamp(x(busiest) - Math.max(4, step / 2), PLOT.left, wide - PLOT.right);
  const bandRight = clamp(x(busiest) + Math.max(4, step / 2), PLOT.left, wide - PLOT.right);

  return (
    <div className="chart" ref={box} onPointerMove={move} onPointerLeave={() => setAt(null)}>
      <div className="chart-bar">
        <div className="chart-legend">
          {series.map(line => {
            const entry = shown.lines.find(keeper => keeper.id === line.id);
            const off = hidden.includes(line.id);
            return (
              <button
                key={line.id} type="button"
                className={`legend${off ? ' is-off' : ''}`}
                aria-pressed={!off}
                onMouseEnter={() => setFocus(line.id)} onMouseLeave={() => setFocus(null)}
                onClick={() => setHidden(current =>
                  (current.includes(line.id) ? current.filter(id => id !== line.id) : [...current, line.id]))}
                title={off ? `Show ${line.label} again` : `Hide ${line.label}`}
              >
                <i style={{ background: line.color }}/>
                <span>{line.label}</span>
                <b>{num(entry ? entry.total : 0)}</b>
              </button>
            );
          })}
        </div>
        <div className="chart-range" role="group" aria-label="Window">
          {ranges.map(size => (
            <button
              key={size} type="button" className={`seg${range === size ? ' is-on' : ''}`}
              onClick={() => setRange(size)}
            >
              {size ? `${size}d` : 'All'}
            </button>
          ))}
        </div>
      </div>

      <svg className="chart-plot" viewBox={`0 0 ${wide} ${H}`} role="img"
           aria-label={`Daily counts over ${shown.window.length} days${hint ? `. ${hint}` : ''}`}>
        {ticks.map(value => (
          <g key={value} className="grid">
            <line x1={PLOT.left} x2={wide - PLOT.right} y1={y(value)} y2={y(value)}/>
            <text x={PLOT.left - 9} y={y(value) + 3.5} textAnchor="end">{num(value)}</text>
          </g>
        ))}

        {shown.window.map((day, position) => (
          position % labelEvery === 0 || position === shown.window.length - 1
            ? (
              <text key={day} className="axis" x={x(position)} y={H - 8}
                    textAnchor={position === 0 ? 'start'
                      : position === shown.window.length - 1 ? 'end' : 'middle'}>{dayLabel(day)}</text>
            )
            : null
        ))}

        {busiest >= 0 && (
          <rect className="peak" x={bandLeft} y={PLOT.top} width={bandRight - bandLeft} height={innerH}/>
        )}

        {shown.lines.map((line, index) => {
          const path = line.values.map((value, position) => `${x(position)},${y(value)}`).join(' ');
          const area = `${PLOT.left},${y(0)} ${path} ${x(line.values.length - 1)},${y(0)}`;
          const dim = focus !== null && focus !== line.id;
          // Keyed on the window so switching 7d/14d redraws the line instead of
          // snapping a quarter of it away.
          return (
            <g key={`${line.id}-${range}`} className={`line${dim ? ' is-dim' : ''}`}>
              {shown.lines.length === 1 && <polygon className="line-fill" points={area} style={{ fill: line.color }}/>}
              <polyline className="line-path" points={path} pathLength={1}
                        style={{ stroke: line.color, animationDelay: `${index * 110}ms` }}/>
              <g className="line-dots" style={{ animationDelay: `${index * 110 + 620}ms` }}>
                {line.values.map((value, position) => (
                  <circle key={position} className="line-dot" cx={x(position)} cy={y(value)}
                          r={position === busiest ? 3.2 : 2.2} style={{ fill: line.color }}/>
                ))}
              </g>
            </g>
          );
        })}

        {at !== null && shown.window[at] && (
          <g className="crosshair">
            <line x1={x(at)} x2={x(at)} y1={PLOT.top} y2={PLOT.top + innerH}/>
            {shown.lines.map(line => (
              <circle key={line.id} cx={x(at)} cy={y(line.values[at] ?? 0)} r={4.2}
                      style={{ stroke: line.color }}/>
            ))}
          </g>
        )}
      </svg>

      {at !== null && shown.window[at] && (
        <div className="chart-tip" style={{ left: `${clamp(x(at), 74, wide - 74)}px` }}>
          <b>{dayLabel(shown.window[at])}</b>
          {shown.lines.map(line => (
            <span key={line.id}>
              <i style={{ background: line.color }}/>
              {line.label}
              <em>{num(line.values[at] ?? 0)}</em>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

export function MixRing({ slices, caption }: { slices: RingSlice[]; caption: string }) {
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => setMounted(true), []);

  const counted = slices.filter(slice => slice.value > 0);
  const total = counted.reduce((sum, slice) => sum + slice.value, 0);
  const radius = 52;
  const ring = 2 * Math.PI * radius;
  const read = counted.find(slice => slice.id === active);
  let before = 0;

  return (
    <div className="ring">
      <div className="ring-plot">
        <svg viewBox="0 0 140 140" role="img" aria-label={`${caption}: ${num(total)} in total`}>
          <circle className="ring-track" cx="70" cy="70" r={radius}/>
          {total > 0 && counted.map((slice, index) => {
            const length = (slice.value / total) * ring;
            const offset = -before;
            before += length;
            return (
              <circle
                key={slice.id}
                cx="70" cy="70" r={radius}
                className={`ring-seg${active === slice.id ? ' is-active' : ''}`}
                stroke={slice.color}
                strokeWidth={active === slice.id ? 15 : 12}
                strokeDasharray={mounted ? `${length} ${ring - length}` : `0 ${ring}`}
                strokeDashoffset={offset}
                style={{ transitionDelay: `${index * 90}ms` }}
                onMouseEnter={() => setActive(slice.id)}
                onMouseLeave={() => setActive(null)}
              >
                <title>{`${slice.label}: ${num(slice.value)}`}</title>
              </circle>
            );
          })}
        </svg>
        <div className="ring-read">
          <b>{num(read ? read.value : total)}</b>
          <span>{read ? read.label : caption}</span>
        </div>
      </div>

      {!total ? (
        <p className="ring-empty">Nothing is waiting here, so there is no mix to show.</p>
      ) : (
        <ul className="ring-legend">
          {slices.map(slice => (
            <li
              key={slice.id}
              className={`${active === slice.id ? 'is-active' : ''}${slice.value ? '' : ' is-zero'}`}
              onMouseEnter={() => setActive(slice.id)}
              onMouseLeave={() => setActive(null)}
            >
              <i style={{ background: slice.color }}/>
              <span>{slice.label}</span>
              <b>{num(slice.value)}</b>
              <em>{total ? Math.round((slice.value / total) * 100) : 0}%</em>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
