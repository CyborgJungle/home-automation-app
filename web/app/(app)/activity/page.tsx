"use client";

import { useState } from "react";
import { INTEGRATION_NAMES } from "@/components/devices";
import { Blob, Icon } from "@/components/icons";
import { timeAgo } from "@/components/ui";
import { useHome } from "@/lib/home";
import type { Device } from "@/lib/supabase";

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

// Health checks run on the Pi except evohome, which runs in Supabase.
const WHERE: Record<Device["integration"], string> = {
  tradfri: "Pi",
  brel: "Pi",
  bravia: "Pi",
  sonos: "Pi",
  eufy: "Pi",
  evohome: "Cloud",
};

export default function ActivityPage() {
  const { agent, agentOnline, statuses, commands, events, devices, automations, scenes, userEmail, signOut } = useHome();
  const nameOf = (id: string | null) => devices.find((d) => d.id === id)?.name ?? id ?? "–";
  const [showTimeline, setShowTimeline] = useState(false);

  type Item = { key: string; at: string; title: string; detail: string; tone: string; status?: string };
  const items: Item[] = [
    ...commands.map((c) => {
      const automation = c.source?.startsWith("automation:") ? automations.find((a) => `automation:${a.id}` === c.source) : null;
      const scene = c.source?.startsWith("scene:") ? scenes.find((s) => `scene:${s.id}` === c.source) : null;
      const took = c.completed_at ? ` · ${((Date.parse(c.completed_at) - Date.parse(c.created_at)) / 1000).toFixed(1)}s` : "";
      return {
        key: `c${c.id}`,
        at: c.created_at,
        title: nameOf(c.device_id),
        detail: `${c.action} ${Object.entries(c.params ?? {}).map(([k, v]) => `${k} ${v}`).join(", ")}${took}${automation ? ` · by “${automation.name}”` : ""}${scene ? ` · scene “${scene.name}”` : ""}${c.error ? ` · ${c.error}` : ""}`,
        tone: c.status === "failed" ? "red" : automation ? "lavender" : scene ? "pink" : "sand",
        status: c.status,
      };
    }),
    ...events.map((e) => ({
      key: `e${e.id}`,
      at: e.created_at,
      title:
        e.type === "doorbell.ring"
          ? "Doorbell rang"
          : e.type === "automation.run"
            ? `Ran “${String(e.data.name ?? "automation")}”`
            : e.type === "scene.run"
              ? `Played “${String(e.data.name ?? "scene")}”`
              : e.type,
      detail:
        e.type === "doorbell.ring"
          ? nameOf(e.device_id)
          : e.type === "automation.run"
            ? `Started by ${String(e.data.cause ?? "a trigger")}`
            : e.type === "scene.run"
              ? String(e.data.source ?? "").startsWith("automation:")
                ? `By automation “${automations.find((a) => `automation:${a.id}` === e.data.source)?.name ?? "removed"}”`
                : "From the app"
              : "",
      tone: e.type === "doorbell.ring" ? "sage" : e.type === "scene.run" ? "pink" : "lavender",
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <main className="page">
      <header className="title-row">
        <h1 className="display">Activity</h1>
      </header>

      <div className={`hero-card ${agentOnline ? "tone-sage" : "tone-peach"}`}>
        <Blob size={56} tone={agentOnline ? "var(--ink)" : "var(--red)"} look={agentOnline ? "right" : "up"} />
        <div>
          <strong>Raspberry Pi {agentOnline ? "is online" : "is offline"}</strong>
          <p>
            Last check-in {timeAgo(agent?.last_seen)}
            {agent?.version ? ` · agent v${agent.version}` : ""}
          </p>
        </div>
      </div>

      <section className="section">
        <h2 className="section-title">Connections</h2>
        <div className="list-card">
          {statuses
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((s) => {
              const ok = s.ok && (WHERE[s.name] === "Cloud" || agentOnline);
              return (
                <div key={s.name} className="list-row">
                  <span className={ok ? "dot ok" : "dot bad"} />
                  <span className="grow">
                    <strong>{INTEGRATION_NAMES[s.name] ?? s.name}</strong>
                    <span className="muted small sub">{ok ? `Connected · runs on ${WHERE[s.name] === "Cloud" ? "Supabase" : "the Pi"}` : s.error ?? "Not connected"}</span>
                  </span>
                  <span className="muted small">{timeAgo(s.updated_at)}</span>
                </div>
              );
            })}
        </div>
      </section>

      <section className={`group tone-sand timeline-group${showTimeline ? " open" : ""}`}>
        <button className="group-head" aria-expanded={showTimeline} aria-controls="timeline" onClick={() => setShowTimeline((v) => !v)}>
          <span className="group-icon">
            <Icon name="clock" size={20} />
          </span>
          <span className="group-text">
            <strong>
              Timeline <span className="count">{items.length}</span>
            </strong>
            <span>{items.length ? `Latest: ${items[0].title} at ${clock(items[0].at)}` : "Nothing has happened yet"}</span>
          </span>
          <span className="group-chevron">
            <Icon name="down" size={18} stroke={2.6} />
          </span>
        </button>
        {showTimeline && items.length > 0 && (
          <div className="timeline" id="timeline">
            {items.map((i) => (
              <div key={i.key} className="event">
                <span className={`event-dot tone-${i.tone}`} />
                <div className="grow">
                  <strong>{i.title}</strong>
                  <span className="muted small sub">{i.detail}</span>
                </div>
                <div className="event-side">
                  <span className="muted small">{clock(i.at)}</span>
                  {i.status && <span className={`status ${i.status}`}>{i.status}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <div className="list-card">
          <div className="list-row">
            <span className="grow">
              <span className="muted small sub">Signed in as</span>
              <strong>{userEmail}</strong>
            </span>
            <button className="pill light small" onClick={signOut}>
              <Icon name="logout" size={16} /> Sign out
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
