// Called by pg_cron with a private bearer secret. Household clients only read
// the cached weather table; opening the app does not call the provider.
import { createClient } from "npm:@supabase/supabase-js@2";
import { coordinates, forecastUrl, normalizeForecast } from "./weather.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function getJson(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("Weather provider unavailable.");
  return await response.json();
}

Deno.serve(async (request: Request) => {
  const secret = Deno.env.get("WEATHER_CRON_SECRET");
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const { data: claimed, error: claimError } = await supabase.rpc("claim_weather_poll");
  if (claimError) return Response.json({ ok: false, error: "Weather poll unavailable." }, { status: 503 });
  if (!claimed) return Response.json({ ok: true, skipped: true });

  try {
    const { data: config, error } = await supabase.from("weather_config").select("*").eq("id", 1).single();
    if (error || !config) throw new Error("Weather location is not configured.");
    let { latitude, longitude } = config;
    if (latitude === null || longitude === null) {
      const url = new URL("https://api.pdok.nl/bzk/locatieserver/search/v3_1/free");
      url.search = new URLSearchParams({ q: config.postcode, fq: "type:postcode", rows: "1" }).toString();
      ({ latitude, longitude } = coordinates(await getJson(url.toString()), config.postcode));
      const { error: saveError } = await supabase.from("weather_config").update({ latitude, longitude }).eq("id", 1);
      if (saveError) throw new Error("Weather location could not be saved.");
    }
    const weather = normalizeForecast(await getJson(forecastUrl(latitude, longitude)));
    const { error: updateError } = await supabase.from("weather").update({
      ...weather, error: null, updated_at: new Date().toISOString(),
    }).eq("id", 1);
    if (updateError) throw new Error("Weather readings could not be saved.");
    return Response.json({ ok: true, observed_at: weather.observed_at });
  } catch (error) {
    // Fixed messages only: never log auth headers or raw upstream responses.
    const message = error instanceof Error && [
      "Weather provider unavailable.", "Weather location is not configured.",
      "The weather postcode could not be located.", "Invalid postcode coordinates.",
      "Weather location could not be saved.", "Weather readings could not be saved.",
      "Unexpected weather units.", "The weather provider returned stale readings.",
      "Weather temperature is missing.", "Sunrise and sunset are missing.",
    ].includes(error.message) ? error.message : "Weather refresh failed. Retrying on the next scheduled update.";
    await supabase.from("weather").update({ error: message }).eq("id", 1);
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
});
