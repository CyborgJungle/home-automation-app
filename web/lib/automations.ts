// Plain-English summaries of automations, for the list and the builder.

import { actionOptions, triggerOptions } from "@/lib/devices";
import type { Automation, AutomationAction, AutomationTrigger, Device, Scene } from "@/lib/supabase";

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Shown Monday first, as on a calendar.
export const WEEK = [1, 2, 3, 4, 5, 6, 0];

export function daysLabel(days: number[]) {
  const set = new Set(days);
  if (set.size === 7) return "every day";
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return "weekdays";
  if (set.size === 2 && set.has(0) && set.has(6)) return "weekends";
  if (set.size === 0) return "never";
  return WEEK.filter((d) => set.has(d)).map((d) => DAYS[d]).join(", ");
}

const nameOf = (devices: Device[], id?: string) => devices.find((d) => d.id === id)?.name ?? "a removed device";

export function describeTrigger(t: AutomationTrigger, devices: Device[]) {
  if (t.type === "time") return `At ${t.at}, ${daysLabel(t.days)}`;
  if (t.type === "event") {
    return t.device_id ? `When ${nameOf(devices, t.device_id)} rings` : "When the doorbell rings";
  }
  const device = devices.find((d) => d.id === t.device_id);
  const option = device && triggerOptions(device).find((o) => o.id === t.option || (o.key === t.key && o.op === t.op));
  const value = option?.number ? ` ${t.value}${option.number.unit}` : "";
  return `When ${nameOf(devices, t.device_id)} ${option?.label ?? "changes"}${value}`;
}

export function describeAction(a: AutomationAction, devices: Device[]) {
  const device = devices.find((d) => d.id === a.device_id);
  const option = device && actionOptions(device).find((o) => o.id === a.option);
  const label = option?.label ?? a.action;
  const value = option?.number && a.value != null ? ` ${a.value}${option.number.unit}` : "";
  return `${label}${value}`.replace(/^./, (c) => c.toLowerCase());
}

export function summary(a: Automation, devices: Device[], scenes: Scene[] = []) {
  const then = a.actions
    .map((x) =>
      x.scene_id
        ? `play “${scenes.find((s) => s.id === x.scene_id)?.name ?? "a removed scene"}”`
        : `${nameOf(devices, x.device_id)}: ${describeAction(x, devices)}`,
    )
    .join(", ");
  return { when: describeTrigger(a.trigger, devices), then: then || "nothing yet" };
}
