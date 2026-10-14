'use client';

import { useEffect } from 'react';
import ModernLogin from '@/components/ModernLogin';

export default function LoginPage() {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', 'dark');
    return () => {
      const saved = localStorage.getItem('chautari-theme');
      root.setAttribute('data-theme', saved === 'dark' ? 'dark' : 'light');
    };
  }, []);

  return <ModernLogin />;
}
