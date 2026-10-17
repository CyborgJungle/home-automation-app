import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseKey, supabaseUrl } from "@/lib/supabase";

// Google sends the browser back here (via Supabase) with a one-time code,
// which we swap for a session cookie.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  let error = params.get("error_description") ?? params.get("error");

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) =>
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
      },
    });
    const result = await supabase.auth.exchangeCodeForSession(code);
    if (!result.error) return NextResponse.redirect(new URL("/", request.url));
    error = result.error.message;
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("error", error ?? "Google sign-in failed");
  return NextResponse.redirect(login);
}
