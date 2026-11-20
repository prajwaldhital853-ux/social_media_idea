'use client';

import LegalDoc from '@/components/LegalDoc';
import { useApp } from '@/lib/AppContext';

export default function CookiesPage() {
  const { t } = useApp();
  return (
    <LegalDoc
      title={t('cookies')}
      updated="20 November 2026"
      intro="Exposing keeps you signed in and remembers your preferences using your browser’s own storage. This page explains exactly what is stored, why, and how to clear it. The demo uses no advertising or cross-site tracking cookies."
      sections={[
        {
          h: 'What we store',
          list: [
            'exposing-demo-v1 (localStorage): the demo database — accounts, posts, comments, reactions, follows, messages, wallet and settings.',
            'exposing-theme (localStorage): your light or dark mode choice.',
            'exposing-search-history:<user> (localStorage): your recent search terms, kept per account.',
            'exposing-media (IndexedDB): video clips you attach, stored on-device so they survive reloads.'
          ]
        },
        {
          h: 'Why we store it',
          paras: ['These are strictly necessary for the app to work: to keep you signed in, to remember your theme and language, to show your feed and saved posts, and to play back the clips you uploaded. Without them the demo would reset on every reload.']
        },
        {
          h: 'What we do not use',
          paras: ['No third-party advertising cookies, no cross-site trackers, no analytics pixels and no fingerprinting. Sample photos and clips load from public CDNs (Unsplash, MDN, W3Schools); those requests are subject to the providers’ own policies, but Exposing sets no cookies through them.']
        },
        {
          h: 'How long it stays',
          paras: ['Local storage persists until you clear it. Nothing is deleted automatically. Video clips stay in IndexedDB until you delete the post or reset the demo.']
        },
        {
          h: 'Your controls',
          list: [
            'Settings → Reset demo data restores the original sample accounts, posts and wallet.',
            'Your browser’s “clear site data” removes everything Exposing stored on this device.',
            'Private / incognito windows keep storage only for that session.',
            'You can browse the public feed without signing in; no account storage is created until you sign up.'
          ]
        },
        {
          h: 'Changes and contact',
          paras: ['If we ever add optional cookies (for example, analytics), we will ask for consent first and update this page. Questions: support@exposing.demo.']
        }
      ]}
    />
  );
}