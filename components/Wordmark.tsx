import Link from 'next/link';
import { IC } from '@/lib/icons';

interface WordmarkProps {
  className?: string;
}

export default function Wordmark({ className = '' }: WordmarkProps) {
  return (
    <Link href="/" className={`wm ${className}`}>
      <span>Chautari</span>
    </Link>
  );
}
