'use client';

import { useId } from 'react';

export default function VerifiedBadge({ size = 18 }: { size?: number }) {
  const gid = 'vb-' + useId().replace(/:/g, '');

  return (
    <span className="verified-seal" title="Verified on Chautari" style={{ width: size, height: size, display: 'inline-flex' }}>
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#4FB3FF" />
            <stop offset="100%" stopColor="#1565D8" />
          </linearGradient>
        </defs>
        {/* Rounded shield shape */}
        <path
          fill={'url(#' + gid + ')'}
          d="M12 1.8c.4 0 .8.1 1.2.3l6.4 2.7c.8.3 1.3 1.1 1.3 1.9v4.6c0 5-3.6 9.2-8.4 10.6-.3.1-.7.1-1 0C6.7 20.5 3.1 16.3 3.1 11.3V6.7c0-.8.5-1.6 1.3-1.9l6.4-2.7c.4-.2.8-.3 1.2-.3z"
        />
        {/* Tick */}
        <path
          d="M8 12.2l2.7 2.7L16.2 9.4"
          fill="none"
          stroke="#fff"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
