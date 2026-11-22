import { ReactNode } from 'react';

/**
 * Hand-drawn paths, no icon package: the console is its own deploy, and a
 * dependency tree for a dozen glyphs is not worth the cold start.
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
  shelf: svg(<><rect x="4" y="4" width="16" height="7" rx="1.5"/><rect x="4" y="13" width="16" height="7" rx="1.5"/><path d="M8 7.5h.01M8 16.5h.01"/></>),
  rule: svg(<><path d="M5 5h14M5 12h14M5 19h9"/><circle cx="17.5" cy="19" r="1.6"/></>),
  mega: svg(<><path d="M4 10v4l10 4V6L4 10z"/><path d="M14 8.5a3.5 3.5 0 010 7"/><path d="M6 14v4a1.5 1.5 0 003 0v-2.6"/></>),
  eye: svg(<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></>),
  pen: svg(<><path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19l-4 1z"/><path d="M14.5 6.5l3 3"/></>),
  trash: svg(<><path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></>),
  dots: svg(<><circle cx="5.5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none"/></>),
  chevron: svg(<path d="M9 6l6 6-6 6"/>),
  download: svg(<><path d="M12 4v11"/><path d="M7.5 11L12 15.5 16.5 11"/><path d="M5 19h14"/></>),
  target: svg(<><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></>),
  sliders: svg(<><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></>),
};
