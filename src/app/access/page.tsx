"use client";

import { FormEvent, useState } from "react";

export default function AccessPage() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setLoading(true);
    try {
      const response = await fetch("/api/access", { method: "POST", body: new FormData(event.currentTarget) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Access could not be verified.");
      window.location.assign("/");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Access could not be verified."); setLoading(false);
    }
  }
  return <main className="access-page"><section className="access-card">
    <span className="brand-mark" aria-hidden="true">✦</span><span className="eyebrow">SERMON TRANSLATOR</span><h1>Welcome.</h1>
    <p>Enter the shared access code to open the live translator.</p>
    <form onSubmit={submit}><label htmlFor="password">Access code</label><input id="password" name="password" type="password" required autoFocus autoComplete="current-password"/><button className="toggle" disabled={loading}>{loading ? "Opening…" : "Open translator"}</button></form>
    {error && <p className="error" role="alert">{error}</p>}<footer>Nicole Han for Pastor Duncan &amp; Frances</footer>
  </section></main>;
}
