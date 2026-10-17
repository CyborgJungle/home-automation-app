// Runs Honeywell evohome from Supabase, so heating doesn't depend on the Pi.
// Called by pg_cron every 5 minutes and by a trigger when an evohome command is
// queued (see migrations/20261017000400_evohome_cloud.sql).
//
// It needs no caller authentication: all it does is run commands that household
// members queued (RLS-protected) and refresh status at most once a minute.
//
// Secrets (Dashboard -> Edge Functions -> Secrets): EVOHOME_USERNAME, EVOHOME_PASSWORD,
// and optionally EVOHOME_HOST.

import { createClient } from "npm:@supabase/supabase-js@2";
import { AuthError, DEFAULT_HOST, Honeywell, type Location } from "./honeywell.ts";

const MIN_POLL_INTERVAL_MS = 60_000;
const MAX_COMMAND_AGE_MS = 2 * 60_000;
// A wrong password retried every 5 minutes can get the Honeywell account locked.
const AUTH_FAILURE_BACKOFF_MS = 30 * 60_000;

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function setStatus(ok: boolean, error: string | null = null) {
  await supabase
    .from("integration_status")
    .upsert({ name: "evohome", ok, error, updated_at: new Date().toISOString() });
}

async function finish(id: number, status: "done" | "failed", error: string | null = null) {
  await supabase
    .from("commands")
    .update({ status, error, completed_at: new Date().toISOString() })
    .eq("id", id);
}

async function runCommands(honeywell: Honeywell) {
  const { data: pending, error } = await supabase
    .from("commands")
    .select("*")
    .eq("status", "pending")
    .like("device_id", "evohome:%")
    .order("created_at")
    .limit(10);
  if (error) throw new Error(`Reading commands failed: ${error.message}`);

  let ran = 0;
  for (const cmd of pending) {
    // Claim it so overlapping runs (cron + trigger) can't both execute it.
    const { data: claimed } = await supabase
      .from("commands")
      .update({ status: "running" })
      .eq("id", cmd.id)
      .eq("status", "pending")
      .select("id");
    if (!claimed?.length) continue;

    if (Date.now() - Date.parse(cmd.created_at) > MAX_COMMAND_AGE_MS) {
      await finish(cmd.id, "failed", "Expired before it could be sent");
      continue;
    }
    try {
      await honeywell.execute(cmd.device_id, cmd.action, cmd.params ?? {});
      await finish(cmd.id, "done");
      ran++;
    } catch (e) {
      await finish(cmd.id, "failed", e instanceof Error ? e.message : String(e));
      if (e instanceof AuthError) throw e;
    }
  }
  return ran;
}

Deno.serve(async () => {
  const username = Deno.env.get("EVOHOME_USERNAME");
  const password = Deno.env.get("EVOHOME_PASSWORD");
  if (!username || !password) {
    await setStatus(false, "Add EVOHOME_USERNAME and EVOHOME_PASSWORD under Supabase → Edge Functions → Secrets");
    return Response.json({ ok: false, reason: "not configured" });
  }

  const { data: session } = await supabase.from("evohome_session").select("*").maybeSingle();

  if (session?.auth_failed_at && Date.now() - Date.parse(session.auth_failed_at) < AUTH_FAILURE_BACKOFF_MS) {
    return Response.json({ ok: false, reason: "waiting after a failed login" });
  }

  const honeywell = new Honeywell(
    username,
    password,
    Deno.env.get("EVOHOME_HOST") || DEFAULT_HOST,
    session?.access_token
      ? {
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          expiresAt: Date.parse(session.expires_at),
        }
      : null,
  );

  let locations: Location[] | null = session?.locations ?? null;
  let lastPollAt: string | null = session?.last_poll_at ?? null;
  let authFailedAt: string | null = null;
  let ran = 0;
  let polled = false;
  let error: string | null = null;

  try {
    ran = await runCommands(honeywell);

    const due = !lastPollAt || Date.now() - Date.parse(lastPollAt) > MIN_POLL_INTERVAL_MS;
    if (ran || due) {
      lastPollAt = new Date().toISOString();
      if (ran) await sleep(3_000); // let Honeywell apply the change before reading it back
      // Older cached setups lack the zone details; read the setup again once.
      if (!locations?.every((l) => l.zones)) locations = await honeywell.locations();
      for (const row of await honeywell.devices(locations)) {
        await supabase.from("devices").upsert({ ...row, updated_at: new Date().toISOString() });
      }
      polled = true;
    }
    await setStatus(true);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    if (e instanceof AuthError) authFailedAt = new Date().toISOString();
    await setStatus(false, authFailedAt ? `${error} (retrying in 30 min)` : error);
  }

  await supabase.from("evohome_session").upsert({
    id: 1,
    access_token: honeywell.token?.accessToken ?? null,
    refresh_token: honeywell.token?.refreshToken ?? null,
    expires_at: honeywell.token ? new Date(honeywell.token.expiresAt).toISOString() : null,
    locations,
    last_poll_at: lastPollAt,
    auth_failed_at: authFailedAt,
  });

  return Response.json({ ok: !error, commands: ran, polled, error });
});
