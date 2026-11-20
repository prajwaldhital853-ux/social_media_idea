'use client';

import { useEffect } from 'react';
import ModernLogin from '@/components/ModernLogin';
import { THEME_KEY } from '@/lib/utils';

export default function LoginPage() {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', 'dark');
    return () => {
      const saved = localStorage.getItem(THEME_KEY);
      root.setAttribute('data-theme', saved === 'dark' ? 'dark' : 'light');
    };
  }, []);

  return <ModernLogin />;
}
