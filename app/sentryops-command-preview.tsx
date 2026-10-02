"use client";

import { ArrowUpRight } from "lucide-react";

// Pinned public SentryOps marketing landing from src/pages/Landing.jsx, not the
// authenticated Command Dashboard. Same-origin rendering avoids blocked embeds.
const PUBLIC_HOMEPAGE = "https://sentryops-prototype-co845i4oz-dwights-projects-8a9a094f.vercel.app/";

export default function SentryOpsCommandPreview() {
  return (
    <section className="sentryops-demo" aria-label="SentryOps public landing page preview">
      <div className="sentryops-demo-header">
        <div>
          <span>SENTRYOPS / PUBLIC PROTOTYPE</span>
          <strong>HOMEPAGE</strong>
          <small>Original pre-sign-in landing source · scroll within the preview</small>
        </div>
        <a className="sentryops-demo-open" href={PUBLIC_HOMEPAGE} target="_blank" rel="noopener noreferrer">
          OPEN FULL SITE <ArrowUpRight size={12} aria-hidden="true" />
        </a>
      </div>
      <div className="sentryops-demo-viewport sentryops-landing-viewport">
        <iframe
          title="Actual SentryOps public marketing homepage before sign in"
          src="/sentryops-landing-preview"
          loading="eager"
          referrerPolicy="same-origin"
        />
      </div>
      <p className="sentryops-demo-note">
        The public homepage from the SentryOps prototype is rendered inside JARVIS;
        sign-in opens the separate SentryOps project. No protected dashboard is embedded.
      </p>
    </section>
  );
}
