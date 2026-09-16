import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./personalization.css";
import "./theme-tuning.css";
import PwaRegister from "./pwa-register";

export const metadata: Metadata = {
  title: "JARVIS // Command Core",
  description: "Personal executive operating system",
  applicationName: "JARVIS",
  icons: {
    icon: [
      { url: "/jarvis-icon-192.svg", sizes: "192x192", type: "image/svg+xml" },
      { url: "/jarvis-icon-512.svg", sizes: "512x512", type: "image/svg+xml" },
    ],
    apple: "/jarvis-icon-192.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "JARVIS",
  },
};

export const viewport: Viewport = {
  themeColor: "#020305",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
