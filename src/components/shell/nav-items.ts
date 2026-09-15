import type { Route } from "next";

/**
 * The navigation model.
 *
 * One entry per top-level surface named in the product spec. Kept as data so
 * the desktop rail and the mobile tab bar cannot drift apart.
 */
export interface NavItem {
  readonly href: Route;
  readonly label: string;
  readonly short: string;
  /** Inline SVG path data, drawn on a 24×24 grid. */
  readonly icon: string;
}

export const navItems: readonly NavItem[] = [
  {
    href: "/",
    label: "Mission",
    short: "Mission",
    icon: "M12 3v18M3 12h18M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
  },
  {
    href: "/goals",
    label: "Goals",
    short: "Goals",
    icon: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  },
  {
    href: "/trading",
    label: "Trading",
    short: "Trading",
    icon: "M3 17l5-6 4 3 6-8M21 6h-5M21 6v5",
  },
  {
    href: "/finance",
    label: "Finance",
    short: "Finance",
    icon: "M3 7h18v12H3zM3 11h18M7 15h4",
  },
  {
    href: "/sentryops",
    label: "SentryOps",
    short: "Sentry",
    icon: "M12 3l8 3v6c0 4.5-3.2 7.9-8 9-4.8-1.1-8-4.5-8-9V6z",
  },
  {
    href: "/life",
    label: "Life",
    short: "Life",
    icon: "M4 7h16v13H4zM8 3v4M16 3v4M4 11h16",
  },
  {
    href: "/ask",
    label: "Ask Jarvis",
    short: "Ask",
    icon: "M5 18l-2 3V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2z",
  },
];
