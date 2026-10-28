/** An on/off switch, drawn as the mockup's pill and read out as a switch. */
export function Switch({
  label,
  on,
  disabled,
  onChange,
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={on ? "switch on" : "switch"}
      disabled={disabled}
      onClick={() => onChange(!on)}
    />
  );
}
