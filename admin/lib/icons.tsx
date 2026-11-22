import { ReactNode } from 'react';

/**
 * Twelve hand-drawn paths, no icon package: the console is its own deploy, and a
 * dependency tree for twelve glyphs is not worth the cold start.
 */
function svg(children: ReactNode) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const IC = {
  shield: svg(<path d="M12 3l7 3v5c0 4.4-2.9 8.3-7 9.5-4.1-1.2-7-5.1-7-9.5V6l7-3z"/>),
  seat: svg(<><circle cx="12" cy="8" r="3.4"/><path d="M5.5 20a6.5 6.5 0 0113 0"/></>),
  key: svg(<><circle cx="9" cy="12" r="3"/><path d="M12 12h8M17 12v3"/></>),
  users: svg(<><circle cx="9" cy="9" r="3"/><path d="M3 19a6 6 0 0112 0"/><path d="M16 8.5a3 3 0 010 5"/><path d="M18.5 19a5.5 5.5 0 00-2-4"/></>),
  logout: svg(<><path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h9"/></>),
  check: svg(<path d="M5 13l4 4 10-10"/>),
  x: svg(<path d="M6 6l12 12M18 6L6 18"/>),
  plus: svg(<path d="M12 5v14M5 12h14"/>),
  refresh: svg(<><path d="M20 12a8 8 0 10-3 6.2"/><path d="M20 6v6h-6"/></>),
  copy: svg(<><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M14 5h5v5"/></>),
  alert: svg(<><path d="M12 4l8 15H4l8-15z"/><path d="M12 10v4M12 17h.01"/></>),
  lock: svg(<><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></>),
  qr: svg(<><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2z"/></>),
  search: svg(<><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></>),
  chart: svg(<><path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 15l4-6 3 4 4-7"/></>),
  coin: svg(<><circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10h4a1.8 1.8 0 010 3.6h-3a1.8 1.8 0 000 3.6h4"/></>),
  flag: svg(<><path d="M6 21V4"/><path d="M6 5h11l-2 3.5L17 12H6"/></>),
  store: svg(<><path d="M4 9l1.5-4h13L20 9"/><path d="M5 9h14v10a1 1 0 01-1 1H6a1 1 0 01-1-1V9z"/><path d="M9.5 20v-6h5v6"/></>),
  pulse: svg(<path d="M3 12h4l2.5-6 3 12 2.5-6h6"/>),
  chat: svg(<path d="M4 5h16v11H9l-5 4V5z"/>),
  disk: svg(<><ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v12c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8V6"/><path d="M5 12c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8"/></>),
  go: svg(<><path d="M5 12h12"/><path d="M12 6l6 6-6 6"/></>),
};
