import assert from "node:assert/strict";
import { test } from "node:test";
import { coordinates, forecastUrl, normalizeForecast } from "./weather.ts";

const now = Date.parse("2026-10-17T12:15:00Z");
function payload() {
  return {
    current_units: { temperature_2m: "°C", rain: "mm", showers: "mm", precipitation: "mm", wind_speed_10m: "km/h" },
    current: { time: now / 1000, temperature_2m: 12.5, rain: 0, showers: 0, precipitation: 0, cloud_cover: 35, wind_speed_10m: 14, is_day: 1, weather_code: 2 },
    hourly_units: { precipitation_probability: "%" },
    hourly: { time: [now / 1000 - 900, now / 1000 + 2700], precipitation_probability: [10, 70] },
    daily: { sunrise: [Date.parse("2026-10-17T06:10:00Z") / 1000], sunset: [Date.parse("2026-10-17T16:45:00Z") / 1000] },
  };
}

test("normalizes zero rain, next-hour chance, and timezone-safe sun events", () => {
  const result = normalizeForecast(payload(), now);
  assert.equal(result.state.rain, 0);
  assert.equal(result.state.rain_probability, 70);
  assert.equal(result.state.is_day, true);
  assert.equal(result.observed_at, "2026-10-17T12:15:00.000Z");
  assert.equal(result.sun_events["2026-10-17"].sunset, "2026-10-17T16:45:00.000Z");
});

test("missing rain and unknown daylight remain unknown", () => {
  const data = payload();
  Object.assign(data.current, { rain: null, is_day: null });
  const result = normalizeForecast(data, now);
  assert.equal(result.state.rain, null);
  assert.equal(result.state.is_day, null);
});

test("rain includes showers, and missing showers do not become zero", () => {
  const data = payload();
  data.current.showers = 0.4;
  assert.equal(normalizeForecast(data, now).state.rain, 0.4);
  Object.assign(data.current, { showers: null });
  assert.equal(normalizeForecast(data, now).state.rain, null);
});

test("rejects stale, future and missing readings instead of making up defaults", () => {
  assert.throws(() => normalizeForecast(payload(), now + 46 * 60_000), /stale/);
  assert.throws(() => normalizeForecast(payload(), now - 6 * 60_000), /stale/);
  const data = payload();
  Object.assign(data.current, { temperature_2m: null });
  assert.throws(() => normalizeForecast(data, now), /temperature is missing/);
});

test("rejects wrong units or absent sun events", () => {
  const wrong = payload();
  wrong.current_units.wind_speed_10m = "mph";
  assert.throws(() => normalizeForecast(wrong, now), /units/);
  const noSun = payload();
  noSun.daily.sunrise = [];
  assert.throws(() => normalizeForecast(noSun, now), /Sunrise/);
});

test("postcode geocoding validates both the postcode and Dutch coordinates", () => {
  const response = { response: { docs: [{ postcode: "1011 AB", centroide_ll: "POINT(4.9 52.37)" }] } };
  assert.deepEqual(coordinates(response, "1011 AB"), { latitude: 52.37, longitude: 4.9 });
  assert.throws(() => coordinates(response, "1000AA"), /could not be located/);
  response.response.docs[0].centroide_ll = "POINT(99 99)";
  assert.throws(() => coordinates(response, "1011 AB"), /Invalid postcode/);
});

test("requests Celsius, mm, km/h and Amsterdam time explicitly", () => {
  const url = new URL(forecastUrl(52.37, 4.9));
  assert.equal(url.hostname, "api.open-meteo.com");
  assert.equal(url.searchParams.get("timezone"), "Europe/Amsterdam");
  assert.equal(url.searchParams.get("wind_speed_unit"), "kmh");
  assert.equal(url.searchParams.get("timeformat"), "unixtime");
});
