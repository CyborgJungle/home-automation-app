"use client";

// The "do this" list shared by the automation and scene editors: pick a
// device (or, in automations, a scene) and what it should do.

import { Icon } from "@/components/icons";
import { Slider } from "@/components/ui";
import { ChipChoice, deviceGroups, Picker, sceneItem, type PickerGroup } from "@/components/picker";
import { actionOptions, canAct, type NumberInput } from "@/lib/devices";
import type { AutomationAction, Device, Scene } from "@/lib/supabase";

export type ActionRow = { device_id: string; option: string; value: number | null; choice?: string | null };

export const emptyRow = (): ActionRow => ({ device_id: "", option: "", value: null, choice: null });

const SCENE_PREFIX = "scene:";
const sceneIdOf = (row: ActionRow) => (row.device_id.startsWith(SCENE_PREFIX) ? row.device_id.slice(SCENE_PREFIX.length) : null);

export const toRows = (actions: AutomationAction[]): ActionRow[] =>
  actions.map((a) => ({
    device_id: a.scene_id ? `${SCENE_PREFIX}${a.scene_id}` : a.device_id,
    option: a.option ?? "",
    value: a.value ?? null,
    choice: a.choice ?? null,
  }));

// Turns the rows into what Supabase runs, or explains what's missing.
export function buildActions(rows: ActionRow[], devices: Device[], scenes: Scene[] = []): AutomationAction[] | string {
  const actions: AutomationAction[] = [];
  for (const row of rows) {
    const sceneId = sceneIdOf(row);
    if (sceneId) {
      if (!scenes.some((s) => s.id === sceneId)) return "That scene no longer exists.";
      actions.push({ device_id: row.device_id, scene_id: sceneId, action: "play_scene", params: {}, option: "play", value: null });
      continue;
    }
    const device = devices.find((d) => d.id === row.device_id);
    const option = device && actionOptions(device).find((o) => o.id === row.option);
    if (!device || !option) return "Every action needs a device and what to do.";
    const value = option.number ? row.value ?? option.number.default : null;
    const choice = option.choices || option.text ? row.choice?.trim() || null : null;
    if (option.choices && !choice) return `Pick which one for “${option.label}”.`;
    if (option.text && !choice?.includes("://")) return `Fill in a full link for “${option.label}”, starting with https://.`;
    actions.push({
      device_id: device.id,
      action: option.action,
      params: option.params(value, choice),
      option: option.id,
      value,
      choice,
      ...(option.offAfter && value !== null ? { off_after_minutes: value } : {}),
    });
  }
  if (!actions.length) return "Add at least one action.";
  return actions;
}

export function ActionRows({
  rows,
  onChange,
  devices,
  scenes,
  timed = false,
}: {
  rows: ActionRow[];
  onChange: (rows: ActionRow[]) => void;
  devices: Device[];
  scenes?: Scene[];
  // Offer "Turn on for…" (automations only; a scene has nothing to count from).
  timed?: boolean;
}) {
  const groups: PickerGroup[] = [
    ...(scenes?.length ? [{ title: "Play a scene", items: scenes.map((sc) => sceneItem(sc, `${SCENE_PREFIX}${sc.id}`)) }] : []),
    ...deviceGroups(devices.filter(canAct)),
  ];

  return (
    <>
      {rows.map((row, i) => {
        const device = devices.find((d) => d.id === row.device_id);
        const options = device ? actionOptions(device).filter((o) => timed || !o.offAfter) : [];
        const option = options.find((o) => o.id === row.option);
        const update = (patch: Partial<ActionRow>) => onChange(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
        return (
          <div key={i} className="action-row">
            <div className="action-fields">
              <Picker
                label={scenes ? "Device or scene" : "Device"}
                placeholder={scenes ? "Choose a device or scene" : "Choose a device"}
                value={row.device_id}
                groups={groups}
                onChange={(v) => update({ device_id: v, option: "", value: null })}
              />
              {device && (
                <ChipChoice
                  label="What to do"
                  value={row.option}
                  options={options.map((o) => ({ value: o.id, label: o.label }))}
                  onChange={(v) => update({ option: v, value: null, choice: null })}
                />
              )}
              {option?.choices && (
                <Picker
                  label={option.label}
                  placeholder={`${option.label}…`}
                  value={row.choice ?? ""}
                  groups={[
                    {
                      title: option.label,
                      items: option.choices.map((c) => ({
                        value: c.value,
                        label: c.label,
                        art: (
                          <span className="picker-icon tone-pink">
                            <Icon name="play" size={15} />
                          </span>
                        ),
                      })),
                    },
                  ]}
                  onChange={(v) => update({ choice: v })}
                />
              )}
              {option?.text && (
                <label className="field">
                  <span>{option.text.label}</span>
                  <input
                    type="url"
                    inputMode="url"
                    autoCapitalize="off"
                    autoCorrect="off"
                    value={row.choice ?? ""}
                    placeholder={option.text.placeholder}
                    onChange={(e) => update({ choice: e.target.value })}
                  />
                </label>
              )}
              {option?.number && (
                <NumberField
                  input={option.number}
                  label={option.numberLabel ?? option.label}
                  value={row.value}
                  onChange={(v) => update({ value: v })}
                />
              )}
              {option?.offAfter && (
                <p className="muted small">
                  Stays on while the trigger still holds, like ongoing motion, then turns off after this many minutes.
                </p>
              )}
            </div>
            {rows.length > 1 && (
              <button className="round small" aria-label="Remove action" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
        );
      })}
      <button className="pill light small" onClick={() => onChange([...rows, emptyRow()])}>
        <Icon name="plus" size={16} /> Add action
      </button>
    </>
  );
}

// A drag bar for numbers: slide or tap anywhere on it, easy with a thumb.
// Offsets that can go negative show a "+" for positive values.
export function NumberField({
  input,
  value,
  onChange,
  label = "Value",
}: {
  input: NumberInput;
  value: number | null;
  onChange: (v: number) => void;
  label?: string;
}) {
  const v = value ?? input.default;
  const format = (n: number) => `${input.min < 0 && n > 0 ? "+" : ""}${n}${input.unit}`;
  return <Slider label={label} value={v} min={input.min} max={input.max} step={input.step} format={format} onCommit={onChange} />;
}
