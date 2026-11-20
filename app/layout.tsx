import type { Metadata, Viewport } from 'next'
import './globals.css'
import { AppProvider } from '@/lib/AppContext'
import ViewportSync from '@/components/ViewportSync'

export const metadata: Metadata = {
  title: 'Exposing',
  description: 'See it. Share it. Exposing. Photos, clips and stories from your corner of the world.',
  icons: {
    icon: [{ url: '/exposing-icon.png', sizes: '512x512', type: 'image/png' }],
    apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
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
            __html: `try{var t=localStorage.getItem('exposing-theme');if(window.location?.pathname?.indexOf('/login')===0){t='dark'}else if(t!=='dark'){t='light'}document.documentElement.setAttribute('data-theme',t)}catch(e){}`
          }}
        />
      </head>
      <body>
        <AppProvider>
          <ViewportSync />
          {children}
        </AppProvider>
      </body>
    </html>
  )
}
