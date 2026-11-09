import type { Metadata, Viewport } from "next";
import { Inter_Tight, Newsreader } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegistration } from "@/components/pwa";

const body = Inter_Tight({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const serif = Newsreader({ subsets: ["latin"], variable: "--font-serif", display: "swap", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: { default: "RoomSync", template: "%s · RoomSync" },
  description: "Chores, errands, shopping, expenses and schedules for roommates.",
  manifest: "/manifest.webmanifest",
  applicationName: "RoomSync",
  appleWebApp: { capable: true, title: "RoomSync", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#f6f3ec", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${serif.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
