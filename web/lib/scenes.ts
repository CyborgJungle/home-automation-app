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

export function sceneIsOn(scene: Scene, devices: Device[], commands: Command[]) {
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
