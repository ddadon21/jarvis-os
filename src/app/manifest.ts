import type { MetadataRoute } from "next";

/** PWA manifest — the app is meant to live on the iPhone home screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "JARVIS",
    short_name: "JARVIS",
    description: "Persistent personal AI operating system.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#04060a",
    theme_color: "#04060a",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
