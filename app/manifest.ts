import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "JARVIS",
    short_name: "JARVIS",
    description: "Personal executive operating system",
    start_url: "/",
    display: "standalone",
    background_color: "#02080d",
    theme_color: "#00e5ff",
    icons: [],
  };
}
