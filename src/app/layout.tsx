import type { Metadata, Viewport } from "next";
import { Playfair_Display, Lato } from "next/font/google";
import "./globals.css";

// Display serif for the clubhouse masthead + headings; clean sans for body.
const display = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-display",
});
const body = Lato({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "Wooglin Cup Clubhouse",
  description: "The official Wooglin Cup scoring and history app.",
  manifest: "/manifest.json",
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Wooglin Cup",
  },
};

export const viewport: Viewport = {
  themeColor: "#0C2D55",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="bg-off-white text-navy font-body antialiased">
        {children}
      </body>
    </html>
  );
}
