// What the app knows about each kind of device: how to group, colour and
// describe it, what a tap does, and which triggers and actions the
// automation builder offers for it.

import type { Command, Device } from "@/lib/supabase";

export type Tone = "yellow" | "peach" | "pink" | "sage" | "lavender" | "mint" | "sky" | "sand";

export type IconName =
  | "bulb"
  | "group"
  | "plug"
  | "blind"
  | "thermo"
  | "flame"
  | "tv"
  | "speaker"
  | "bell"
  | "sensor"
  | "remote";

type State = Record<string, unknown>;

export const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Integrations that need the Raspberry Pi to be online.
export const ON_PI: Device["integration"][] = ["tradfri", "eufy", "brel", "bravia", "sonos", "apple"];

export const CATEGORIES: { id: string; title: string; kinds: string[]; tone: Tone }[] = [
  { id: "climate", title: "Climate", kinds: ["zone", "heating"], tone: "peach" },
  { id: "lights", title: "Lights", kinds: ["group", "light"], tone: "yellow" },
  { id: "plugs", title: "Plugs", kinds: ["plug"], tone: "mint" },
  { id: "blinds", title: "Blinds", kinds: ["blind"], tone: "lavender" },
  { id: "media", title: "Media", kinds: ["tv", "speaker"], tone: "pink" },
  { id: "doorbell", title: "Doorbell", kinds: ["doorbell"], tone: "sage" },
  { id: "sensors", title: "Sensors & remotes", kinds: ["sensor", "remote"], tone: "sky" },
];

export const KIND_LABELS: Record<string, string> = {
  light: "light",
  group: "room lights",
  plug: "plug",
  blind: "blind",
  zone: "heating",
  heating: "heating system",
  tv: "TV",
  speaker: "speaker",
  doorbell: "doorbell",
};

export const lowBattery = (s: State) => num(s.battery) !== null && num(s.battery)! <= 15;

export const toneOf = (d: Device): Tone => CATEGORIES.find((c) => c.kinds.includes(d.kind))?.tone ?? "sand";

export function iconOf(d: Device): IconName {
  switch (d.kind) {
    case "light":
      return "bulb";
    case "group":
      return "group";
    case "plug":
      return "plug";
    case "blind":
      return "blind";
    case "zone":
      return "thermo";
    case "heating":
      return "flame";
    case "tv":
      return "tv";
    case "speaker":
      return "speaker";
    case "doorbell":
      return "bell";
    case "remote":
      return "remote";
    default:
      return "sensor";
  }
}

// Commands still waiting for the Pi. The agent drops anything older than two
// minutes, so an older one that never got an update isn't really in flight.
const OPEN_MS = 2 * 60_000;
export const isOpen = (c: Command) =>
  (c.status === "pending" || c.status === "running") && Date.now() - Date.parse(c.created_at) < OPEN_MS;

// A finished command keeps showing until the device reports its new state,
// so values don't flick back to the old ones in between.
const SETTLE_MS = 10_000;

function stillLanding(c: Command, d: Device) {
  if (isOpen(c)) return true;
  if (c.status !== "done" || !c.completed_at) return false;
  const done = Date.parse(c.completed_at);
  return done >= Date.parse(d.updated_at) && Date.now() - done < SETTLE_MS;
}

// State as it will be once the user's commands land, so taps feel instant.
export function displayState(d: Device, commands: Command[]): State {
  const pending = commands.filter((c) => c.device_id === d.id && stillLanding(c, d)).sort((a, b) => a.id - b.id);
  let state: State = { ...d.state };
  for (const c of pending) {
    const p = c.params as State;
    if (c.action === "set") state = { ...state, ...p };
    else if (c.action === "power") state.on = p.on;
    else if (c.action === "mute") state.muted = p.on;
    else if (c.action === "play" || c.action === "favorite") state.playing = true;
    else if (c.action === "pause") state.playing = false;
    else if (c.action === "volume" && p.volume != null) state.volume = p.volume;
    else if (c.action === "set_temperature") state.setpoint = p.setpoint;
    else if (c.action === "set_mode") state.mode = p.mode;
    else if (c.action === "open") state.position = 0;
    else if (c.action === "close") state.position = 100;
  }
  return state;
}

// "Active" tiles are filled with their colour.
export function isActive(d: Device, s: State) {
  switch (d.kind) {
    case "light":
    case "plug":
    case "group":
    case "tv":
      return Boolean(s.on);
    case "blind":
      return num(s.position) !== null && num(s.position)! < 100;
    case "zone":
      return num(s.temperature) !== null && num(s.setpoint) !== null && num(s.temperature)! < num(s.setpoint)!;
    case "heating":
      return s.mode !== "HeatingOff";
    case "speaker":
      return Boolean(s.playing);
    default:
      return false;
  }
}

const MODES: Record<string, string> = {
  Auto: "Schedule",
  AutoWithEco: "Eco",
  Away: "Away",
  DayOff: "Day off",
  HeatingOff: "Off",
  Custom: "Custom",
};
export const modeLabel = (m: unknown) => MODES[String(m)] ?? String(m ?? "unknown");

export function describe(d: Device, s: State): string {
  if (!d.online) return "Unreachable";
  switch (d.kind) {
    case "light":
    case "group": {
      if (!s.on) return d.kind === "group" ? `Off · ${s.lights ?? 0} lights` : "Off";
      const b = num(s.brightness);
      return b !== null ? `On · ${b}%` : "On";
    }
    case "plug":
      return s.on ? "On" : "Off";
    case "zone":
      return num(s.setpoint) !== null ? `Set to ${s.setpoint}°` : "";
    case "heating":
      return `Mode: ${modeLabel(s.mode)}`;
    case "blind": {
      const p = num(s.position);
      if (s.moving) return "Moving…";
      if (p === null) return "Position unknown";
      return p === 0 ? "Open" : p === 100 ? "Closed" : `${100 - p}% open`;
    }
    case "tv": {
      // Sony reports its input in `playing`; Apple TV reports the app.
      const what = s.app ?? (typeof s.playing === "string" ? s.playing : null);
      return s.on ? ["On", what].filter(Boolean).join(" · ") : "Standby";
    }
    case "speaker": {
      const what = s.title ? [s.title, s.artist].filter(Boolean).join(" — ") : s.source;
      return [s.playing ? "Playing" : "Paused", what].filter(Boolean).join(" · ");
    }
    case "doorbell":
      return s.last_ring_at ? `Rang ${new Date(String(s.last_ring_at)).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : "No rings yet";
    default:
      return num(s.battery) !== null ? `Battery ${s.battery}%` : "";
  }
}

// A quick tap toggles these; everything else opens the detail sheet.
export function tapAction(d: Device, s: State): { action: string; params: State } | null {
  if (!d.online) return null;
  if (d.kind === "light" || d.kind === "plug" || d.kind === "group") return { action: "set", params: { on: !s.on } };
  if (d.kind === "tv") return { action: "power", params: { on: !s.on } };
  if (d.kind === "speaker") return { action: s.playing ? "pause" : "play", params: {} };
  return null;
}

// ---------------------------------------------------------------------------
// Automation builder catalog
// ---------------------------------------------------------------------------

export type NumberInput = { min: number; max: number; step: number; unit: string; default: number };

export type TriggerOption = {
  id: string;
  label: string; // "turns on"
  key: string;
  op: "eq" | "ne" | "lt" | "gt";
  value?: unknown;
  number?: NumberInput;
};

export function triggerOptions(d: Device): TriggerOption[] {
  switch (d.kind) {
    case "light":
    case "plug":
    case "group":
    case "tv":
      return [
        { id: "on", label: "turns on", key: "on", op: "eq", value: true },
        { id: "off", label: "turns off", key: "on", op: "eq", value: false },
      ];
    case "speaker":
      return [
        { id: "playing", label: "starts playing", key: "playing", op: "eq", value: true },
        { id: "stopped", label: "stops playing", key: "playing", op: "eq", value: false },
      ];
    case "zone":
      return [
        { id: "below", label: "drops below", key: "temperature", op: "lt", number: { min: 5, max: 30, step: 0.5, unit: "°C", default: 19 } },
        { id: "above", label: "rises above", key: "temperature", op: "gt", number: { min: 5, max: 30, step: 0.5, unit: "°C", default: 22 } },
      ];
    case "blind":
      return [
        { id: "opened", label: "opens fully", key: "position", op: "eq", value: 0 },
        { id: "closed", label: "closes fully", key: "position", op: "eq", value: 100 },
      ];
    // The IKEA gateway doesn't pass on motion or button presses, only battery.
    case "sensor":
    case "remote":
    case "doorbell":
      return [
        { id: "battery_low", label: "battery drops below", key: "battery", op: "lt", number: { min: 5, max: 50, step: 5, unit: "%", default: 15 } },
      ];
    default:
      return [];
  }
}

export type ActionOption = {
  id: string;
  label: string; // "Turn on"
  action: string;
  params: (n: number | null, choice: string | null) => State;
  number?: NumberInput;
  // Pick one from a (searchable) list, e.g. which app to open.
  choices?: { value: string; label: string }[];
};

const listOf = (v: unknown) => (Array.isArray(v) ? (v as { id: string; name?: string; title?: string }[]) : []);

export function actionOptions(d: Device): ActionOption[] {
  const fixed = (id: string, label: string, action: string, params: State = {}): ActionOption => ({
    id,
    label,
    action,
    params: () => params,
  });
  switch (d.kind) {
    case "light":
    case "group":
      return [
        fixed("on", "Turn on", "set", { on: true }),
        fixed("off", "Turn off", "set", { on: false }),
        {
          id: "brightness",
          label: "Set brightness",
          action: "set",
          params: (n) => ({ on: true, brightness: n }),
          number: { min: 1, max: 100, step: 1, unit: "%", default: 50 },
        },
      ];
    case "plug":
      return [fixed("on", "Turn on", "set", { on: true }), fixed("off", "Turn off", "set", { on: false })];
    case "blind":
      if (d.integration === "brel") {
        return [
          fixed("open", "Open", "open"),
          fixed("close", "Close", "close"),
          fixed("stop", "Stop", "stop"),
          {
            id: "position",
            label: "Open to",
            action: "set",
            params: (n) => ({ position: 100 - (n ?? 0) }),
            number: { min: 0, max: 100, step: 5, unit: "% open", default: 50 },
          },
        ];
      }
      return [fixed("open", "Open", "set", { position: 0 }), fixed("close", "Close", "set", { position: 100 })];
    case "zone":
      return [
        {
          id: "temp_1h",
          label: "Heat to (1 hour)",
          action: "set_temperature",
          params: (n) => ({ setpoint: n, minutes: 60 }),
          number: { min: 5, max: 30, step: 0.5, unit: "°C", default: 20 },
        },
        {
          id: "temp",
          label: "Heat to (until changed)",
          action: "set_temperature",
          params: (n) => ({ setpoint: n }),
          number: { min: 5, max: 30, step: 0.5, unit: "°C", default: 20 },
        },
        fixed("schedule", "Resume schedule", "follow_schedule"),
      ];
    case "heating":
      return [
        fixed("auto", "Mode: Schedule", "set_mode", { mode: "Auto" }),
        fixed("eco", "Mode: Eco", "set_mode", { mode: "AutoWithEco" }),
        fixed("away", "Mode: Away", "set_mode", { mode: "Away" }),
        fixed("off", "Mode: Off", "set_mode", { mode: "HeatingOff" }),
      ];
    case "speaker": {
      const favorites = listOf(d.state.favorites);
      return [
        fixed("play", "Play", "play"),
        fixed("pause", "Pause", "pause"),
        fixed("next", "Next track", "next"),
        {
          id: "volume",
          label: "Set volume",
          action: "volume",
          params: (n) => ({ volume: n }),
          number: { min: 0, max: 100, step: 5, unit: "%", default: 25 },
        },
        fixed("mute", "Mute", "mute", { on: true }),
        fixed("unmute", "Unmute", "mute", { on: false }),
        ...(favorites.length
          ? [
              {
                id: "favorite",
                label: "Play a favourite",
                action: "favorite",
                params: (_: number | null, choice: string | null) => ({
                  id: choice,
                  title: favorites.find((f) => f.id === choice)?.title,
                }),
                choices: favorites.map((f) => ({ value: f.id, label: f.title ?? f.id })),
              },
            ]
          : []),
      ];
    }
    case "tv": {
      if (d.integration === "apple") {
        const apps = listOf(d.state.apps);
        return [
          fixed("on", "Turn on", "power", { on: true }),
          fixed("off", "Turn off", "power", { on: false }),
          fixed("play", "Play", "play"),
          fixed("pause", "Pause", "pause"),
          ...(apps.length
            ? [
                {
                  id: "app",
                  label: "Open an app",
                  action: "app",
                  params: (_: number | null, choice: string | null) => ({ id: choice }),
                  choices: apps.map((a) => ({ value: a.id, label: a.name ?? a.id })),
                },
              ]
            : []),
        ];
      }
      return [
        fixed("on", "Turn on", "power", { on: true }),
        fixed("off", "Turn off", "power", { on: false }),
        fixed("mute", "Mute", "mute", { on: true }),
        fixed("unmute", "Unmute", "mute", { on: false }),
      ];
    }
    default:
      return [];
  }
}

// Devices that can appear in the builder.
export const canTrigger = (d: Device) => triggerOptions(d).length > 0;
export const canAct = (d: Device) => actionOptions(d).length > 0;
