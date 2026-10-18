"use client";

import { useState } from "react";
import { ActionRows, buildActions, emptyRow, toRows, type ActionRow } from "@/components/actions";
import { Icon, SceneArt } from "@/components/icons";
import { PageHeader, Sheet, timeAgo } from "@/components/ui";
import { useHome } from "@/lib/home";
import { sceneIsOn, scenePlaying } from "@/lib/scenes";
import { SCENE_SHAPES, type Device, type Scene, type SceneShape } from "@/lib/supabase";

const TONES = ["yellow", "pink", "lavender", "sage", "peach", "mint", "sky"];

type Draft = { id?: string; name: string; tone: string; shape: SceneShape; rows: ActionRow[]; kind: Scene["kind"] };

const emptyDraft = (i = 0): Draft => ({
  name: "",
  tone: TONES[i % TONES.length],
  shape: SCENE_SHAPES[i % SCENE_SHAPES.length],
  rows: [emptyRow()],
  kind: "custom",
});

const toDraft = (s: Scene): Draft => ({ id: s.id, name: s.name, tone: s.tone, shape: s.shape, rows: toRows(s.actions), kind: s.kind });

// Starting points, filled in with your own devices where possible.
function ideas(devices: Device[]): Draft[] {
  const find = (pred: (d: Device) => boolean) => devices.find(pred)?.id ?? "";
  const living = find((d) => d.kind === "group" && /woon|living/i.test(d.name)) || find((d) => d.kind === "group");
  const blind = find((d) => d.kind === "blind");
  const tv = find((d) => d.kind === "tv");
  const allGroups = devices.filter((d) => d.kind === "group").map((d) => d.id);
  const row = (device_id: string, option: string, value: number | null = null): ActionRow => ({ device_id, option: device_id ? option : "", value });
  const custom = "custom" as const;
  return [
    { name: "Turn everything off", tone: "lavender", shape: "cloud", rows: [], kind: "all_off" },
    { name: "Movie night", tone: "pink", shape: "star", rows: [row(living, "brightness", 20), row(blind, "close"), ...(tv ? [row(tv, "on")] : [])], kind: custom },
    { name: "Good morning", tone: "yellow", shape: "flower", rows: [row(blind, "open"), row(living, "brightness", 80)], kind: custom },
    { name: "Good night", tone: "lavender", shape: "cloud", rows: allGroups.length ? allGroups.map((id) => row(id, "off")) : [row("", "")], kind: custom },
    { name: "Dinner", tone: "peach", shape: "circle", rows: [row(living, "brightness", 55)], kind: custom },
  ];
}

export default function ScenesPage() {
  const { scenes, devices, commands, playScene } = useHome();
  const [draft, setDraft] = useState<Draft | null>(null);
  const existing = new Set(scenes.map((s) => s.name.toLowerCase()));
  const hasAllOff = scenes.some((s) => s.kind === "all_off");
  const suggestions = ideas(devices).filter((i) => !existing.has(i.name.toLowerCase()) && !(i.kind === "all_off" && hasAllOff));

  return (
    <main className="page">
      <PageHeader
        title="Scenes"
        subtitle="Tap a scene to set the mood"
        action={
          <button className="pill" onClick={() => setDraft(emptyDraft(scenes.length))}>
            <Icon name="plus" size={18} /> New
          </button>
        }
      />

      {scenes.length === 0 && (
        <div className="scene-empty">
          <SceneArt shape="star" tone="pink" awake={false} size={96} />
          <p>
            <strong>No scenes yet.</strong> A scene sets several devices at once, like dimmed lights, blinds down and the TV on for movie night.
          </p>
        </div>
      )}

      <div className="scene-grid">
        {scenes.map((s, i) => {
          const on = sceneIsOn(s, devices, commands);
          const playing = scenePlaying(s, commands);
          const count = s.actions.length;
          return (
            <article
              key={s.id}
              className={`scene-card tone-${s.tone}${on || playing ? ` on ${i % 2 ? "tilt-r" : "tilt-l"}` : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`Play ${s.name}`}
              onClick={() => playScene(s)}
              onKeyDown={(e) => e.key === "Enter" && playScene(s)}
            >
              <button
                className="scene-edit"
                aria-label={`Edit ${s.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setDraft(toDraft(s));
                }}
              >
                <Icon name="pencil" size={16} />
              </button>
              <div className="scene-face">
                <SceneArt shape={s.shape} tone={on || playing ? "paper" : s.tone} awake={on || playing} />
              </div>
              <h3>{s.name}</h3>
              <div className="scene-meta">
                {playing ? (
                  <span className="scene-badge">
                    <span className="spinner light" /> Setting…
                  </span>
                ) : on ? (
                  <span className="scene-badge">
                    <Icon name="check" size={14} stroke={3} /> On
                  </span>
                ) : (
                  <span className="muted small">
                    {s.kind === "all_off" ? "Everything" : `${count} ${count === 1 ? "device" : "devices"}`} ·{" "}
                    {s.last_run_at ? timeAgo(s.last_run_at) : "never played"}
                  </span>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {suggestions.length > 0 && (
        <section className="section">
          <h2 className="section-title">Ideas</h2>
          <div className="chips">
            {suggestions.map((i) => (
              <button key={i.name} className={`chip tone-${i.tone}`} onClick={() => setDraft(i)}>
                <Icon name="plus" size={16} /> {i.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {draft && <Editor initial={draft} onClose={() => setDraft(null)} />}
    </main>
  );
}

function Editor({ initial, onClose }: { initial: Draft; onClose: () => void }) {
  const { devices, scenes, saveScene, deleteScene, send, playScene } = useHome();
  const allOff = initial.kind === "all_off";
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  async function save() {
    if (!draft.name.trim()) return setError("Give your scene a name.");
    const actions = allOff ? [] : buildActions(draft.rows, devices);
    if (typeof actions === "string") return setError(actions);
    setSaving(true);
    const err = await saveScene({ id: draft.id, name: draft.name, tone: draft.tone, shape: draft.shape, actions, kind: draft.kind });
    setSaving(false);
    if (err) setError(err);
    else onClose();
  }

  // Try the devices out before saving.
  async function preview() {
    if (allOff) {
      const saved = scenes.find((s) => s.id === draft.id);
      if (saved) await playScene(saved);
      else setError("Create the scene first, then play it.");
      return;
    }
    const actions = buildActions(draft.rows, devices);
    if (typeof actions === "string") return setError(actions);
    setError(null);
    for (const a of actions) {
      const device = devices.find((d) => d.id === a.device_id);
      if (device) await send(device, a.action, a.params);
    }
  }

  async function remove() {
    if (!draft.id || !confirm(`Delete "${draft.name}"?`)) return;
    const err = await deleteScene(draft.id);
    if (err) setError(err);
    else onClose();
  }

  return (
    <Sheet open onClose={onClose} title={draft.id ? "Edit scene" : "New scene"} tone={draft.tone}>
      <div className="editor">
        <div className={`scene-studio tone-${draft.tone}`}>
          <SceneArt shape={draft.shape} tone={draft.tone} awake size={110} />
          <div className="studio-pickers">
            <div className="shape-picker" role="radiogroup" aria-label="Character">
              {SCENE_SHAPES.map((shape) => (
                <button
                  key={shape}
                  role="radio"
                  aria-checked={draft.shape === shape}
                  aria-label={shape}
                  className={draft.shape === shape ? "selected" : ""}
                  onClick={() => set({ shape })}
                >
                  <SceneArt shape={shape} tone="ink" awake={false} size={30} />
                </button>
              ))}
            </div>
            <div className="tone-picker" role="radiogroup" aria-label="Colour">
              {TONES.map((tone) => (
                <button
                  key={tone}
                  role="radio"
                  aria-checked={draft.tone === tone}
                  aria-label={tone}
                  className={`tone-${tone}${draft.tone === tone ? " selected" : ""}`}
                  onClick={() => set({ tone })}
                />
              ))}
            </div>
          </div>
        </div>

        <label className="field">
          <span>Name</span>
          <input value={draft.name} placeholder="e.g. Movie night" onChange={(e) => set({ name: e.target.value })} />
        </label>

        {allOff ? (
          <div className="block tone-sand">
            <span className="badge">Turns off</span>
            <p>
              Every light, plug and TV, music that&apos;s playing, and the floor heating. It looks at your devices when you
              play it, so new ones are always included. Blinds and the rest of the heating are left alone.
            </p>
          </div>
        ) : (
          <div className="block tone-sand">
            <span className="badge">Set these</span>
            <ActionRows rows={draft.rows} onChange={(rows) => set({ rows })} devices={devices} />
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <button className="pill wide big" disabled={saving} onClick={save}>
          {saving ? "Saving…" : draft.id ? "Save changes" : "Create scene"}
        </button>
        <div className="button-row">
          <button className="pill light" onClick={preview}>
            <Icon name="play" size={16} /> Try it
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
