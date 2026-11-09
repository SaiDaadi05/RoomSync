import type { Metadata, Viewport } from "next";
import { DM_Sans, Inter_Tight, Newsreader } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegistration } from "@/components/pwa";

const body = DM_Sans({ subsets: ["latin"], variable: "--font-body", display: "swap" });
// Optional "Parchment" look (preview): warm ivory, serif headings. Off unless chosen with ?look=parchment.
const lookBody = Inter_Tight({ subsets: ["latin"], variable: "--font-look-body", display: "swap" });
const lookSerif = Newsreader({ subsets: ["latin"], variable: "--font-look-serif", display: "swap", style: ["normal", "italic"] });

// Runs before paint so the chosen look never flashes. ?look=parchment turns it on, ?look=default turns it off.
const lookScript = `try{var q=new URLSearchParams(location.search).get("look");if(q==="parchment"||q==="default")localStorage.setItem("rs-look",q);var l=localStorage.getItem("rs-look");if(l==="parchment")document.documentElement.dataset.look=l}catch(e){}`;

export const metadata: Metadata = {
  title: { default: "RoomSync", template: "%s · RoomSync" },
  description: "Chores, errands, shopping, expenses and schedules for roommates.",
  manifest: "/manifest.webmanifest",
  applicationName: "RoomSync",
  appleWebApp: { capable: true, title: "RoomSync", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#ffffff", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${lookBody.variable} ${lookSerif.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: lookScript }} />
      </head>
      <body className="min-h-dvh font-sans antialiased">
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
