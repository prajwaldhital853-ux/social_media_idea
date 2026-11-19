import type { Metadata } from 'next'
import './globals.css'
import { AppProvider } from '@/lib/AppContext'

export const metadata: Metadata = {
  title: 'Exposing',
  description: 'See it. Share it. Exposing. Photos, clips and stories from your corner of the world.',
  icons: { icon: '/exposing-icon.png' },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('exposing-theme');if(location.pathname.indexOf('/login')===0){t='dark'}else if(t!=='dark'){t='light'}document.documentElement.setAttribute('data-theme',t)}catch(e){}`
          }}
        />
      </head>
      <body>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  )
}
