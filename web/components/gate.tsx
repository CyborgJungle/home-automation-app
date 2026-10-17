"use client";

import { Blob } from "@/components/icons";
import { useHome } from "@/lib/home";

// Loading and "not on the household list" screens.
export function Gate({ children }: { children: React.ReactNode }) {
  const { ready, member, userEmail, signOut } = useHome();

  if (!ready) {
    return (
      <main className="page center">
        <div className="bob">
          <Blob size={84} tone="var(--yellow)" look="up" />
        </div>
      </main>
    );
  }

  if (!member) {
    return (
      <main className="page center">
        <Blob size={96} tone="var(--pink)" look="left" />
        <h1 className="display">Not on the list yet</h1>
        <p className="muted">
          {userEmail ?? "This account"} isn&apos;t on the household list. Ask the owner to add it in Supabase.
        </p>
        <button className="pill" onClick={signOut}>
          Sign out
        </button>
      </main>
    );
  }

  return <>{children}</>;
}
