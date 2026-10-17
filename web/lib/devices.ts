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
  | "bell"
  | "sensor"
  | "remote";

type State = Record<string, unknown>;

export const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Integrations that need the Raspberry Pi to be online.
export const ON_PI: Device["integration"][] = ["tradfri", "eufy", "brel", "bravia"];

export const CATEGORIES: { id: string; title: string; kinds: string[]; tone: Tone }[] = [
  { id: "climate", title: "Climate", kinds: ["zone", "heating"], tone: "peach" },
  { id: "lights", title: "Lights", kinds: ["group", "light"], tone: "yellow" },
  { id: "plugs", title: "Plugs", kinds: ["plug"], tone: "mint" },
  { id: "blinds", title: "Blinds", kinds: ["blind"], tone: "lavender" },
  { id: "media", title: "Media", kinds: ["tv"], tone: "pink" },
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
    case "doorbell":
      return "bell";
    case "remote":
      return "remote";
    default:
      return "sensor";
  }
}

// A finished command keeps showing until the device reports its new state,
// so values don't flick back to the old ones in between.
const SETTLE_MS = 10_000;

function stillLanding(c: Command, d: Device) {
  if (c.status === "pending" || c.status === "running") return true;
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
    case "tv":
      return s.on ? ["On", s.playing].filter(Boolean).join(" · ") : "Standby";
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
  params: (n: number | null) => State;
  number?: NumberInput;
};

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
    case "tv":
      return [
        fixed("on", "Turn on", "power", { on: true }),
        fixed("off", "Turn off", "power", { on: false }),
        fixed("mute", "Mute", "mute", { on: true }),
        fixed("unmute", "Unmute", "mute", { on: false }),
      ];
    default:
      return [];
  }
}

// Devices that can appear in the builder.
export const canTrigger = (d: Device) => triggerOptions(d).length > 0;
export const canAct = (d: Device) => actionOptions(d).length > 0;
