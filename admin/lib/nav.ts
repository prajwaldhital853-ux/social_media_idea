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
    id: 'console',
    label: 'Console',
    items: [
      { href: '/access', label: 'Staff and access', icon: 'users', permission: 'staff_view' },
      { href: '/me', label: 'My seat', icon: 'seat', permission: null },
    ],
  },
];

export function navFor(permissions: string[], role: string): NavGroup[] {
  const holds = (key: string | null) => role === 'superadmin' || !key || permissions.includes(key);
  return NAV.map(group => ({ ...group, items: group.items.filter(item => holds(item.permission)) }))
            .filter(group => group.items.length > 0);
}

export function requires(pathname: string): string | null {
  for (const group of NAV) {
    for (const item of group.items) {
      if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return item.permission;
    }
  }
  return null;
}
