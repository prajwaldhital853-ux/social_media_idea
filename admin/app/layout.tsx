import type { Metadata } from 'next';
import { ReactNode } from 'react';
import './globals.css';
import { SessionProvider } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Exposing — admin console',
  description: 'Staff console for moderation, users, coins and promotions.',
  // Nothing here should ever reach a search index.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
