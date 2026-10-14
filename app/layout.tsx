import type { Metadata } from 'next'
import './globals.css'
import { AppProvider } from '@/lib/AppContext'

export const metadata: Metadata = {
  title: 'Chautari',
  description: 'A social media platform',
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
            __html: `try{var t=localStorage.getItem('chautari-theme');if(location.pathname.indexOf('/login')===0){t='dark'}else if(t!=='dark'){t='light'}document.documentElement.setAttribute('data-theme',t)}catch(e){}`
          }}
        />
      </head>
      <body>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  )
}
