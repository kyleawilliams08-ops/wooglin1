"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0); // seconds until resend allowed
  const searchParams = useSearchParams();

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  useEffect(() => {
    const code = searchParams.get("code");
    if (code) {
      const supabase = createClient();
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        // Hard navigation so the fresh auth cookies reach the middleware —
        // client-side routing can reuse the cached pre-login redirect.
        if (!error) window.location.href = "/";
        else setError("That sign-in link didn't work — it may be expired, already used, or opened in a different browser than the one that requested it. Send a fresh link below.");
      });
    } else if (searchParams.get("error") === "auth") {
      setError("That sign-in link didn't work — it may be expired, already used, or opened in a different browser than the one that requested it. Send a fresh link below.");
    } else if (searchParams.get("error") === "unlinked") {
      setError("You're signed in, but this email isn't linked to a player profile yet. Tell the commissioner which email you used.");
    }
  }, [searchParams]);

  async function sendCode() {
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
    } else {
      setSent(true);
      setCode("");
      setResendIn(60); // Supabase allows roughly one OTP per email per minute
    }
    setLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await sendCode();
  }

  // Code entry works in ANY browser/PWA context — unlike the link, which
  // must be opened where it was requested (PKCE) and can be eaten by
  // email link scanners.
  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "email",
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      // Hard navigation (not router.replace) so the new session cookies are
      // sent with the request instead of hitting the cached login redirect.
      window.location.href = "/";
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-navy px-6">
      <div className="w-full max-w-sm">
        {/* Crest on a white badge so the navy dragon reads on the navy page */}
        <div className="mx-auto mb-5 flex h-24 w-24 items-center justify-center rounded-full bg-off-white ring-2 ring-gold/60 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/crest-small.png" alt="Wooglin Cup crest" width={80} height={80} />
        </div>
        <h1 className="mb-1 text-center text-2xl font-display font-bold text-off-white">
          Wooglin Cup Clubhouse
        </h1>
        <p className="mb-8 text-center text-sm text-hairline">
          Members only. Enter your email to sign in.
        </p>

        {sent ? (
          <div className="rounded-lg bg-parchment px-6 py-6 text-center space-y-4">
            <div>
              <p className="font-semibold text-navy">Check your email</p>
              <p className="mt-1 text-sm text-navy/70">
                We sent a sign-in link and a code to <strong>{email}</strong>
              </p>
            </div>
            <form onSubmit={handleVerifyCode} className="space-y-2">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={10}
                required
                placeholder="Sign-in code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full rounded-lg border border-hairline bg-off-white px-4 py-3 text-center text-lg tracking-[0.3em] text-navy placeholder:text-sm placeholder:tracking-normal placeholder:text-navy/40 focus:outline-none focus:ring-2 focus:ring-navy"
              />
              {error && <p className="text-sm text-usa-red">{error}</p>}
              <button
                type="submit"
                disabled={loading || code.trim().length < 6}
                className="w-full rounded-lg bg-navy px-4 py-3 font-semibold text-off-white disabled:opacity-50"
              >
                {loading ? "Signing in…" : "Sign in with code"}
              </button>
            </form>
            <button
              type="button"
              onClick={sendCode}
              disabled={loading || resendIn > 0}
              className="text-sm text-navy/60 underline underline-offset-2 disabled:no-underline disabled:text-navy/35"
            >
              {resendIn > 0 ? `Send a new code (${resendIn}s)` : "Send a new code"}
            </button>
            <p className="text-xs text-navy/50">
              On your phone or in the installed app? Use the code — the link only works in the browser that requested it.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="email"
              required
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-hairline bg-off-white px-4 py-3 text-navy placeholder:text-navy/40 focus:outline-none focus:ring-2 focus:ring-usa-red"
            />
            {error && <p className="text-sm text-usa-red">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-usa-red px-4 py-3 font-semibold text-off-white disabled:opacity-50 hover:bg-usa-red/90 transition-colors"
            >
              {loading ? "Sending…" : "Send sign-in link"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
