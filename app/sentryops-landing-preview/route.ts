// Original compiled PUBLIC SentryOps homepage, pinned to an immutable verified
// prototype deployment, with exact public JS/CSS assets bundled in JARVIS.
// This route serves standalone HTML, not the JARVIS app
// layout: the iframe must not mount JARVIS controls, cloud sync or voice twice.
// No authenticated prototype routes are proxied or made less restricted.
export const runtime = "nodejs";

const ORIGIN = "https://sentryops-prototype-co845i4oz-dwights-projects-8a9a094f.vercel.app";
const PUBLIC_INDEX_HTML = "<!doctype html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"UTF-8\" />\n    <link rel=\"icon\" type=\"image/svg+xml\" href=\"/vite.svg\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n    <title>sentryops-prototype</title>\n    <script>\n      (function () {\n        var saved = localStorage.getItem('theme');\n        var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;\n        var apply = saved === 'dark' || (!saved && prefersDark) || (saved === 'auto' && prefersDark);\n        if (apply) document.documentElement.classList.add('dark');\n      })();\n    </script>\n    <script type=\"module\" crossorigin src=\"/assets/index-6IVbJnN-.js\"></script>\n    <link rel=\"stylesheet\" crossorigin href=\"/assets/index-DoDyeJAG.css\">\n  </head>\n  <body>\n    <div id=\"root\"></div>\n  </body>\n</html>\n";

export async function GET() {
  const html = PUBLIC_INDEX_HTML
    .replace(/(src|href)="\/(?!\/)([^"]+)"/g, (_, attr: string, path: string) =>
      attr + '="' + (path.startsWith("assets/") ? "/sentryops-preview/" + path : ORIGIN + "/" + path) + '"')
    .replace(
      '<script type="module"',
      `<script>
        // This isolated frame uses the public React Router "/" landing route.
        // It does not navigate the parent JARVIS window.
        history.replaceState(null, "", "/");
        document.addEventListener("click", function(event) {
          const target = event.target;
          const link = target && target.closest ? target.closest("a[href]") : null;
          if (link && new URL(link.href).pathname === "/signin") {
            event.preventDefault();
            event.stopImmediatePropagation();
            window.open("https://sentryops-prototype-co845i4oz-dwights-projects-8a9a094f.vercel.app/signin", "_blank", "noopener,noreferrer");
          }
        }, true);
      </script><script type="module"`
    );

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
      "Content-Security-Policy": "frame-ancestors 'self'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
