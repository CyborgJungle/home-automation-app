"use client";

import { useState } from "react";
import { ActionRows, buildActions, emptyRow, NumberField, toRows, type ActionRow } from "@/components/actions";
import { Blob, Icon, type IconKey } from "@/components/icons";
import { Sheet, Switch, timeAgo } from "@/components/ui";
import { DAYS, describeTrigger, summary, WEEK } from "@/lib/automations";
import { ChipChoice, deviceGroups, Picker } from "@/components/picker";
import { canTrigger, triggerOptions } from "@/lib/devices";
import { useHome } from "@/lib/home";
import type { Automation, AutomationAction, AutomationTrigger, Device, Scene } from "@/lib/supabase";

type When = "time" | "device" | "event";

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
  actions: ActionRow[];
};

const WHEN: { id: When; label: string; icon: IconKey; tone: string }[] = [
  { id: "time", label: "Time", icon: "clock", tone: "lavender" },
  { id: "device", label: "Device", icon: "bulb", tone: "yellow" },
  { id: "event", label: "Doorbell", icon: "bell", tone: "sage" },
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
    days: t.type === "time" ? t.days : d.days,
    triggerDevice: t.type === "device" ? t.device_id : "",
    triggerOption: t.type === "device" ? t.option ?? "" : "",
    triggerValue: t.type === "device" && typeof t.value === "number" ? t.value : null,
    eventDevice: t.type === "event" ? t.device_id ?? "" : "",
    actions: toRows(a.actions),
  };
}

// Turns the form into the trigger/actions the Supabase engine runs, or explains what's missing.
function build(draft: Draft, devices: Device[], scenes: Scene[]): { trigger: AutomationTrigger; actions: AutomationAction[] } | string {
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
  } else {
    trigger = draft.eventDevice
      ? { type: "event", event: "doorbell.ring", device_id: draft.eventDevice }
      : { type: "event", event: "doorbell.ring" };
  }

  const actions = buildActions(draft.actions, devices, scenes);
  if (typeof actions === "string") return actions;
  return { trigger, actions };
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
          const { when, then } = summary(a, devices, scenes);
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
          <div className="segmented" role="radiogroup" aria-label="Starts when">
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
              <div className="days" role="group" aria-label="Days">
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
            </>
          )}

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
      </div>
    </Sheet>
  );
}
