import type { CSSProperties } from "react";

const cn = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

export const brand = {
  name: "J*B",
  domain: "jasteriskb.com",
  url: "https://jasteriskb.com",
  tagline: "Your personal AI career agent",
  teal: "#06B6B4",
  charcoal: "#0F172A",
} as const;

/** The J*B asterisk: six rounded arms. The brand mark, never a generic sparkle. */
export function Asterisk({
  size = 24,
  className,
  color = "currentColor",
  style,
}: {
  size?: number | string;
  className?: string;
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {[0, 60, 120].map((angle) => (
        <rect
          key={angle}
          x="9.75"
          y="1.5"
          width="4.5"
          height="21"
          rx="2.25"
          fill={color}
          transform={`rotate(${angle} 12 12)`}
        />
      ))}
    </svg>
  );
}

/** Wordmark: black J, teal asterisk, black B. Scales with font-size. */
export function Logo({
  size = 24,
  className,
  inverted = false,
}: {
  size?: number;
  className?: string;
  inverted?: boolean;
}) {
  return (
    <span
      className={cn("jb-logo", inverted && "jb-logo-inverted", className)}
      style={{ fontSize: size }}
      role="img"
      aria-label="J*B"
    >
      <span aria-hidden="true">J</span>
      <Asterisk className="jb-logo-star" size="0.62em" />
      <span aria-hidden="true">B</span>
    </span>
  );
}

/** Square app icon: white asterisk on a teal tile, matching the favicon. */
export function AppIcon({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn("jb-app-icon", className)}
      style={{ width: size, height: size, borderRadius: size * 0.27 }}
      aria-hidden="true"
    >
      <Asterisk size={size * 0.56} color="#fff" />
    </span>
  );
}
