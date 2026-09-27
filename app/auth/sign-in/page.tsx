"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, ShieldCheck } from "@phosphor-icons/react";
import { authClient } from "@/components/auth-client";

export default function SignInPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signInWithGoogle() {
    setBusy(true);
    setError("");
    try {
      const requestedReturn = new URLSearchParams(window.location.search).get("returnTo");
      const returnTo = requestedReturn?.startsWith("/") && !requestedReturn.startsWith("//")
        ? requestedReturn
        : "/?view=overview";
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: `${window.location.origin}${returnTo}`,
      });
      if (result.error) setError(result.error.message || "Google sign-in could not start.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Google sign-in could not start.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-visual" aria-label="Ari interviewer portrait">
        <Image src="/ari-interviewer.png" alt="Ari, your thoughtful interview partner" fill priority sizes="(max-width: 760px) 100vw, 52vw" />
        <Link className="auth-visual-wordmark wordmark" href="/" aria-label="Ari home">Ari</Link>
        <div className="auth-visual-caption"><span>Thoughtful conversations.</span><span>Clearer decisions.</span><small>A calmer way to interview, practice, and grow.</small></div>
      </section>
      <section className="auth-panel" aria-labelledby="auth-heading">
        <div className="auth-panel-inner">
          <div className="auth-nav-bar">
            <Link className="auth-back-link" href="/">
              <ArrowLeft size={15} />
              <span>Back to workspace</span>
            </Link>
          </div>
          <div className="auth-card">
            <div className="auth-card-header">
              <span className="auth-eyebrow">Your Ari workspace</span>
              <h1 id="auth-heading">Welcome back</h1>
              <p>Sign in to save resumes, prepare for interviews, and manage your hiring workspace.</p>
            </div>
            <div className="auth-card-body">
              <button className="btn primary auth-google" type="button" onClick={() => void signInWithGoogle()} disabled={busy}>
                <svg className="google-mark" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z"/>
                  <path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.6-5.1c-1.8 1.2-4.1 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44Z"/>
                  <path fill="#FBBC05" d="M12.6 27.6a12 12 0 0 1 0-7.2v-5.3H5.8a20 20 0 0 0 0 17.8l6.8-5.3Z"/>
                  <path fill="#EA4335" d="M24 12c3 0 5.7 1 7.8 3.1l5.9-5.9C34.1 5.9 29.5 4 24 4A20 20 0 0 0 5.8 15.1l6.8 5.3C14.2 15.6 18.7 12 24 12Z"/>
                </svg>
                <span>{busy ? "Connecting to Google…" : "Continue with Google"}</span>
              </button>
              {error && <div role="alert" className="auth-error">{error}</div>}
              <div className="auth-privacy">
                <ShieldCheck size={16} />
                <span>Secure sign-in with Google. Ari never sees your password.</span>
              </div>
            </div>
            <div className="auth-card-footer">
              <span>By continuing, you agree to use Ari for interview workflows and candidate practice.</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
