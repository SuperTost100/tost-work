import type { CSSProperties } from "react";

// MingCute line icons, stored as SVG files and drawn as masks so they take the text colour.
const urls = import.meta.glob<string>("../assets/icons/*.svg", { query: "?url", import: "default", eager: true });

export type IconName = string;

export function Icon({
  name,
  size,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const url = urls[`../assets/icons/${name}.svg`];
  if (!url && import.meta.env.DEV) console.warn(`Missing icon: ${name}`);
  const mask = url ? `url("${url}")` : undefined;
  return (
    <span
      aria-hidden="true"
      className={className ? `ic ${className}` : "ic"}
      style={{ maskImage: mask, WebkitMaskImage: mask, ...(size ? { width: size, height: size } : {}), ...style }}
    />
  );
}
