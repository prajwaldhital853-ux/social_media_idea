import Link from 'next/link';

interface BrandLogoProps {
  height?: number;
  href?: string;
  className?: string;
}

export default function BrandLogo({ height = 44, href = '/', className = '' }: BrandLogoProps) {
  return (
    <Link href={href} className={`brand-logo ${className}`} aria-label="Exposing home">
      <img src="/exposing-logo.png" alt="Exposing" className="brand-logo-light" style={{ height }} />
      <img src="/exposing-logo-dark.png" alt="" aria-hidden="true" className="brand-logo-dark" style={{ height }} />
      <img src="/exposing-icon.png" alt="" aria-hidden="true" className="brand-logo-mark" style={{ height: Math.min(height, 34) }} />
    </Link>
  );
}