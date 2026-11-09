import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "J*B — Your career. On autopilot.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const fonts = Promise.all([
  readFile(join(process.cwd(), "src/app/_og/plus-jakarta-sans-800.woff")),
  readFile(join(process.cwd(), "src/app/_og/inter-500.woff")),
]);

function Star({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      {[0, 60, 120].map((a) => (
        <rect
          key={a}
          x="9.75"
          y="1.5"
          width="4.5"
          height="21"
          rx="2.25"
          fill={color}
          transform={`rotate(${a} 12 12)`}
        />
      ))}
    </svg>
  );
}

export default async function Image() {
  const [jakarta, inter] = await fonts;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        background: "#F8FAFB",
        color: "#0F172A",
        fontFamily: "Inter",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "flex-start", fontFamily: "Jakarta", fontSize: 64 }}
      >
        J
        <div style={{ display: "flex", margin: "6px 4px 0" }}>
          <Star size={40} color="#06B6B4" />
        </div>
        B
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            fontFamily: "Jakarta",
            fontSize: 92,
            lineHeight: 1.02,
            letterSpacing: -3,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <span>Your career.</span>
          <span style={{ color: "#06B6B4" }}>On autopilot.</span>
        </div>
        <div style={{ fontSize: 32, color: "#475569", marginTop: 28 }}>
          Your personal AI career agent
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 24,
          color: "#64748B",
        }}
      >
        <span>jasteriskb.com</span>
        <div
          style={{ display: "flex", height: 8, width: 160, borderRadius: 4, background: "#06B6B4" }}
        />
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: "Jakarta", data: jakarta, style: "normal", weight: 800 },
        { name: "Inter", data: inter, style: "normal", weight: 500 },
      ],
    },
  );
}
