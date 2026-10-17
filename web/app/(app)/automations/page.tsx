"use client";

import { useState } from "react";
import { ActionRows, buildActions, emptyRow, NumberField, toRows, type ActionRow } from "@/components/actions";
import { Blob, Icon, type IconKey } from "@/components/icons";
import { Sheet, Switch, timeAgo } from "@/components/ui";
import { DAYS, describeTrigger, summary, WEEK } from "@/lib/automations";
import { ChipChoice, deviceGroups, Picker } from "@/components/picker";
import { canTrigger, triggerOptions } from "@/lib/devices";
import { useHome } from "@/lib/home";
import type { Automation, AutomationAction, AutomationTrigger, Device, Scene, WeatherCondition } from "@/lib/supabase";
import { WEATHER_OPTIONS, weatherOptionFor, weatherPredicate } from "@/lib/weather";

type When = "time" | "device" | "event" | "weather" | "sun";
type ConditionRow = { option: string; value: number | null };

type Draft = {
  id?: string;
  name: string;
  enabled: boolean;
  when: When;
  at: string;
  days: number[];
  triggerDevice: string;
  triggerOption: string;
  triggerValue: number | null;
  eventDevice: string; // "" = any doorbell
  weatherOption: string;
  weatherValue: number | null;
  sunEvent: "sunrise" | "sunset";
  sunOffset: number;
  conditions: ConditionRow[];
  actions: ActionRow[];
};

const WHEN: { id: When; label: string; icon: IconKey; tone: string }[] = [
  { id: "time", label: "Time", icon: "clock", tone: "lavender" },
  { id: "device", label: "Device", icon: "bulb", tone: "yellow" },
  { id: "event", label: "Doorbell", icon: "bell", tone: "sage" },
  { id: "weather", label: "Weather", icon: "cloud", tone: "sky" },
  { id: "sun", label: "Sun", icon: "sun", tone: "yellow" },
];

const toneOfWhen = (w: When) => WHEN.find((x) => x.id === w)!.tone;

function emptyDraft(): Draft {
  return {
    name: "",
    enabled: true,
    when: "time",
    at: "07:30",
    days: [1, 2, 3, 4, 5],
    triggerDevice: "",
    triggerOption: "",
    triggerValue: null,
    eventDevice: "",
    weatherOption: "temperature_below",
    weatherValue: null,
    sunEvent: "sunset",
    sunOffset: 0,
    conditions: [],
    actions: [emptyRow()],
  };
}

function toDraft(a: Automation): Draft {
  const d = emptyDraft();
  const t = a.trigger;
  return {
    ...d,
    id: a.id,
    name: a.name,
    enabled: a.enabled,
    when: t.type,
    at: t.type === "time" ? t.at : d.at,
    days: t.type === "time" || t.type === "sun" ? t.days : d.days,
    triggerDevice: t.type === "device" ? t.device_id : "",
    triggerOption: t.type === "device" ? t.option ?? "" : "",
    triggerValue: t.type === "device" && typeof t.value === "number" ? t.value : null,
    eventDevice: t.type === "event" ? t.device_id ?? "" : "",
    weatherOption: t.type === "weather" ? weatherOptionFor(t)?.id ?? "" : d.weatherOption,
    weatherValue: t.type === "weather" && typeof t.value === "number" ? t.value : null,
    sunEvent: t.type === "sun" ? t.event : "sunset",
    sunOffset: t.type === "sun" ? t.offset_minutes : 0,
    conditions: (a.conditions ?? []).map(c => ({ option: weatherOptionFor(c)?.id ?? "", value: typeof c.value === "number" ? c.value : null })),
    actions: toRows(a.actions),
  };
}

// Turns the form into the trigger/actions the Supabase engine runs, or explains what's missing.
function build(draft: Draft, devices: Device[], scenes: Scene[]): { trigger: AutomationTrigger; actions: AutomationAction[]; conditions: WeatherCondition[] } | string {
  let trigger: AutomationTrigger;
  if (draft.when === "time") {
    if (!/^\d{2}:\d{2}$/.test(draft.at)) return "Pick a time.";
    if (!draft.days.length) return "Pick at least one day.";
    trigger = { type: "time", at: draft.at, days: [...draft.days].sort() };
  } else if (draft.when === "device") {
    const device = devices.find((d) => d.id === draft.triggerDevice);
    const option = device && triggerOptions(device).find((o) => o.id === draft.triggerOption);
    if (!device || !option) return "Choose a device and what should happen to it.";
    const value = option.number ? draft.triggerValue ?? option.number.default : option.value;
    trigger = { type: "device", device_id: device.id, key: option.key, op: option.op, value, option: option.id };
  } else if (draft.when === "weather") {
    const predicate = weatherPredicate(draft.weatherOption, draft.weatherValue);
    if (typeof predicate === "string") return predicate;
    trigger = { type: "weather", ...predicate };
  } else if (draft.when === "sun") {
    if (!draft.days.length) return "Pick at least one day.";
    if (!Number.isInteger(draft.sunOffset) || Math.abs(draft.sunOffset) > 180) return "Choose an offset between 180 minutes before and after.";
    trigger = { type: "sun", event: draft.sunEvent, offset_minutes: draft.sunOffset, days: [...draft.days].sort() };
  } else {
    trigger = draft.eventDevice
      ? { type: "event", event: "doorbell.ring", device_id: draft.eventDevice }
      : { type: "event", event: "doorbell.ring" };
  }

  const actions = buildActions(draft.actions, devices, scenes);
  if (typeof actions === "string") return actions;
  const conditions: WeatherCondition[] = [];
  for (const row of draft.conditions) {
    const predicate = weatherPredicate(row.option, row.value);
    if (typeof predicate === "string") return predicate;
    conditions.push({ type: "weather", ...predicate });
  }
  return { trigger, actions, conditions };
}

// A few starting points, filled in with your own devices where possible.
function ideas(devices: Device[]): { title: string; tone: string; draft: Draft }[] {
  const find = (pred: (d: Device) => boolean) => devices.find(pred)?.id ?? "";
  const blind = find((d) => d.kind === "blind");
  const hall = find((d) => d.kind === "light" && /gang|hal|hall/i.test(d.name)) || find((d) => d.kind === "light");
  const living = find((d) => d.kind === "group" && /woon|living/i.test(d.name)) || find((d) => d.kind === "group");
  const tv = find((d) => d.kind === "tv");
  const base = emptyDraft();
  return [
    {
      title: "30 min before sunset → living-room lights on",
      tone: "yellow",
      draft: { ...base, name: "Evening lights", when: "sun", days: [0, 1, 2, 3, 4, 5, 6], sunEvent: "sunset", sunOffset: -30, actions: [{ device_id: living, option: living ? "on" : "", value: null }] },
    },
    {
      title: "Open the blinds on weekday mornings",
      tone: "lavender",
      draft: { ...base, name: "Morning blinds", when: "time", at: "07:30", days: [1, 2, 3, 4, 5], actions: [{ device_id: blind, option: blind ? "open" : "", value: null }] },
    },
    {
      title: "Doorbell rings → hall light on",
      tone: "sage",
      draft: { ...base, name: "Doorbell light", when: "event", actions: [{ device_id: hall, option: hall ? "on" : "", value: null }] },
    },
    {
      title: "TV on → dim the living room",
      tone: "pink",
      draft: {
        ...base,
        name: "Movie mode",
        when: "device",
        triggerDevice: tv,
        triggerOption: tv ? "on" : "",
        actions: [{ device_id: living, option: living ? "brightness" : "", value: 25 }],
      },
    },
  ];
}

export default function AutomationsPage() {
  const { automations, devices, scenes, setAutomationEnabled } = useHome();
  const [draft, setDraft] = useState<Draft | null>(null);

  return (
    <main className="page">
      <header className="title-row">
        <h1 className="display">Automations</h1>
        <button className="pill" onClick={() => setDraft(emptyDraft())}>
          <Icon name="plus" size={18} /> New
        </button>
      </header>

      {automations.length === 0 && (
        <div className="empty left">
          <Blob size={72} tone="var(--lavender)" look="right" />
          <p>
            <strong>No automations yet.</strong> Make simple &ldquo;if this, then that&rdquo; rules. They run in the cloud, so they work with the app closed.
          </p>
        </div>
      )}

      <div className="stack">
        {automations.map((a) => {
          const { when, then, onlyIf } = summary(a, devices, scenes);
          const w = WHEN.find((x) => x.id === a.trigger.type)!;
          return (
            <article
              key={a.id}
              className={`auto-card tone-${w.tone}${a.enabled ? "" : " disabled"}`}
              role="button"
              tabIndex={0}
              onClick={() => setDraft(toDraft(a))}
              onKeyDown={(e) => e.key === "Enter" && setDraft(toDraft(a))}
            >
              <div className="auto-top">
                <span className="auto-icon">
                  <Icon name={w.icon} size={18} />
                </span>
                <Switch on={a.enabled} label={`${a.name} on/off`} onChange={(on) => setAutomationEnabled(a.id, on)} />
              </div>
              <h3>{a.name}</h3>
              <p className="auto-when">{when}</p>
              {onlyIf && <p className="auto-when">Only if {onlyIf}</p>}
              <p className="auto-then">
                <Icon name="chevron" size={14} stroke={3} /> {then}
              </p>
              <p className="auto-meta">Last ran {timeAgo(a.last_run_at)}</p>
            </article>
          );
        })}
      </div>

      <section className="section">
        <h2 className="section-title">Ideas</h2>
        <div className="ideas">
          {ideas(devices).map((i) => (
            <button key={i.title} className={`idea tone-${i.tone}`} onClick={() => setDraft(i.draft)}>
              <span>{i.title}</span>
              <span className="round small dark">
                <Icon name="plus" size={16} />
              </span>
            </button>
          ))}
        </div>
      </section>

      {draft && <Editor initial={draft} onClose={() => setDraft(null)} />}
    </main>
  );
}

function Editor({ initial, onClose }: { initial: Draft; onClose: () => void }) {
  const { devices, scenes, saveAutomation, deleteAutomation, send, playScene } = useHome();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const triggerGroups = deviceGroups(devices.filter(canTrigger));
  const doorbells = devices.filter((d) => d.kind === "doorbell");
  const tDevice = devices.find((d) => d.id === draft.triggerDevice);
  const tOption = tDevice && triggerOptions(tDevice).find((o) => o.id === draft.triggerOption);

  async function save() {
    const built = build(draft, devices, scenes);
    if (typeof built === "string") return setError(built);
    setSaving(true);
    const name = draft.name.trim() || describeTrigger(built.trigger, devices);
    const err = await saveAutomation({ id: draft.id, name, enabled: draft.enabled, ...built });
    setSaving(false);
    if (err) setError(err);
    else onClose();
  }

  async function runNow() {
    const built = build(draft, devices, scenes);
    if (typeof built === "string") return setError(built);
    for (const a of built.actions) {
      const scene = a.scene_id && scenes.find((x) => x.id === a.scene_id);
      const device = devices.find((d) => d.id === a.device_id);
      if (scene) await playScene(scene);
      else if (device) await send(device, a.action, a.params);
    }
  }

  async function remove() {
    if (!draft.id || !confirm(`Delete "${draft.name}"?`)) return;
    const err = await deleteAutomation(draft.id);
    if (err) setError(err);
    else onClose();
  }

  return (
    <Sheet open onClose={onClose} title={draft.id ? "Edit automation" : "New automation"} tone={toneOfWhen(draft.when)}>
      <div className="editor">
        <label className="field">
          <span>Name</span>
          <input value={draft.name} placeholder="e.g. Morning blinds" onChange={(e) => set({ name: e.target.value })} />
        </label>

        <div className={`block tone-${toneOfWhen(draft.when)}`}>
          <span className="badge">When</span>
          <div className="segmented automation-starts" role="radiogroup" aria-label="Starts when">
            {WHEN.map((w) => (
              <button key={w.id} role="radio" aria-checked={draft.when === w.id} className={draft.when === w.id ? "selected" : ""} onClick={() => set({ when: w.id })}>
                <Icon name={w.icon} size={16} /> {w.label}
              </button>
            ))}
          </div>

          {draft.when === "time" && (
            <>
              <label className="field">
                <span>At</span>
                <input type="time" value={draft.at} onChange={(e) => set({ at: e.target.value })} />
              </label>
            </>
          )}

          {draft.when === "sun" && <>
            <ChipChoice label="Sun event" value={draft.sunEvent} options={[{ value: "sunrise", label: "Sunrise" }, { value: "sunset", label: "Sunset" }]} onChange={(v) => set({ sunEvent: v as "sunrise" | "sunset" })} />
            <NumberField input={{ min: -180, max: 180, step: 5, default: 0, unit: " min" }} value={draft.sunOffset} onChange={(sunOffset) => set({ sunOffset })} />
            <p className="muted small">Negative minutes are before; positive minutes are after. Uses Amsterdam local time.</p>
          </>}

          {(draft.when === "time" || draft.when === "sun") && <div className="days" role="group" aria-label="Days">
                {WEEK.map((d) => {
                  const on = draft.days.includes(d);
                  return (
                    <button
                      key={d}
                      className={on ? "day on" : "day"}
                      aria-pressed={on}
                      onClick={() => set({ days: on ? draft.days.filter((x) => x !== d) : [...draft.days, d] })}
                    >
                      {DAYS[d].slice(0, 2)}
                    </button>
                  );
                })}
              </div>
          }

          {draft.when === "weather" && <>
            <WeatherChoice option={draft.weatherOption} value={draft.weatherValue} onChange={(weatherOption, weatherValue) => set({ weatherOption, weatherValue })} />
            <p className="muted small">Runs when the condition becomes true. Weather updates every 15 minutes; stale readings are ignored.</p>
          </>}

          {draft.when === "device" && (
            <>
              <Picker
                label="Device"
                placeholder="Choose a device"
                value={draft.triggerDevice}
                groups={triggerGroups}
                onChange={(v) => set({ triggerDevice: v, triggerOption: "", triggerValue: null })}
              />
              {tDevice && (
                <ChipChoice
                  label="When it"
                  value={draft.triggerOption}
                  options={triggerOptions(tDevice).map((o) => ({ value: o.id, label: o.label }))}
                  onChange={(v) => set({ triggerOption: v, triggerValue: null })}
                />
              )}
              {tOption?.number && (
                <NumberField input={tOption.number} value={draft.triggerValue} onChange={(v) => set({ triggerValue: v })} />
              )}
            </>
          )}

          {draft.when === "event" && (
            <ChipChoice
              label="Doorbell"
              value={draft.eventDevice}
              options={[{ value: "", label: "Any doorbell" }, ...doorbells.map((d) => ({ value: d.id, label: d.name }))]}
              onChange={(v) => set({ eventDevice: v })}
            />
          )}
        </div>

        <div className="block tone-sand">
          <span className="badge">Only if</span>
          {draft.conditions.length === 0 && <p className="muted small">Optional weather conditions. Every condition must match when the automation starts.</p>}
          {draft.conditions.map((row, i) => <div className="weather-condition" key={i}>
            <WeatherChoice condition option={row.option} value={row.value} onChange={(option, value) => set({ conditions: draft.conditions.map((c, j) => i === j ? { option, value } : c) })} />
            <button className="pill light small" onClick={() => set({ conditions: draft.conditions.filter((_, j) => j !== i) })} aria-label={`Remove weather condition ${i + 1}`}><Icon name="close" size={14} /> Remove</button>
          </div>)}
          <button className="pill light small" onClick={() => set({ conditions: [...draft.conditions, { option: "temperature_below", value: null }] })}><Icon name="plus" size={16} /> Add weather condition</button>
        </div>

        {(draft.when === "weather" || draft.when === "sun" || draft.conditions.length > 0) && (
          <p className="muted small">Weather for Amsterdam · 1011 AB by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>. Uses area forecasts, which can differ from conditions at your home.</p>
        )}

        <div className="block tone-mint">
          <span className="badge">Then</span>
          <ActionRows rows={draft.actions} onChange={(actions) => set({ actions })} devices={devices} scenes={scenes} />
        </div>

        {error && <p className="error">{error}</p>}

        <button className="pill wide big" disabled={saving} onClick={save}>
          {saving ? "Saving…" : draft.id ? "Save changes" : "Create automation"}
        </button>
        <div className="button-row">
          <button className="pill light" onClick={runNow}>
            <Icon name="play" size={16} /> Run now
          </button>
          {draft.id && (
            <button className="pill light danger" onClick={remove}>
              <Icon name="trash" size={16} /> Delete
            </button>
          )}
        </div>
        <p className="muted small">Run now plays the actions immediately, without checking the trigger or conditions.</p>
      </div>
    </Sheet>
  );
}

function WeatherChoice({ option, value, onChange, condition = false }: { option: string; value: number | null; onChange: (option: string, value: number | null) => void; condition?: boolean }) {
  const selected = WEATHER_OPTIONS.find(o => o.id === option);
  return <>
    <Picker label={condition ? "Weather condition" : "Weather change"} placeholder="Choose weather" value={option}
      groups={[{ title: condition ? "Only if" : "When the weather changes", items: WEATHER_OPTIONS.map(o => ({ value: o.id, label: condition ? o.conditionLabel : o.label, art: <span className="picker-icon tone-sky"><Icon name="cloud" size={16} /></span> })) }]}
      onChange={(v) => onChange(v, null)} />
    {selected?.number && <NumberField input={selected.number} value={value} onChange={(v) => onChange(option, v)} />}
  </>;
}
