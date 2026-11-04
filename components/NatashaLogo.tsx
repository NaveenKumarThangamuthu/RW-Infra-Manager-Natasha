/**
 * Natasha brand mark — inline SVG so it renders crisp at any size and tints
 * via currentColor + a subtle gradient.
 */
export default function NatashaLogo({ size = 24 }: { size?: number }) {
  const gradId = "natasha-grad";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-label="Natasha">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="55%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#c084fc" />
        </linearGradient>
        <filter id="natasha-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
      </defs>
      {/* outer ring */}
      <circle cx="16" cy="16" r="14" fill="none" stroke={`url(#${gradId})`} strokeWidth="1.2" opacity="0.45" />
      {/* inner core */}
      <circle cx="16" cy="16" r="9" fill={`url(#${gradId})`} opacity="0.16" />
      {/* stylized N */}
      <path
        d="M11 22 L11 10 L13.6 10 L20.4 19 L20.4 10 L23 10 L23 22 L20.4 22 L13.6 13 L13.6 22 Z"
        fill={`url(#${gradId})`}
      />
      {/* orbit dot */}
      <circle cx="26" cy="6" r="1.6" fill="#c084fc" filter="url(#natasha-glow)" />
    </svg>
  );
}
