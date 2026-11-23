'use client';

import { useMemo } from 'react';
import { hash } from '@/lib/utils';

/**
 * A stable fake QR for the demo payment paths. It is not a scannable code:
 * nothing behind it moves money, and the copy on the page says so.
 */
export default function DemoQr({ seed, className = 'wallet-qr' }: { seed: string; className?: string }) {
  const cells = useMemo(() => {
    const n = 21;
    const out: boolean[][] = Array.from({ length: n }, () => Array(n).fill(false));
    let h = hash(seed);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        h = (Math.imul(h, 16777619) ^ (x * 31 + y * 17)) >>> 0;
        out[y][x] = h % 100 < 46;
      }
    }
    const finder = (ox: number, oy: number) => {
      for (let y = -1; y < 8; y++) for (let x = -1; x < 8; x++) {
        const px = ox + x, py = oy + y;
        if (px < 0 || py < 0 || px >= n || py >= n) continue;
        const border = x >= 0 && x < 7 && y >= 0 && y < 7 && (x === 0 || x === 6 || y === 0 || y === 6);
        const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        out[py][px] = border || core;
      }
    };
    finder(0, 0); finder(14, 0); finder(0, 14);
    return out;
  }, [seed]);

  return (
    <svg className={className} viewBox="0 0 21 21" role="img" aria-label="Demo payment QR">
      <rect width="21" height="21" fill="#fff" />
      {cells.map((row, y) => row.map((on, x) => on ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#101114" /> : null))}
    </svg>
  );
}
