"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    <main>
      <form className="login" action={signIn}>
        <h1>Home</h1>
        <input name="email" type="email" placeholder="Email" autoComplete="email" required />
        <input name="password" type="password" placeholder="Password" autoComplete="current-password" required />
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {error && <p className="bad">{error}</p>}
      </form>
    </main>
  );
}
