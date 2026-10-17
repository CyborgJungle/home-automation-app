import { createClient } from "@supabase/supabase-js";
import { supabaseKey, supabaseUrl } from "@/lib/supabase";

// Called daily by Vercel Cron (see vercel.json) so the free Supabase project
// never counts as inactive, even when nobody is home and the Pi is off.
export async function GET() {
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const { data, error } = await supabase.rpc("keepalive");
  return Response.json(error ? { ok: false, error: error.message } : { ok: true, pinged_at: data }, {
    status: error ? 502 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
