import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="notfound">
      <div className="notfound-card">
        <img className="notfound-mark" src="/exposing-icon.png" alt="Exposing" width={72} height={72} />
        <p className="notfound-code">404</p>
        <h1 className="notfound-title">This page doesn&apos;t exist</h1>
        <p className="notfound-copy">
          The link may be old, or the post behind it was removed by its author.
          Everything else on Exposing is still live.
        </p>
        <div className="notfound-actions">
          <Link className="notfound-primary" href="/">Back to Home</Link>
          <Link className="notfound-secondary" href="/explore">Search Exposing</Link>
        </div>
      </div>
    </div>
  );
}