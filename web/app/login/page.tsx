"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Blob } from "@/components/icons";
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
      <Blob size={88} tone="var(--pink)" look="right" />
      <h1 className="display">
        Welcome
        <br />
        home
      </h1>
      <p className="muted">Lights, heating, blinds and more, in one place.</p>
      <button type="button" className="pill big wide" onClick={signInWithGoogle} disabled={busy}>
        Continue with Google
      </button>
      <p className="divider">or with email</p>
      <input name="email" type="email" placeholder="Email" autoComplete="email" required />
      <input name="password" type="password" placeholder="Password" autoComplete="current-password" required />
      <button type="submit" className="pill light big wide" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      {(error ?? callbackError) && <p className="error">{error ?? callbackError}</p>}
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
