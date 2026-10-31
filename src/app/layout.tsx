import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  weight: ["500", "600", "700", "800"],
  display: "swap",
});

const description =
  "J*B is your personal AI career agent. It tailors your LaTeX resume to every role, prepares each application, and submits only with your approval.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "https://jasteriskb.com"),
  title: { default: "J*B — Your career. On autopilot.", template: "%s · J*B" },
  description,
  applicationName: "J*B",
  openGraph: {
    type: "website",
    siteName: "J*B",
    url: "/",
    title: "J*B — Your career. On autopilot.",
    description,
  },
  twitter: {
    card: "summary_large_image",
    title: "J*B — Your career. On autopilot.",
    description,
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#06B6B4" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable}`}>
      <body>{children}</body>
    </html>
  );
}
