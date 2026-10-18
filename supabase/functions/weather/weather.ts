// Open-Meteo model data: never substitute zero for a missing measurement.
export type WeatherState = {
  temperature: number | null;
  rain: number | null;
  precipitation: number | null;
  cloud_cover: number | null;
  wind_speed: number | null;
  is_day: boolean | null;
  rain_probability: number | null;
  weather_code: number | null;
};

type ObjectValue = Record<string, unknown>;
const object = (v: unknown): ObjectValue => v && typeof v === "object" && !Array.isArray(v) ? v as ObjectValue : {};
const number = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;

export function coordinates(payload: unknown, postcode: string) {
  const response = object(object(payload).response);
  const docs = Array.isArray(response.docs) ? response.docs : [];
  const entry = docs.map(object).find(d => String(d.postcode).replace(/\s/g, "").toUpperCase() === postcode.replace(/\s/g, "").toUpperCase());
  const match = typeof entry?.centroide_ll === "string" && entry.centroide_ll.match(/^POINT\(([\d.-]+)\s+([\d.-]+)\)$/);
  if (!match) throw new Error("The weather postcode could not be located.");
  const longitude = number(Number(match[1]), 3, 8);
  const latitude = number(Number(match[2]), 50, 54);
  if (latitude === null || longitude === null) throw new Error("Invalid postcode coordinates.");
  return { latitude, longitude };
}

export function forecastUrl(latitude: number, longitude: number) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude),
    current: "temperature_2m,precipitation,rain,showers,cloud_cover,wind_speed_10m,is_day,weather_code",
    hourly: "precipitation_probability", daily: "sunrise,sunset",
    timezone: "Europe/Amsterdam", timeformat: "unixtime", forecast_days: "3",
    temperature_unit: "celsius", wind_speed_unit: "kmh", precipitation_unit: "mm",
  }).toString();
  return url.toString();
}

export function normalizeForecast(payload: unknown, now = Date.now()) {
  const data = object(payload);
  const current = object(data.current);
  const units = object(data.current_units);
  if (units.temperature_2m !== "°C" || units.rain !== "mm" || units.showers !== "mm" || units.wind_speed_10m !== "km/h") {
    throw new Error("Unexpected weather units.");
  }
  const timestamp = number(current.time, 0, 10_000_000_000);
  if (timestamp === null || now - timestamp * 1000 > 45 * 60_000 || timestamp * 1000 - now > 5 * 60_000) {
    throw new Error("The weather provider returned stale readings.");
  }
  const hourly = object(data.hourly);
  const times = Array.isArray(hourly.time) ? hourly.time : [];
  // Probability for the next forecast hour, distinct from measured rain now.
  const nextHour = times.findIndex(t => typeof t === "number" && t >= timestamp && t < timestamp + 3600);
  const probabilities = Array.isArray(hourly.precipitation_probability) ? hourly.precipitation_probability : [];
  const rain = number(current.rain, 0, 1000);
  const showers = number(current.showers, 0, 1000);
  const state: WeatherState = {
    temperature: number(current.temperature_2m, -90, 65),
    rain: rain === null || showers === null ? null : rain + showers,
    precipitation: units.precipitation === "mm" ? number(current.precipitation, 0, 1000) : null,
    cloud_cover: number(current.cloud_cover, 0, 100),
    wind_speed: number(current.wind_speed_10m, 0, 500),
    is_day: current.is_day === 1 ? true : current.is_day === 0 ? false : null,
    rain_probability: object(data.hourly_units).precipitation_probability === "%" ? number(probabilities[nextHour], 0, 100) : null,
    weather_code: number(current.weather_code, 0, 99),
  };
  if (state.temperature === null) throw new Error("Weather temperature is missing.");
  const daily = object(data.daily);
  const rises = Array.isArray(daily.sunrise) ? daily.sunrise : [];
  const sets = Array.isArray(daily.sunset) ? daily.sunset : [];
  const sunEvents: Record<string, { sunrise: string; sunset: string }> = {};
  for (let i = 0; i < rises.length; i++) {
    const rise = number(rises[i], 0, 10_000_000_000);
    const set = number(sets[i], 0, 10_000_000_000);
    if (rise === null || set === null || set <= rise) continue;
    const date = new Date(rise * 1000).toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
    sunEvents[date] = { sunrise: new Date(rise * 1000).toISOString(), sunset: new Date(set * 1000).toISOString() };
  }
  if (!Object.keys(sunEvents).length) throw new Error("Sunrise and sunset are missing.");
  return { state, observed_at: new Date(timestamp * 1000).toISOString(), sun_events: sunEvents };
}
