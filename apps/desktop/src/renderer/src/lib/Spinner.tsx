/** A small arc that turns while something runs: a task in the sidebar, an install on its button. It stands still when the system asks for reduced motion. */
export function Spinner() {
  return (
    <svg className="spinner" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" opacity="0.25" />
      <path d="M8 2a6 6 0 0 1 6 6" />
    </svg>
  );
}
