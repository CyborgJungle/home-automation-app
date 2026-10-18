import {
  buildActions,
  emptyRow,
  toRows,
  type ActionRow,
} from "@/components/actions";
import { triggerOptions } from "@/lib/devices";
import type {
  Automation,
  AutomationRule,
  AutomationTrigger,
  Device,
  Scene,
} from "@/lib/supabase";
import { weatherOptionFor, weatherPredicate } from "@/lib/weather";

export type Category = "time" | "device" | "weather";
export type RuleDraft = {
  when: AutomationRule["type"];
  at: string;
  until: string;
  days: number[];
  device: string;
  option: string;
  value: number | null;
  weatherOption: string;
  weatherValue: number | null;
  sunEvent: "sunrise" | "sunset";
  sunOffset: number;
};
export type RuleBlock = { join: "and" | "or"; rule: RuleDraft };
export type AutomationDraft = {
  id?: string;
  name: string;
  enabled: boolean;
  blocks: RuleBlock[];
  actions: ActionRow[];
};

export const categoryOf = (type: RuleDraft["when"]): Category =>
  type === "time" || type === "time_range"
    ? "time"
    : type === "device" || type === "event"
      ? "device"
      : "weather";

export function emptyRule(category: Category = "time"): RuleDraft {
  return {
    when: category,
    at: "07:30",
    until: "22:00",
    days: [1, 2, 3, 4, 5],
    device: "",
    option: "",
    value: null,
    weatherOption: "temperature_below",
    weatherValue: null,
    sunEvent: "sunset",
    sunOffset: 0,
  };
}

export function emptyDraft(): AutomationDraft {
  return {
    name: "",
    enabled: true,
    blocks: [{ join: "and", rule: emptyRule() }],
    actions: [emptyRow()],
  };
}

function ruleDraft(t: AutomationRule, devices: Device[]): RuleDraft {
  const d = { ...emptyRule(), when: t.type };
  switch (t.type) {
    case "time":
      return { ...d, at: t.at, days: t.days };
    case "time_range":
      return { ...d, at: t.from, until: t.until, days: t.days };
    case "sun":
      return {
        ...d,
        sunEvent: t.event,
        sunOffset: t.offset_minutes,
        days: t.days,
      };
    case "weather":
      return {
        ...d,
        weatherOption: weatherOptionFor(t)?.id ?? "",
        weatherValue: typeof t.value === "number" ? t.value : null,
      };
    case "event": {
      if (t.event !== "button.press")
        return { ...d, device: t.device_id ?? "", option: "ring" };
      const device = devices.find((device) => device.id === t.device_id);
      const option =
        device &&
        triggerOptions(device).find(
          (option) => option.event && option.pattern === t.pattern,
        );
      return {
        ...d,
        device: t.device_id ?? "",
        option: t.option ?? option?.id ?? "",
      };
    }
    case "device": {
      const device = devices.find((device) => device.id === t.device_id);
      const option =
        device &&
        triggerOptions(device).find(
          (option) =>
            option.key === t.key &&
            option.op === t.op &&
            (option.number || option.value === t.value),
        );
      return {
        ...d,
        device: t.device_id,
        option: t.option ?? option?.id ?? "",
        value: typeof t.value === "number" ? t.value : null,
      };
    }
  }
}

export function toDraft(
  a: Automation,
  devices: Device[] = [],
): AutomationDraft {
  const groups = a.trigger.type === "logic" ? a.trigger.groups : [[a.trigger]];
  // Older weather filters apply to every alternative, preserving their meaning.
  const blocks = groups.flatMap((group, g) =>
    [...group, ...(a.conditions ?? [])].map(
      (rule, i): RuleBlock => ({
        join: g > 0 && i === 0 ? "or" : "and",
        rule: ruleDraft(rule, devices),
      }),
    ),
  );
  return {
    id: a.id,
    name: a.name,
    enabled: a.enabled,
    blocks,
    actions: toRows(a.actions),
  };
}

export function buildRule(
  d: RuleDraft,
  devices: Device[],
): AutomationRule | string {
  const validTime = (time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  if (d.when === "time" || d.when === "time_range" || d.when === "sun") {
    if (!d.days.length) return "Pick at least one day.";
    if (d.when === "sun") {
      if (!Number.isInteger(d.sunOffset) || Math.abs(d.sunOffset) > 180)
        return "Choose up to 180 minutes before or after.";
      return {
        type: "sun",
        event: d.sunEvent,
        offset_minutes: d.sunOffset,
        days: [...d.days].sort(),
      };
    }
    if (!validTime(d.at)) return "Pick a time.";
    if (d.when === "time_range") {
      if (!validTime(d.until) || d.at === d.until)
        return "Choose a different start and end time.";
      return {
        type: "time_range",
        from: d.at,
        until: d.until,
        days: [...d.days].sort(),
      };
    }
    return { type: "time", at: d.at, days: [...d.days].sort() };
  }
  if (d.when === "weather") {
    const predicate = weatherPredicate(d.weatherOption, d.weatherValue);
    return typeof predicate === "string"
      ? predicate
      : { type: "weather", ...predicate };
  }
  if (d.when === "event" && d.option !== "ring") {
    const device = devices.find((device) => device.id === d.device);
    const option =
      device &&
      triggerOptions(device).find((option) => option.id === d.option);
    if (!device || !option?.event) return "Choose a remote and a press.";
    return {
      type: "event",
      event: option.event,
      device_id: device.id,
      pattern: option.pattern,
      option: option.id,
    };
  }
  if (d.when === "event")
    return {
      type: "event",
      event: "doorbell.ring",
      ...(d.device ? { device_id: d.device } : {}),
    };
  const device = devices.find((device) => device.id === d.device);
  const option =
    device && triggerOptions(device).find((option) => option.id === d.option);
  if (!device || !option) return "Choose a device and what to check.";
  const value = option.number
    ? (d.value ?? option.number.default)
    : option.value;
  if (
    option.number &&
    (typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < option.number.min ||
      value > option.number.max)
  )
    return "Choose a value within the allowed range.";
  return {
    type: "device",
    device_id: device.id,
    key: option.key,
    op: option.op,
    value,
    option: option.id,
  };
}

export function build(
  draft: AutomationDraft,
  devices: Device[],
  scenes: Scene[],
) {
  if (!draft.blocks.length || draft.blocks.length > 12)
    return "Use between 1 and 12 blocks.";
  const groups: AutomationRule[][] = [];
  for (const block of draft.blocks) {
    const rule = buildRule(block.rule, devices);
    if (typeof rule === "string") return rule;
    if (!groups.length || block.join === "or") groups.push([]);
    groups[groups.length - 1].push(rule);
  }
  const actions = buildActions(draft.actions, devices, scenes);
  if (typeof actions === "string") return actions;
  const trigger: AutomationTrigger = { type: "logic", groups };
  return { trigger, actions, conditions: [] };
}
