import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./personalization.css";
import "./theme-tuning.css";
import "./compact.css";
import "./jarvis-shell-controls.css";
import "./jarvis-presence.css";
import "./performance.css";
import "./side-rail-simplify.css";
import "./sentryops-demo.css";
import "./responsive-final.css";
import PwaRegister from "./pwa-register";
import JarvisVoiceProvider from "./jarvis-voice";
import JarvisCloudBridge from "./jarvis-cloud-bridge";
import ObsidianKnowledgeSync from "./obsidian-knowledge-sync";
import PerformanceGovernor from "./performance-governor";

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
        <PerformanceGovernor />
        <JarvisCloudBridge />
        <ObsidianKnowledgeSync />
        <JarvisVoiceProvider>{children}</JarvisVoiceProvider>
      </body>
    </html>
  );
}
