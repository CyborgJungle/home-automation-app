// Plain-English summaries of automations, for the list and the builder.

import { actionOptions, triggerOptions } from "@/lib/devices";
import type {
  Automation,
  AutomationAction,
  AutomationTrigger,
  Device,
  Scene,
} from "@/lib/supabase";
import { describeWeather } from "@/lib/weather";

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Shown Monday first, as on a calendar.
export const WEEK = [1, 2, 3, 4, 5, 6, 0];

export function daysLabel(days: number[]) {
  const set = new Set(days);
  if (set.size === 7) return "every day";
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d)))
    return "weekdays";
  if (set.size === 2 && set.has(0) && set.has(6)) return "weekends";
  if (set.size === 0) return "never";
  return WEEK.filter((d) => set.has(d))
    .map((d) => DAYS[d])
    .join(", ");
}

const nameOf = (devices: Device[], id?: string) =>
  devices.find((d) => d.id === id)?.name ?? "a removed device";

export const deviceStateLabel = (label: string) =>
  ({
    "turns on": "is on",
    "turns off": "is off",
    "starts playing": "is playing",
    "stops playing": "is stopped",
    "drops below": "temperature is below",
    "rises above": "temperature is above",
    "opens fully": "is fully open",
    "closes fully": "is fully closed",
    "battery drops below": "battery is below",
  })[label] ?? label;

export function describeTrigger(
  t: AutomationTrigger,
  devices: Device[],
  state = false,
): string {
  if (t.type === "logic")
    return (
      "When " +
      t.groups
        .map((group) =>
          group
            .map((rule) =>
              describeTrigger(rule, devices, true)
                .replace(/^When /, "")
                .replace(/^(At|Between) /, (word) => word.toLowerCase()),
            )
            .join(" and "),
        )
        .map((text) => (t.groups.length > 1 ? `(${text})` : text))
        .join(" or ")
    );
  if (t.type === "time") return `At ${t.at}, ${daysLabel(t.days)}`;
  if (t.type === "event" && t.event === "button.press") {
    const device = devices.find((d) => d.id === t.device_id);
    const option = device && triggerOptions(device).find((o) => o.id === t.option || (o.event && o.pattern === t.pattern));
    return `When ${nameOf(devices, t.device_id)} ${option?.label ?? "is pressed"}`;
  }
  if (t.type === "time_range")
    return `Between ${t.from} and ${t.until}, ${daysLabel(t.days)}`;
  if (t.type === "weather")
    return `When ${describeWeather(t, state).toLowerCase()}`;
  if (t.type === "dark") {
    const at = (n: number, event: string) =>
      n === 0 ? event : `${Math.abs(n)} min ${n < 0 ? "before" : "after"} ${event}`;
    return `When it's dark (${at(t.sunset_offset_minutes, "sunset")} to ${at(t.sunrise_offset_minutes, "sunrise")})`;
  }
  if (t.type === "sun") {
    const offset = t.offset_minutes;
    return `${offset === 0 ? "At" : `${Math.abs(offset)} min ${offset < 0 ? "before" : "after"}`} ${t.event}, ${daysLabel(t.days)}`;
  }
  if (t.type === "event") {
    return t.device_id
      ? `When ${nameOf(devices, t.device_id)} rings`
      : "When the doorbell rings";
  }
  const device = devices.find((d) => d.id === t.device_id);
  const option =
    device &&
    (triggerOptions(device).find((o) => o.id === t.option) ??
      triggerOptions(device).find(
        (o) =>
          o.key === t.key && o.op === t.op && (o.number || o.value === t.value),
      ));
  const value = option?.number ? ` ${t.value}${option.number.unit}` : "";
  const label = option?.label ?? "changes";
  return `When ${nameOf(devices, t.device_id)} ${state ? deviceStateLabel(label) : label}${value}`;
}

export function describeAction(a: AutomationAction, devices: Device[]) {
  const device = devices.find((d) => d.id === a.device_id);
  const option = device && actionOptions(device).find((o) => o.id === a.option);
  const label = option?.label ?? a.action;
  const value =
    option?.number && a.value != null ? ` ${a.value}${option.number.unit}` : "";
  const choice = option?.choices?.find((c) => c.value === a.choice)?.label;
  // "set colour purple at 40%" when an action has both a choice and a number.
  if (choice) return `${label} ${choice.toLowerCase()}${value ? ` at${value}` : ""}`.replace(/^./, (c) => c.toLowerCase());
  return `${label}${value}`.replace(/^./, (c) => c.toLowerCase());
}

export function summary(
  a: Automation,
  devices: Device[],
  scenes: Scene[] = [],
) {
  const then = a.actions
    .map((x) =>
      x.scene_id
        ? `play “${scenes.find((s) => s.id === x.scene_id)?.name ?? "a removed scene"}”`
        : `${nameOf(devices, x.device_id)}: ${describeAction(x, devices)}`,
    )
    .join(", ");
  const conditions = (a.conditions ?? [])
    .map((c) => describeWeather(c, true).toLowerCase())
    .join(" and ");
  return {
    when: `${describeTrigger(a.trigger, devices)}${conditions ? ` and ${conditions}` : ""}`,
    then: then || "nothing yet",
  };
}
