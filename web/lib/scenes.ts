// Whether a scene is "on": every device in it looks the way the scene sets it.

import { displayState, floorOf, isOpen, num } from "@/lib/devices";
import type { Command, Device, SceneAction, Scene } from "@/lib/supabase";

type State = Record<string, unknown>;

const close = (a: unknown, b: unknown, margin: number) =>
  num(a) !== null && num(b) !== null && Math.abs(num(a)! - num(b)!) <= margin;

// null = this action can't be checked (e.g. "stop"), so it doesn't count either way.
function satisfied(a: SceneAction, s: State): boolean | null {
  const p = a.params as State;
  switch (a.action) {
    case "set":
      return Object.entries(p).every(([key, want]) => {
        if (key === "on") return Boolean(s.on) === Boolean(want);
        if (!(key in s)) return true; // e.g. room groups don't report brightness
        if (key === "brightness") return close(s.brightness, want, 3);
        if (key === "position") return close(s.position, want, 3);
        if (key === "hue") {
          const d = Math.abs((num(s.hue) ?? -999) - (num(want) ?? 0)) % 360;
          return s.color_mode !== "temperature" && Math.min(d, 360 - d) <= 4;
        }
        if (key === "saturation") return close(s.saturation, want, 4);
        if (key === "color_temp") return s.color_mode !== "color" && close(s.color_temp, want, 60);
        return s[key] === want;
      });
    case "power":
      return Boolean(s.on) === Boolean(p.on);
    case "mute":
      return Boolean(s.muted) === Boolean(p.on);
    case "play":
    case "favorite":
      return Boolean(s.playing);
    case "pause":
      return !s.playing;
    case "volume":
      return p.volume == null ? null : close(s.volume, p.volume, 2);
    case "open":
      return num(s.position) === 0;
    case "close":
      return num(s.position) === 100;
    case "set_temperature":
      return close(s.setpoint, p.setpoint, 0.1);
    case "set_mode":
      return s.mode === p.mode;
    case "floor_target":
      return Boolean(floorOf(s)?.enabled) && close(floorOf(s)?.target, p.target, 0.1);
    case "floor_off":
      return !floorOf(s)?.enabled;
    case "follow_schedule":
      return s.mode === "FollowSchedule";
    default:
      return null;
  }
}

// "Turn everything off" is on when nothing it would switch off is still on.
function everythingOff(devices: Device[], commands: Command[]) {
  return devices
    .filter((d) => d.online)
    .every((d) => {
      const s = displayState(d, commands);
      if (["light", "group", "plug", "tv"].includes(d.kind)) return !s.on;
      if (d.kind === "speaker") return !s.playing;
      if (floorOf(s)) return !floorOf(s)!.enabled;
      return true;
    });
}

export function sceneIsOn(scene: Scene, devices: Device[], commands: Command[]) {
  if (scene.kind === "all_off") return everythingOff(devices, commands);
  let checked = 0;
  for (const a of scene.actions) {
    const device = devices.find((d) => d.id === a.device_id);
    if (!device || !device.online) continue;
    const ok = satisfied(a, displayState(device, commands));
    if (ok === null) continue;
    if (!ok) return false;
    checked++;
  }
  return checked > 0;
}

export const scenePlaying = (scene: Scene, commands: Command[]) =>
  commands.some((c) => c.source === `scene:${scene.id}` && isOpen(c));
