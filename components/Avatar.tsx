import { User } from '@/lib/types';

interface AvatarProps {
  user: User;
  size?: number;
}

export default function Avatar({ user, size = 44 }: AvatarProps) {
  // Use a placeholder image service for more realistic avatars
  const avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.username}`;

  return (
    <img
      src={avatarUrl}
      alt={user.username}
      width={size}
      height={size}
      style={{ borderRadius: '50%', objectFit: 'cover' }}
    />
  );
}
