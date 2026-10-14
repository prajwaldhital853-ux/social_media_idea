export function FlagsSvg() {
  const cols = ['#2D6CC0', '#F1F3EE', '#D0352C', '#2E8B57', '#F2C318'];
  const P0 = [-10, 36];
  const P1 = [300, 150];
  const P2 = [610, 28];
  const n = 17;

  const flags = Array.from({ length: n }, (_, i) => {
    const tt = 0.03 + i * (0.94 / (n - 1));
    const q = 1 - tt;
    const x = q * q * P0[0] + 2 * q * tt * P1[0] + tt * tt * P2[0];
    const y = q * q * P0[1] + 2 * q * tt * P1[1] + tt * tt * P2[1];
    const dx = 2 * q * (P1[0] - P0[0]) + 2 * tt * (P2[0] - P1[0]);
    const dy = 2 * q * (P1[1] - P0[1]) + 2 * tt * (P2[1] - P1[1]);
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;

    return (
      <g key={i} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${ang.toFixed(1)})`}>
        <rect
          className="flag"
          style={{ '--d': `${(i * 0.23).toFixed(2)}s` } as React.CSSProperties}
          x="-8"
          y="0"
          width="16"
          height="22"
          fill={cols[i % 5]}
        />
      </g>
    );
  });

  return (
    <svg className="flags" viewBox="0 0 600 140" preserveAspectRatio="xMidYMin meet" aria-hidden="true">
      <path d="M-10 36 Q300 150 610 28" fill="none" stroke="#D3DCEB" strokeWidth="1.4" />
      {flags}
    </svg>
  );
}

export function RidgesSvg() {
  return (
    <svg className="ridges" viewBox="0 400 600 400" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <g className="sun">
        <circle cx="330" cy="470" r="58" fill="#F2A900" />
      </g>
      <path d="M0 520 L90 450 L170 500 L260 425 L350 490 L430 440 L520 500 L600 460 V800 H0Z" fill="#3A6BAE" />
      <path d="M0 600 L110 520 L200 590 L300 500 L400 580 L500 520 L600 590 V800 H0Z" fill="#2B5594" />
      <path d="M0 690 L80 640 L180 700 L290 630 L390 700 L490 650 L600 700 V800 H0Z" fill="#1A3868" />
      <path d="M0 760 L120 720 L240 770 L360 720 L480 765 L600 735 V800 H0Z" fill="#0E2245" />
    </svg>
  );
}
