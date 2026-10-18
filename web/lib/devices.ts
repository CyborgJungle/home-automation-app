// What the app knows about each kind of device: how to group, colour and
// describe it, what a tap does, and which triggers and actions the
// automation builder offers for it.

import { LAMP_COLORS, WHITES } from "@/lib/colors";
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
export const ON_PI: Device["integration"][] = ["app", "dirigera", "tradfri", "eufy", "brel", "bravia", "sonos", "apple"];

export const CATEGORIES: { id: string; title: string; kinds: string[]; tone: Tone }[] = [
  { id: "lights", title: "Lights", kinds: ["group", "light"], tone: "yellow" },
  { id: "climate", title: "Climate", kinds: ["zone", "heating"], tone: "peach" },
  { id: "blinds", title: "Blinds", kinds: ["blind"], tone: "lavender" },
  { id: "media", title: "Media", kinds: ["tv", "speaker"], tone: "pink" },
  { id: "plugs", title: "Plugs", kinds: ["plug"], tone: "mint" },
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
    else if (c.action === "floor_target") state.floor = { ...floorOf(state), enabled: true, target: p.target };
    else if (c.action === "floor_off") state.floor = { ...floorOf(state), enabled: false };
    else if (c.action === "set_temperature") state.setpoint = p.setpoint;
    else if (c.action === "set_mode") state.mode = p.mode;
    else if (c.action === "open") state.position = 0;
    else if (c.action === "close") state.position = 100;
  }
  return state;
}

// The floor-heating thermostat riding on the living-room zone (see lib/home.tsx).
export type FloorState = { enabled: boolean; target: number; heating: boolean };
export const floorOf = (s: State) => (s.floor && typeof s.floor === "object" ? (s.floor as FloorState) : null);

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
    case "zone": {
      const floor = floorOf(s);
      if (floor) return floor.enabled && floor.heating;
      if (s.floor_helper) return false;
      return num(s.temperature) !== null && num(s.setpoint) !== null && num(s.temperature)! < num(s.setpoint)!;
    }
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
    case "zone": {
      const floor = floorOf(s);
      if (floor) return floor.enabled ? `Floor ${floor.heating ? "heating" : "idle"} · ${floor.target}°` : "Floor heating off";
      if (s.floor_helper) return "Boiler switch for the floor";
      return num(s.setpoint) !== null ? `Set to ${s.setpoint}°` : "";
    }
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
    case "sensor":
      if (typeof s.motion === "boolean") return s.motion ? "Motion" : "Clear";
      return num(s.battery) !== null ? `Battery ${s.battery}%` : "";
    default:
      return num(s.battery) !== null ? `Battery ${s.battery}%` : "";
  }
}

// Lamps, groups and plugs: their icon is the power button.
export const hasPower = (d: Device) => d.kind === "light" || d.kind === "group" || d.kind === "plug";

// The lamps in a group made in this app (not a hub's room).
export const membersOf = (d: Device): string[] =>
  d.integration === "app" && Array.isArray(d.state.members) ? (d.state.members as string[]) : [];

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
  // Fires on an event instead of a state change, e.g. a remote's button press.
  event?: string;
  pattern?: string;
};

const battery: TriggerOption = { id: "battery_low", label: "battery drops below", key: "battery", op: "lt", number: { min: 5, max: 50, step: 5, unit: "%", default: 15 } };
const press = (id: string, label: string, pattern: string): TriggerOption => ({ id, label, key: "", op: "eq", event: "button.press", pattern });

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
    // The old TRÅDFRI gateway only passed on battery levels; DIRIGERA also
    // reports motion and button presses.
    case "sensor":
      if (d.integration !== "dirigera") return [battery];
      return [
        { id: "motion", label: "detects motion", key: "motion", op: "eq", value: true },
        { id: "clear", label: "no longer detects motion", key: "motion", op: "eq", value: false },
        battery,
      ];
    case "remote":
      if (d.integration !== "dirigera") return [battery];
      return [press("press", "is pressed", "singlePress"), press("double", "is double-pressed", "doublePress"), press("long", "is held", "longPress"), battery];
    case "doorbell":
      return [battery];
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
  // Automations only: switch the device off again after `number` minutes.
  offAfter?: boolean;
};

const onFor: ActionOption = {
  id: "on_for",
  label: "Turn on for",
  action: "set",
  params: () => ({ on: true }),
  number: { min: 1, max: 240, step: 1, unit: " min", default: 5 },
  offAfter: true,
};

const listOf = (v: unknown) => (Array.isArray(v) ? (v as { id: string; name?: string; title?: string }[]) : []);

// "Set colour" for colour lamps, "Set white" for white-spectrum lamps.
function colourOptions(d: Device): ActionOption[] {
  const options: ActionOption[] = [];
  if (d.state.color) {
    options.push({
      id: "color",
      label: "Set colour",
      action: "set",
      params: (_, choice) => {
        const c = LAMP_COLORS.find((c) => c.id === choice) ?? LAMP_COLORS[0];
        return { on: true, hue: c.hue, saturation: c.saturation };
      },
      choices: LAMP_COLORS.map((c) => ({ value: c.id, label: c.label })),
    });
  }
  const warm = num(d.state.kelvin_warm);
  const cool = num(d.state.kelvin_cool);
  if (warm !== null && cool !== null) {
    options.push({
      id: "white",
      label: "Set white",
      action: "set",
      params: (_, choice) => {
        const k = (WHITES.find((w) => w.id === choice) ?? WHITES[0]).kelvin;
        return { on: true, color_temp: Math.max(warm, Math.min(cool, k)) };
      },
      choices: WHITES.map((w) => ({ value: w.id, label: w.label })),
    });
  }
  return options;
}

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
        onFor,
        fixed("off", "Turn off", "set", { on: false }),
        {
          id: "brightness",
          label: "Set brightness",
          action: "set",
          params: (n) => ({ on: true, brightness: n }),
          number: { min: 1, max: 100, step: 1, unit: "%", default: 50 },
        },
        ...colourOptions(d),
      ];
    case "plug":
      return [fixed("on", "Turn on", "set", { on: true }), onFor, fixed("off", "Turn off", "set", { on: false })];
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
      if (floorOf(d.state)) {
        return [
          {
            id: "floor_target",
            label: "Floor heating to",
            action: "floor_target",
            params: (n) => ({ target: n }),
            number: { min: 15, max: 25, step: 0.5, unit: "°C", default: 20 },
          },
        ];
      }
      // The helper zone belongs to the floor-heating thermostat; don't let scenes fight it.
      if (d.state.floor_helper) return [];
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
