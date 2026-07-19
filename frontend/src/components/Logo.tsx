export function KhipuLogo({ size = 28 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" fill="none">
      <path d="M3 7 H29" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M9 7 C9 14, 8 20, 8.6 26" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M16 7 C16 14, 16 21, 16 27.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M23 7 C23 13, 24 20, 23.4 25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <ellipse cx="8.7" cy="14" rx="2.1" ry="1.5" fill="currentColor" transform="rotate(-12 8.7 14)" />
      <ellipse cx="16" cy="17.5" rx="2.2" ry="1.6" fill="currentColor" />
      <ellipse cx="23.4" cy="13" rx="2.1" ry="1.5" fill="currentColor" transform="rotate(10 23.4 13)" />
      <ellipse cx="16" cy="24" rx="1.8" ry="1.3" fill="currentColor" />
    </svg>
  );
}
