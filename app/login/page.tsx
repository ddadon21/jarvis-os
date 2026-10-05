"use client";

import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const params = useSearchParams();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!passcode || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Login failed.");
      const next = params.get("next");
      window.location.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/work");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={styles.card}>
      <div style={styles.mark}>J</div>
      <strong style={styles.title}>JARVIS // OWNER ACCESS</strong>
      <span style={styles.sub}>HIMIE JOHNSON VENTURES</span>
      <input
        type="password"
        autoComplete="current-password"
        autoFocus
        value={passcode}
        onChange={(event) => setPasscode(event.target.value)}
        placeholder="Owner passcode"
        aria-label="Owner passcode"
        style={styles.input}
      />
      <button type="submit" disabled={busy || !passcode} style={styles.button}>{busy ? "VERIFYING" : "ENTER"}</button>
      {error ? <p role="alert" style={styles.error}>{error}</p> : null}
    </form>
  );
}

export default function LoginPage() {
  return (
    <main style={styles.page}>
      <Suspense fallback={null}><LoginForm /></Suspense>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", display: "grid", placeItems: "center", padding: 16, background: "radial-gradient(circle at 50% 30%, rgba(183,31,38,.18), transparent 50%), #040506", color: "#eef1f2", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  card: { width: "min(360px, 100%)", display: "grid", gap: 12, justifyItems: "center", padding: "28px 22px", border: "1px solid rgba(183,31,38,.45)", background: "rgba(8,6,7,.92)", boxShadow: "0 0 40px rgba(183,31,38,.18)" },
  mark: { width: 54, height: 54, borderRadius: "50%", display: "grid", placeItems: "center", border: "2px solid #ff3b44", color: "#fff", fontWeight: 800, boxShadow: "0 0 24px rgba(255,59,68,.5)" },
  title: { fontSize: 13, letterSpacing: ".18em" },
  sub: { fontSize: 9, letterSpacing: ".16em", color: "#a5686d" },
  input: { width: "100%", height: 42, padding: "0 12px", background: "#050405", border: "1px solid rgba(183,31,38,.45)", color: "#fff", fontSize: 14, outline: "none" },
  button: { width: "100%", height: 40, border: "1px solid #b71f26", background: "rgba(183,31,38,.2)", color: "#fff", letterSpacing: ".16em", fontWeight: 700, cursor: "pointer" },
  error: { margin: 0, fontSize: 11, color: "#ff8a90" },
};
