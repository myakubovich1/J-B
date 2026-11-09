import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#06B6B4",
      }}
    >
      <svg width={104} height={104} viewBox="0 0 24 24">
        {[0, 60, 120].map((a) => (
          <rect
            key={a}
            x="9.75"
            y="1.5"
            width="4.5"
            height="21"
            rx="2.25"
            fill="#fff"
            transform={`rotate(${a} 12 12)`}
          />
        ))}
      </svg>
    </div>,
    size,
  );
}
