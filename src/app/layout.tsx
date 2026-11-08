import type { Metadata, Viewport } from "next";
import { Caveat, Figtree, Fraunces } from "next/font/google";
import "./globals.css";

const body = Figtree({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const heading = Fraunces({ subsets: ["latin"], variable: "--font-heading", display: "swap", axes: ["SOFT", "opsz"] });
const hand = Caveat({ subsets: ["latin"], variable: "--font-handwriting", display: "swap", weight: ["600", "700"] });

export const metadata: Metadata = {
  title: { default: "RoomSync", template: "%s · RoomSync" },
  description: "Chores, errands, shopping, expenses and schedules for roommates.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#f4efe4", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${heading.variable} ${hand.variable}`}>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
