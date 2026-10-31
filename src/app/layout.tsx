import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Waypoint — Your next chapter",
  description:
    "Your personal career agent. A thoughtful next step, from your story to your next opportunity.",
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
