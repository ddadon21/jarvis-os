# JARVIS OS

JARVIS is a personal executive operating system with four isolated domains: Trading, Finance, SentryOps, and Life.

## Current milestone: Core v0.1

- Iron-Man-inspired command-center UI
- Domain isolation and switching
- Interactive Jarvis chat via Vercel AI Gateway
- Mission / goals / event stream / next-move shell
- Installable PWA metadata
- No live financial or trading integrations yet

## Local development

```bash
npm install
npm run dev
```

On Vercel, the chat route uses the AI SDK with Vercel AI Gateway. If OIDC is not available for the deployment, configure an AI Gateway API key in project environment variables.
