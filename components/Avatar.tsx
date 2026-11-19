import { User } from '@/lib/types';
import { hash, initials } from '@/lib/utils';

const PALETTES = [
  ['#E40104', '#8F0102'],
  ['#FDA041', '#C77400'],
  ['#101114', '#3A3D42'],
  ['#B80103', '#E40104'],
  ['#5A6470', '#2B3138'],
  ['#A85E00', '#FDA041']
];

interface AvatarProps {
  user: User;
  size?: number;
}

export default function Avatar({ user, size = 44 }: AvatarProps) {
  if (user.avatar) {
    return (
      <img
        src={user.avatar}
        alt={user.username}
        width={size}
        height={size}
        style={{ borderRadius: '50%', objectFit: 'cover', width: size, height: size }}
      />
    );
  }
  const [a, b] = PALETTES[hash(user.id || user.username) % PALETTES.length];
  return (
    <span
      aria-label={user.username}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        background: `linear-gradient(135deg, ${a}, ${b})`,
        color: '#fff',
        fontWeight: 800,
        fontSize: Math.max(11, Math.round(size * 0.38)),
        letterSpacing: '0.02em',
        userSelect: 'none'
      }}
    >
      {initials(user.name || user.username)}
    </span>
  );
}