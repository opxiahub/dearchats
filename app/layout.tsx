import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "DearChats — a private museum of a relationship",
  description: "Turn years of WhatsApp messages into a guided emotional walk.",
  icons: {
    icon: "/dearchats-logo.svg",
    shortcut: "/dearchats-logo.svg",
    apple: "/dearchats-logo.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#0E0C0A",
  width: "device-width",
  initialScale: 1,
  // Allow pinch-zoom for accessibility — locking it at 1 is an a11y antipattern
  // and trapped users on iOS Safari with no escape valve when the universe
  // canvas grabbed gestures. Page-level scaling is fine here.
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
