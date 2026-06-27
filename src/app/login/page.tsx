"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get("code");
    if (code) {
      const supabase = createClient();
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (!error) router.replace("/");
      });
    }
  }, [searchParams, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
    }
    setLoading(false);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-navy px-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-2xl font-display font-bold text-off-white">
          Wooglin Cup Clubhouse
        </h1>
        <p className="mb-8 text-center text-sm text-hairline">
          Members only. Enter your email to sign in.
        </p>

        {sent ? (
          <div className="rounded-lg bg-parchment px-6 py-8 text-center">
            <p className="font-semibold text-navy">Check your email</p>
            <p className="mt-1 text-sm text-navy/70">
              We sent a sign-in link to <strong>{email}</strong>
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
