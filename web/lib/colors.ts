// Lamp colours: the presets offered on the lamp screen, in scenes and in
// automations, and how to show a lamp's current colour on screen.

type State = Record<string, unknown>;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const LAMP_COLORS = [
  { id: "red", label: "Red", hue: 0, saturation: 100 },
  { id: "orange", label: "Orange", hue: 25, saturation: 100 },
  { id: "yellow", label: "Yellow", hue: 48, saturation: 100 },
  { id: "green", label: "Green", hue: 120, saturation: 100 },
  { id: "teal", label: "Teal", hue: 170, saturation: 100 },
  { id: "blue", label: "Blue", hue: 225, saturation: 100 },
  { id: "purple", label: "Purple", hue: 275, saturation: 100 },
  { id: "pink", label: "Pink", hue: 320, saturation: 100 },
  { id: "white", label: "White", hue: 30, saturation: 0 },
];

export const WHITES = [
  { id: "warm", label: "Warm white", kelvin: 2200 },
  { id: "neutral", label: "Neutral white", kelvin: 3000 },
  { id: "cool", label: "Cool white", kelvin: 4000 },
];

const hueDistance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

export function hueName(hue: number) {
  const colours = LAMP_COLORS.filter((c) => c.saturation > 0);
  return colours.reduce((best, c) => (hueDistance(c.hue, hue) < hueDistance(best.hue, hue) ? c : best)).label;
}

export function whiteName(kelvin: number) {
  return WHITES.reduce((best, w) => (Math.abs(w.kelvin - kelvin) < Math.abs(best.kelvin - kelvin) ? w : best)).label;
}

// Kelvin to an approximate screen colour, from candle orange to daylight blue.
export function kelvinCss(kelvin: number) {
  const t = Math.max(0, Math.min(1, (kelvin - 2200) / 1800));
  return `color-mix(in srgb, #ffb562 ${Math.round((1 - t) * 100)}%, #e4eeff)`;
}

export const colorCss = (hue: number, saturation: number) =>
  `hsl(${hue} ${Math.round(saturation * 0.95)}% ${Math.round(88 - saturation * 0.3)}%)`;

export const HUE_TRACK = `linear-gradient(to right, ${[0, 45, 90, 135, 180, 225, 270, 315, 359].map((h) => `hsl(${h} 90% 66%)`).join(", ")})`;
export const whiteTrack = (warm: number, cool: number) => `linear-gradient(to right, ${kelvinCss(warm)}, ${kelvinCss(cool)})`;

// What a lamp looks like right now, or null when it's off or plain white.
export function lampCss(s: State): string | null {
  if (!s.on) return null;
  const hue = num(s.hue);
  const sat = num(s.saturation);
  if (s.color_mode !== "temperature" && hue !== null && sat !== null) return colorCss(hue, sat);
  const k = num(s.color_temp);
  return k !== null && num(s.kelvin_warm) !== null ? kelvinCss(k) : null;
}

export function selectedColor(s: State) {
  const hue = num(s.hue);
  const sat = num(s.saturation);
  if (s.color_mode === "temperature" || hue === null || sat === null) return null;
  if (sat < 10) return "white";
  return LAMP_COLORS.find((c) => c.saturation > 0 && hueDistance(c.hue, hue) <= 8 && sat >= 80)?.id ?? null;
}
