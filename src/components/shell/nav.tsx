"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navItems } from "@/components/shell/nav-items";
import { cn } from "@/components/ui/cn";

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function Icon({ path, className }: { path: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={path} />
    </svg>
  );
}

/** Desktop: a fixed left rail. Hidden below `lg`. */
export function SideRail() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="hidden lg:flex lg:w-56 lg:shrink-0 lg:flex-col lg:gap-1">
      {navItems.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 border-l-2 px-3 py-2 text-sm transition-colors",
              active
                ? "border-accent bg-surface-raised/70 text-ink"
                : "border-transparent text-ink-muted hover:border-line-bright hover:text-ink",
            )}
          >
            <Icon path={item.icon} className={cn("h-4 w-4", active ? "text-accent" : "text-ink-faint")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Mobile: a bottom tab bar.
 *
 * Bottom rather than top because this is built to be used one-handed on a
 * phone, and `pb-[env(safe-area-inset-bottom)]` keeps it clear of the home
 * indicator when installed to the home screen.
 */
export function BottomTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-void/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="flex">
        {navItems.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 text-[10px] tracking-wide transition-colors",
                  active ? "text-accent" : "text-ink-faint",
                )}
              >
                <Icon path={item.icon} className="h-[18px] w-[18px]" />
                {item.short}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
