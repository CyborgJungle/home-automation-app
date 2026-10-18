"use client";

import { useState } from "react";
import { ActionRows, type ActionRow } from "@/components/actions";
import {
  AutomationRuleFields,
  categoryInfo,
} from "@/components/automation-rule";
import { Blob, Icon } from "@/components/icons";
import { PageHeader, Sheet, Switch, timeAgo } from "@/components/ui";
import { describeTrigger, summary } from "@/lib/automations";
import {
  build,
  emptyDraft,
  emptyRule,
  toDraft,
  type AutomationDraft,
  type RuleDraft,
} from "@/lib/automation-draft";
import { useHome } from "@/lib/home";
import type { Device } from "@/lib/supabase";

function ideas(
  devices: Device[],
): { title: string; tone: string; draft: AutomationDraft }[] {
  const find = (pred: (d: Device) => boolean) => devices.find(pred)?.id ?? "";
  const blind = find((d) => d.kind === "blind");
  const hall =
    find((d) => d.kind === "light" && /gang|hal|hall/i.test(d.name)) ||
    find((d) => d.kind === "light");
  const living =
    find((d) => d.kind === "group" && /woon|living/i.test(d.name)) ||
    find((d) => d.kind === "group");
  const tv = find((d) => d.kind === "tv");
  const sensor = devices.find((d) => d.kind === "sensor" && typeof d.state.motion === "boolean");
  const near = (sensor && find((d) => d.kind === "light" && d.room === sensor.room)) || hall;
  const draft = (
    name: string,
    rule: Partial<RuleDraft>,
    action: ActionRow,
  ): AutomationDraft => ({
    ...emptyDraft(),
    name,
    blocks: [{ join: "and", rule: { ...emptyRule(), ...rule } }],
    actions: [action],
  });
  return [
    ...(sensor
      ? [
          {
            title: "Motion → light on, off 5 min after it stops",
            tone: "sky",
            draft: draft(
              "Motion light",
              { when: "device", device: sensor.id, option: "motion" },
              { device_id: near, option: near ? "on_for" : "", value: 5 },
            ),
          },
        ]
      : []),
    {
      title: "30 min before sunset → living-room lights on",
      tone: "yellow",
      draft: draft(
        "Evening lights",
        { when: "sun", days: [0, 1, 2, 3, 4, 5, 6], sunOffset: -30 },
        { device_id: living, option: living ? "on" : "", value: null },
      ),
    },
    {
      title: "Open the blinds on weekday mornings",
      tone: "lavender",
      draft: draft(
        "Morning blinds",
        {},
        { device_id: blind, option: blind ? "open" : "", value: null },
      ),
    },
    {
      title: "Doorbell rings → hall light on",
      tone: "sage",
      draft: draft(
        "Doorbell light",
        { when: "event", option: "ring" },
        { device_id: hall, option: hall ? "on" : "", value: null },
      ),
    },
    {
      title: "TV on → dim the living room",
      tone: "pink",
      draft: draft(
        "Movie mode",
        { when: "device", device: tv, option: tv ? "on" : "" },
        { device_id: living, option: living ? "brightness" : "", value: 25 },
      ),
    },
  ];
}

export default function AutomationsPage() {
  const { automations, devices, scenes, setAutomationEnabled } = useHome();
  const [draft, setDraft] = useState<AutomationDraft | null>(null);
  return (
    <main className="page automation-page">
      <PageHeader
        title="Automations"
        subtitle="Let your home run itself"
        action={
          <button className="pill" onClick={() => setDraft(emptyDraft())}>
            <Icon name="plus" size={18} /> New
          </button>
        }
      />
      {automations.length === 0 && (
        <div className="empty left">
          <Blob size={72} tone="var(--lavender)" look="right" />
          <p>
            <strong>No automations yet.</strong> Choose when things happen and
            what your home should do. Rules work with the app closed.
          </p>
        </div>
      )}
      <div className="stack">
        {automations.map((a) => {
          const { when, then } = summary(a, devices, scenes);
          const info = categoryInfo(toDraft(a, devices).blocks[0].rule);
          return (
            <article
              key={a.id}
              className={`auto-card tone-${info.tone}${a.enabled ? "" : " disabled"}`}
              role="button"
              tabIndex={0}
              onClick={() => setDraft(toDraft(a, devices))}
              onKeyDown={(e) =>
                e.key === "Enter" && setDraft(toDraft(a, devices))
              }
            >
              <div className="auto-top">
                <span className="auto-icon">
                  <Icon name={info.icon} size={18} />
                </span>
                <Switch
                  on={a.enabled}
                  label={`${a.name} on/off`}
                  onChange={(on) => setAutomationEnabled(a.id, on)}
                />
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
          {ideas(devices).map((idea) => (
            <button
              key={idea.title}
              className={`idea tone-${idea.tone}`}
              onClick={() => setDraft(idea.draft)}
            >
              <span>{idea.title}</span>
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

function Editor({
  initial,
  onClose,
}: {
  initial: AutomationDraft;
  onClose: () => void;
}) {
  const { devices, scenes, saveAutomation, deleteAutomation, send, playScene } =
    useHome();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const set = (patch: Partial<AutomationDraft>) =>
    setDraft((d) => ({ ...d, ...patch }));
  const info = categoryInfo(draft.blocks[0].rule);
  const usesWeather = draft.blocks.some(
    (block) => categoryInfo(block.rule).id === "weather",
  );

  async function save() {
    const built = build(draft, devices, scenes);
    if (typeof built === "string") return setError(built);
    setSaving(true);
    const name = draft.name.trim() || describeTrigger(built.trigger, devices);
    const err = await saveAutomation({
      id: draft.id,
      name,
      enabled: draft.enabled,
      ...built,
    });
    setSaving(false);
    if (err) setError(err);
    else onClose();
  }
  async function runNow() {
    const built = build(draft, devices, scenes);
    if (typeof built === "string") return setError(built);
    for (const action of built.actions) {
      const scene =
        action.scene_id && scenes.find((s) => s.id === action.scene_id);
      const device = devices.find((d) => d.id === action.device_id);
      if (scene) await playScene(scene);
      else if (device) await send(device, action.action, action.params);
    }
  }
  async function remove() {
    if (!draft.id || !confirm(`Delete "${draft.name}"?`)) return;
    const err = await deleteAutomation(draft.id);
    if (err) setError(err);
    else onClose();
  }
  function add(join: "and" | "or") {
    set({ blocks: [...draft.blocks, { join, rule: emptyRule("device") }] });
    setAdding(false);
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={draft.id ? "Edit automation" : "New automation"}
      tone={info.tone}
    >
      <div className="editor">
        <label className="field">
          <span>Name</span>
          <input
            value={draft.name}
            placeholder="e.g. Morning blinds"
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>

        <div className="rule-flow">
          {draft.blocks.map((block, index) => (
            <div
              key={index}
              className={
                index > 0 && block.join === "or"
                  ? "rule-step alternative"
                  : "rule-step"
              }
            >
              <section
                className={`block tone-${categoryInfo(block.rule).tone}`}
                aria-label={`${index === 0 ? "When" : block.join === "and" ? "And" : "Or"} block ${index + 1}`}
              >
                <div className="rule-head">
                  {index === 0 ? (
                    <span className="badge">When</span>
                  ) : (
                    <div
                      className="rule-join"
                      role="radiogroup"
                      aria-label={`Join block ${index + 1}`}
                    >
                      {(["and", "or"] as const).map((join) => (
                        <button
                          type="button"
                          key={join}
                          role="radio"
                          aria-checked={block.join === join}
                          className={block.join === join ? "selected" : ""}
                          onClick={() =>
                            set({
                              blocks: draft.blocks.map((b, i) =>
                                i === index ? { ...b, join } : b,
                              ),
                            })
                          }
                        >
                          {join === "and" ? "And" : "Or"}
                        </button>
                      ))}
                    </div>
                  )}
                  {index > 0 && (
                    <button
                      type="button"
                      className="round small"
                      aria-label={`Remove block ${index + 1}`}
                      onClick={() =>
                        set({
                          blocks: draft.blocks.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <Icon name="close" size={16} />
                    </button>
                  )}
                </div>
                <AutomationRuleFields
                  rule={block.rule}
                  devices={devices}
                  onChange={(rule) =>
                    set({
                      blocks: draft.blocks.map((b, i) =>
                        i === index ? { ...b, rule } : b,
                      ),
                    })
                  }
                />
              </section>
            </div>
          ))}
        </div>

        {draft.blocks.length < 12 && (
          <div className="rule-add">
            {adding ? (
              <div className="rule-add-options">
                <button className="pill light" onClick={() => add("and")}>
                  <Icon name="plus" size={15} /> And
                </button>
                <button className="pill light" onClick={() => add("or")}>
                  <Icon name="plus" size={15} /> Or
                </button>
                <button
                  className="round small"
                  aria-label="Cancel adding a block"
                  onClick={() => setAdding(false)}
                >
                  <Icon name="close" size={15} />
                </button>
                <p className="muted small">
                  And adds a check. Or starts another way to run.
                </p>
              </div>
            ) : (
              <button
                className="pill light small"
                onClick={() => setAdding(true)}
              >
                <Icon name="plus" size={16} /> Add And / Or
              </button>
            )}
          </div>
        )}

        {draft.blocks.length > 1 && (
          <p className="muted small">
            And blocks must match together. Each Or starts a new group.
          </p>
        )}
        {usesWeather && (
          <p className="muted small">
            Weather by{" "}
            <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
              Open-Meteo
            </a>
            , checked every 15 minutes. Missing or stale readings never match.
          </p>
        )}

        <div className="block tone-mint">
          <span className="badge">Then</span>
          <ActionRows
            rows={draft.actions}
            onChange={(actions) => set({ actions })}
            devices={devices}
            scenes={scenes}
            timed
          />
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
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
        <p className="muted small">
          Run now plays the actions immediately, without checking the rule.
        </p>
      </div>
    </Sheet>
  );
}
