import type { NumberInput } from "@/lib/devices";
import type { WeatherPredicate, WeatherSnapshot } from "@/lib/supabase";

export type WeatherOption = WeatherPredicate & {
  id: string;
  label: string;
  conditionLabel: string;
  number?: NumberInput;
};

export const WEATHER_OPTIONS: WeatherOption[] = [
  { id: "temperature_below", key: "temperature", op: "lt", value: 10, label: "Temperature drops below", conditionLabel: "Temperature is below", number: { min: -20, max: 45, step: 0.5, default: 10, unit: "°C" } },
  { id: "temperature_above", key: "temperature", op: "gt", value: 25, label: "Temperature rises above", conditionLabel: "Temperature is above", number: { min: -20, max: 45, step: 0.5, default: 25, unit: "°C" } },
  { id: "rain_starts", key: "rain", op: "gt", value: 0, label: "Rain starts", conditionLabel: "It is raining" },
  { id: "rain_stops", key: "rain", op: "eq", value: 0, label: "Rain stops", conditionLabel: "It is dry" },
  { id: "cloud_below", key: "cloud_cover", op: "lt", value: 30, label: "Cloud cover falls below", conditionLabel: "Cloud cover is below", number: { min: 0, max: 100, step: 5, default: 30, unit: "%" } },
  { id: "cloud_above", key: "cloud_cover", op: "gt", value: 70, label: "Cloud cover rises above", conditionLabel: "Cloud cover is above", number: { min: 0, max: 100, step: 5, default: 70, unit: "%" } },
  { id: "wind_above", key: "wind_speed", op: "gt", value: 40, label: "Wind rises above", conditionLabel: "Wind speed is above", number: { min: 0, max: 150, step: 5, default: 40, unit: " km/h" } },
  { id: "rain_chance_above", key: "rain_probability", op: "gt", value: 60, label: "Rain chance rises above", conditionLabel: "Next-hour rain chance is above", number: { min: 0, max: 100, step: 5, default: 60, unit: "%" } },
  { id: "rain_chance_below", key: "rain_probability", op: "lt", value: 20, label: "Rain chance falls below", conditionLabel: "Next-hour rain chance is below", number: { min: 0, max: 100, step: 5, default: 20, unit: "%" } },
  { id: "daylight", key: "is_day", op: "eq", value: true, label: "Daylight begins", conditionLabel: "It is daytime" },
  { id: "night", key: "is_day", op: "eq", value: false, label: "Night begins", conditionLabel: "It is nighttime" },
];

export const weatherOptionFor = (rule: WeatherPredicate) =>
  WEATHER_OPTIONS.find(o => o.id === rule.option) ?? WEATHER_OPTIONS.find(o => o.key === rule.key && o.op === rule.op && (o.number || o.value === rule.value));

export function weatherPredicate(optionId: string, value: number | null): WeatherPredicate | string {
  const option = WEATHER_OPTIONS.find(o => o.id === optionId);
  if (!option) return "Choose a weather condition.";
  const wanted = option.number ? value ?? option.number.default : option.value;
  if (option.number && (typeof wanted !== "number" || !Number.isFinite(wanted) || wanted < option.number.min || wanted > option.number.max)) return "Choose a weather threshold within the allowed range.";
  return { key: option.key, op: option.op, value: wanted, option: option.id };
}

export function describeWeather(rule: WeatherPredicate, condition = false) {
  const option = weatherOptionFor(rule);
  if (!option) return `${rule.key.replaceAll("_", " ")} ${rule.op} ${rule.value}`;
  return `${condition ? option.conditionLabel : option.label}${option.number ? ` ${rule.value}${option.number.unit}` : ""}`;
}

export function weatherIsFresh(weather: WeatherSnapshot | null, now = Date.now()) {
  if (!weather?.observed_at) return false;
  const observed = Date.parse(weather.observed_at);
  return Number.isFinite(observed) && now - observed <= 45 * 60_000 && observed - now <= 5 * 60_000;
}

export function weatherLabel(code: number | null) {
  if (code === null) return "Local weather";
  if (code === 0) return "Clear sky";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code < 50) return "Foggy";
  if (code < 60) return "Drizzle";
  if (code < 70) return "Rain";
  if (code < 80) return "Snow";
  if (code < 85) return "Rain showers";
  if (code < 90) return "Snow showers";
  return "Thunderstorms";
}
