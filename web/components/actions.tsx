"use client";

// The "do this" list shared by the automation and scene editors: pick a
// device (or, in automations, a scene) and what it should do.

import { Icon } from "@/components/icons";
import { actionOptions, canAct, pickerLabel, type NumberInput } from "@/lib/devices";
import type { AutomationAction, Device, Scene } from "@/lib/supabase";

export type ActionRow = { device_id: string; option: string; value: number | null };

export const emptyRow = (): ActionRow => ({ device_id: "", option: "", value: null });

const SCENE_PREFIX = "scene:";
const sceneIdOf = (row: ActionRow) => (row.device_id.startsWith(SCENE_PREFIX) ? row.device_id.slice(SCENE_PREFIX.length) : null);

export const toRows = (actions: AutomationAction[]): ActionRow[] =>
  actions.map((a) => ({
    device_id: a.scene_id ? `${SCENE_PREFIX}${a.scene_id}` : a.device_id,
    option: a.option ?? "",
    value: a.value ?? null,
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
    actions.push({ device_id: device.id, action: option.action, params: option.params(value), option: option.id, value });
  }
  if (!actions.length) return "Add at least one action.";
  return actions;
}

export function ActionRows({
  rows,
  onChange,
  devices,
  scenes,
}: {
  rows: ActionRow[];
  onChange: (rows: ActionRow[]) => void;
  devices: Device[];
  scenes?: Scene[];
}) {
  const actionDevices = devices.filter(canAct).sort((a, b) => pickerLabel(a).localeCompare(pickerLabel(b)));

  return (
    <>
      {rows.map((row, i) => {
        const device = devices.find((d) => d.id === row.device_id);
        const options = device ? actionOptions(device) : [];
        const option = options.find((o) => o.id === row.option);
        const update = (patch: Partial<ActionRow>) => onChange(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
        return (
          <div key={i} className="action-row">
            <div className="action-fields">
              <select aria-label="Device" value={row.device_id} onChange={(e) => update({ device_id: e.target.value, option: "", value: null })}>
                <option value="">Choose a device…</option>
                {scenes && scenes.length > 0 && (
                  <optgroup label="Play a scene">
                    {scenes.map((s) => (
                      <option key={s.id} value={`${SCENE_PREFIX}${s.id}`}>
                        ✦ {s.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Devices">
                  {actionDevices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {pickerLabel(d)}
                    </option>
                  ))}
                </optgroup>
              </select>
              {device && (
                <select aria-label="Action" value={row.option} onChange={(e) => update({ option: e.target.value, value: null })}>
                  <option value="">Do what?</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
              {option?.number && <NumberField input={option.number} value={row.value} onChange={(v) => update({ value: v })} />}
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

export function NumberField({ input, value, onChange }: { input: NumberInput; value: number | null; onChange: (v: number) => void }) {
  const v = value ?? input.default;
  const clamp = (n: number) => Math.min(input.max, Math.max(input.min, Math.round(n / input.step) * input.step));
  return (
    <div className="number-field">
      <button className="round" aria-label="Less" onClick={() => onChange(clamp(v - input.step))}>
        <Icon name="minus" size={16} />
      </button>
      <strong>
        {v}
        <small>{input.unit}</small>
      </strong>
      <button className="round" aria-label="More" onClick={() => onChange(clamp(v + input.step))}>
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}
