"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { createClient } from "@/lib/supabase";

function LoginForm() {
  const router = useRouter();
  // Set by /auth/callback when Google sign-in fails, e.g. an email that isn't on the household list.
  const callbackError = useSearchParams().get("error");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signInWithGoogle() {
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  async function signIn(formData: FormData) {
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({
      email: String(formData.get("email")),
      password: String(formData.get("password")),
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    } else {
      router.replace("/");
    }
  }

  return (
    <form className="login" action={signIn}>
      <h1>Home</h1>
      <button type="button" onClick={signInWithGoogle} disabled={busy}>
        Sign in with Google
      </button>
      <p className="muted">or with email</p>
      <input name="email" type="email" placeholder="Email" autoComplete="email" required />
      <input name="password" type="password" placeholder="Password" autoComplete="current-password" required />
      <button type="submit" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      {(error ?? callbackError) && <p className="bad">{error ?? callbackError}</p>}
    </form>
  );
}

export default function LoginPage() {
  return (
    <main>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
