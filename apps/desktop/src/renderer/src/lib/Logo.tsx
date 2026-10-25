/** The tost.one "T" mark, drawn in the current ink and canvas colours. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="var(--ink)" />
      <path d="M14 17h36v6H35v26h-6V23H14z" fill="var(--canvas)" />
    </svg>
  );
}
