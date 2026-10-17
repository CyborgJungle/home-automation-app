"use client";

import { Icon } from "@/components/icons";
import { timeAgo } from "@/components/ui";
import { useHome } from "@/lib/home";
import { weatherIsFresh, weatherLabel } from "@/lib/weather";

const clock = (iso?: string) => iso ? new Date(iso).toLocaleTimeString("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit" }) : "—";
const reading = (value: number | null | undefined, unit: string) => value == null ? "—" : `${Math.round(value * 10) / 10}${unit}`;

export function WeatherSummary() {
  const { weather, weatherConfig } = useHome();
  const fresh = weatherIsFresh(weather);
  const state = weather?.state;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
  const sun = weather?.sun_events[today];

  return (
    <section className={`weather-card${fresh ? "" : " stale"}`} aria-label="Local weather">
      <div className="weather-top">
        <span className="weather-symbol"><Icon name={state?.weather_code === 0 ? "sun" : "cloud"} size={23} /></span>
        <div className="grow">
          <strong>{weatherConfig?.label ?? "Local weather"}</strong>
          <span>{fresh ? weatherLabel(state?.weather_code ?? null) : weather?.observed_at ? "Readings out of date" : "Weather updating…"}</span>
        </div>
        <strong className="weather-temperature">{fresh ? reading(state?.temperature, "°") : "—"}</strong>
      </div>
      {fresh && <div className="weather-details">
        <span>Rain {reading(state?.rain, " mm")}</span>
        <span>Next hour {reading(state?.rain_probability, "% rain")}</span>
        <span>Wind {reading(state?.wind_speed, " km/h")}</span>
        <span>Cloud {reading(state?.cloud_cover, "%")}</span>
        <span>Sunrise {clock(sun?.sunrise)} · Sunset {clock(sun?.sunset)}</span>
      </div>}
      <div className="weather-footer">
        <span>{weather?.observed_at ? `${timeAgo(weather.observed_at)} · ${weather.error ? "refresh delayed" : "area forecast"}` : "Fetching local conditions"}</span>
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>
      </div>
    </section>
  );
}
