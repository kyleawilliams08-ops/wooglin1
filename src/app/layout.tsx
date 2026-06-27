import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wooglin Cup Clubhouse",
  description: "The official Wooglin Cup scoring and history app.",
  manifest: "/manifest.json",
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
    <html lang="en">
      <body className="bg-off-white text-navy font-body antialiased">
        {children}
      </body>
    </html>
  );
}
