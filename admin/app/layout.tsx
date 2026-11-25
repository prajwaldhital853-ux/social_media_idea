import type { Metadata } from 'next';
import { ReactNode } from 'react';
import './globals.css';
import { ConfirmProvider } from '@/components/Confirm';
import { BellProvider } from '@/lib/bell';
import { SessionProvider } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Exposing, admin console',
  description: 'Staff console for moderation, users, coins and promotions.',
  // Nothing here should ever reach a search index.
  robots: { index: false, follow: false },
};

// Read before the first paint: a console that flashes white on the way to a
// midnight dark would make the seat blink, and the choice is already in storage.
const THEME_BOOT = `
(function () {
  try {
    var saved = localStorage.getItem('exposing-admin-theme');
    var dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <SessionProvider>
          <BellProvider>
            <ConfirmProvider>{children}</ConfirmProvider>
          </BellProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
