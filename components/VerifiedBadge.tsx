'use client';

import { useId } from 'react';

export default function VerifiedBadge({ size = 18 }: { size?: number }) {
  const uid = useId().replace(/:/g, '');
  const gid = `seal-${uid}`;

  return (
    <span className="verified-seal" title="Verified on Chautari" style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#F2A900" />
            <stop offset="55%" stopColor="#2457A6" />
            <stop offset="100%" stopColor="#173A73" />
          </linearGradient>
        </defs>
        <path
          fill={`url(#${gid})`}
          d="M12 1.4l2.32.7 1.96-1.4.86 2.26 2.38.52-.18 2.42 2.12 1.22-1.18 2.14.1 2.42-2.28 1.02-.9 2.24-2.4-.12-1.8 1.6L12 22.6l-1.0-2.18-1.8-1.6-2.4.12-.9-2.24-2.28-1.02.1-2.42-1.18-2.14 2.12-1.22-.18-2.42 2.38-.52.86-2.26 1.96 1.4L12 1.4z"
        />
        <path
          fill="#fff"
          d="M10.35 12.55l-1.7-1.7-1.15 1.15 2.85 2.85 5.4-5.4-1.15-1.15-4.25 4.25z"
        />
      </svg>
    </span>
  );
}
