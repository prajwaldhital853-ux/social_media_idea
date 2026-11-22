'use client';

import { IC } from './icons';

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof IC;
  /** The permission key that makes this entry visible; null means any staff seat. */
  permission: string | null;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

/**
 * One list drives the sidebar and the door checks, so a screen cannot appear in
 * navigation that its own endpoint would refuse. Each contract section adds its
 * entries here as it ships — nothing is listed before it works.
 */
export const NAV: NavGroup[] = [
  {
    id: 'numbers',
    label: 'Numbers',
    items: [
      { href: '/overview', label: 'Dashboard', icon: 'chart', permission: 'overview' },
    ],
  },
  {
    id: 'moderation',
    label: 'Moderation',
    items: [
      { href: '/reports', label: 'Report queue', icon: 'flag', permission: 'reports' },
      { href: '/content', label: 'Takedown shelf', icon: 'shelf', permission: 'reports' },
      { href: '/policy', label: 'Platform rules', icon: 'rule', permission: 'reports' },
      { href: '/notices', label: 'Public notices', icon: 'mega', permission: 'notices' },
    ],
  },
  {
    id: 'people',
    label: 'People',
    items: [
      { href: '/people', label: 'User directory', icon: 'users', permission: 'users' },
    ],
  },
  {
    id: 'money',
    label: 'Money',
    items: [
      { href: '/coins', label: 'Coin requests', icon: 'coin', permission: 'coins_view' },
      { href: '/ledger', label: 'Coin ledger', icon: 'disk', permission: 'coin_ledger' },
      { href: '/pricing', label: 'Coin pricing', icon: 'qr', permission: 'coin_settings' },
    ],
  },
  {
    id: 'reach',
    label: 'Reach',
    items: [
      { href: '/promotions', label: 'Paid campaigns', icon: 'target', permission: 'promotions_view' },
      { href: '/packages', label: 'Campaign packages', icon: 'store', permission: 'promotion_packages' },
      { href: '/algorithm', label: 'Reach controls', icon: 'sliders', permission: 'promotion_algorithm' },
    ],
  },
  {
    id: 'platform',
    label: 'Platform',
    items: [
      { href: '/welcome', label: 'First-load wording', icon: 'chat', permission: 'welcome_text' },
    ],
  },
  {
    id: 'console',
    label: 'Console',
    items: [
      { href: '/access', label: 'Staff and access', icon: 'seat', permission: 'staff_view' },
      { href: '/me', label: 'My seat', icon: 'key', permission: null },
    ],
  },
];

export function navFor(permissions: string[], role: string): NavGroup[] {
  const holds = (key: string | null) => role === 'superadmin' || !key || permissions.includes(key);
  return NAV.map(group => ({ ...group, items: group.items.filter(item => holds(item.permission)) }))
            .filter(group => group.items.length > 0);
}

/** The two words above a screen: which group it sits in, and its own name. */
export function crumbsFor(pathname: string): string[] {
  const clean = (pathname || '/').replace(/\/$/, '') || '/';
  for (const group of NAV) {
    const hit = group.items.find(item => clean === item.href || clean.startsWith(`${item.href}/`));
    if (hit) return [group.label, hit.label];
  }
  return [];
}

export function requires(pathname: string): string | null {
  for (const group of NAV) {
    for (const item of group.items) {
      if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return item.permission;
    }
  }
  return null;
}

/**
 * Whether a route an alert points at exists yet. The dashboard links an alert to
 * the screen that clears it, but that screen may be next week's section — so a
 * route that has not shipped is named in the alert instead of linked to a 404.
 */
export function shipped(href: string): boolean {
  const pathname = (href.split('?')[0] || '/').replace(/\/$/, '') || '/';
  return NAV.some(group => group.items.some(item => pathname === item.href));
}
