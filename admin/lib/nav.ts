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
 * entries here as it ships, nothing is listed before it works.
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
    id: 'safety',
    label: 'Safety',
    items: [
      { href: '/spam', label: 'Spam rules', icon: 'shield', permission: 'spam_settings' },
      { href: '/flags', label: 'Flagged pile', icon: 'alert', permission: 'reports' },
      { href: '/alerts', label: 'Automated alerts', icon: 'pulse', permission: 'alerts' },
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
      { href: '/limits', label: 'Post limits', icon: 'sliders', permission: 'post_limits' },
      { href: '/features', label: 'Site features', icon: 'shield', permission: 'site_features' },
    ],
  },
  {
    id: 'records',
    label: 'Records',
    items: [
      { href: '/audit', label: 'Audit log', icon: 'disk', permission: 'audit' },
      { href: '/exports', label: 'CSV exports', icon: 'download', permission: 'exports' },
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

/**
 * Screens a seat arrives at from inside a row rather than from the drawer. They
 * stay out of the sidebar, it is a list of desks, not a list of every page ,
 * but they still need the two words above them and the door that opens them.
 */
const OFF_DRAWER = [
  { href: '/review/', group: 'Moderation', label: 'The thing itself', permission: 'reports' },
];

const isUnder = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** The two words above a screen: which group it sits in, and its own name. */
export function crumbsFor(pathname: string): string[] {
  const clean = (pathname || '/').replace(/\/$/, '') || '/';
  for (const group of NAV) {
    const hit = group.items.find(item => isUnder(clean, item.href));
    if (hit) return [group.label, hit.label];
  }
  const off = OFF_DRAWER.find(item => clean.startsWith(item.href));
  return off ? [off.group, off.label] : [];
}

export function requires(pathname: string): string | null {
  for (const group of NAV) {
    for (const item of group.items) {
      if (isUnder(pathname, item.href)) return item.permission;
    }
  }
  const off = OFF_DRAWER.find(item => pathname.startsWith(item.href));
  return off ? off.permission : null;
}

/**
 * Which drawer row a screen belongs to. A user's page is still inside the directory,
 * so the drawer keeps that row lit, and whatever is waiting in that queue stays
 * counted against the same row.
 */
export function drawerFor(pathname: string): string {
  const clean = (pathname || '/').replace(/\/$/, '') || '/';
  for (const group of NAV) {
    const hit = group.items.find(item => isUnder(clean, item.href));
    if (hit) return hit.href;
  }
  const off = OFF_DRAWER.find(item => clean.startsWith(item.href));
  return off ? off.href.replace(/\/$/, '') : '';
}

/**
 * Whether this seat may open a route an alert points at. The dashboard links an
 * alert to the screen that clears it, and two different things make a screen
 * unreachable: it may not have shipped yet, or it may have shipped and be a door
 * this seat was never given. Both read the same way to the person looking, a name
 * instead of a link, because a link that lands on a 404 or on "not on your seat"
 * sends a moderator to knock on a door instead of telling them who holds the key.
 */
export function shipped(href: string, permissions: string[] = [], role = ''): boolean {
  const pathname = (href.split('?')[0] || '/').replace(/\/$/, '') || '/';
  const hit = NAV.flatMap(group => group.items).find(item => pathname === item.href);
  if (!hit) return false;
  return role === 'superadmin' || !hit.permission || permissions.includes(hit.permission);
}
