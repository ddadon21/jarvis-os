import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "JARVIS",
    short_name: "JARVIS",
    description: "Personal executive operating system",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    background_color: "#020305",
    theme_color: "#b71f26",
    icons: [
      {
        src: "/jarvis-icon-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/jarvis-icon-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
