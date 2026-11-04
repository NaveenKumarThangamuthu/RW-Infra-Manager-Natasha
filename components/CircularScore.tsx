"use client";

interface Props {
  /** 0–100 score, or null for "no data". */
  value: number | null;
  /** Diameter in pixels. Default 64. */
  size?: number;
  /** Ring thickness in pixels. Default 6. */
  stroke?: number;
  /** Override color palette (default: PSI-style thresholds). */
  color?: string;
  /** Optional label rendered below the number, inside the ring. */
  subtitle?: string;
}

function pickColor(v: number | null): string {
  if (v === null) return "#64748b";
  if (v >= 90) return "#22c55e";
  if (v >= 50) return "#f59e0b";
  return "#ef4444";
}

/**
 * PSI-style circular score gauge. Colored arc for the score, translucent
 * companion arc for the "missing" fraction, big score in the middle.
 */
export default function CircularScore({ value, size = 64, stroke = 6, color, subtitle }: Props) {
  const c = color ?? pickColor(value);
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const clamped = value === null ? 0 : Math.max(0, Math.min(100, value));
  const dash = (clamped / 100) * circ;
  const shown = value === null ? "—" : Math.round(value).toString();

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`score ${shown}`}>
      <defs>
        <linearGradient id={`grad-${size}-${Math.round(clamped)}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity="0.95" />
          <stop offset="100%" stopColor={c} stopOpacity="0.7" />
        </linearGradient>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={c} strokeOpacity={0.15} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={`url(#grad-${size}-${Math.round(clamped)})`}
        strokeWidth={stroke}
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeDashoffset={circ / 4}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2}) scale(1,-1) translate(0,-${size})`}
      />
      <text
        x="50%"
        y={subtitle ? "45%" : "50%"}
        dominantBaseline="central"
        textAnchor="middle"
        fill={c}
        fontSize={size * 0.34}
        fontWeight={700}
        style={{ fontVariantNumeric: "tabular-nums", letterSpacing: -0.5 }}
      >
        {shown}
      </text>
      {subtitle ? (
        <text
          x="50%"
          y="68%"
          dominantBaseline="central"
          textAnchor="middle"
          fill="#7c8aa5"
          fontSize={size * 0.12}
          fontWeight={600}
          style={{ letterSpacing: 0.6, textTransform: "uppercase" }}
        >
          {subtitle}
        </text>
      ) : null}
    </svg>
  );
}
