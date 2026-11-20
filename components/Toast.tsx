'use client';

import { useEffect, useState } from 'react';
import { useApp } from '@/lib/AppContext';

export default function Toast() {
  const { toast } = useApp();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!toast) { setShow(false); return; }
    const frame = requestAnimationFrame(() => setShow(true));
    return () => cancelAnimationFrame(frame);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className={`toast ${show ? 'show' : ''}`} role="status">
      {toast}
    </div>
  );
}