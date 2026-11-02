/** the bullet mark of the landing page: a station tick, never a unicode glyph */
export function Tick({ className }: { className?: string }) {
  return (
    <svg width={12} height={12} viewBox="0 0 13 13" aria-hidden className={className}>
      <path
        d="M 2 7 L 5 10 L 11 3"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
