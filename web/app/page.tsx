"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  createClient,
  type AgentStatus,
  type Command,
  type Device,
  type HomeEvent,
  type IntegrationStatus,
} from "@/lib/supabase";

// The agent writes a heartbeat every 30s.
const AGENT_OFFLINE_AFTER_MS = 90_000;

// evohome runs in Supabase; the rest needs the Pi on the home network.
const SECTIONS: { integration: Device["integration"]; title: string; onPi: boolean }[] = [
  { integration: "tradfri", title: "IKEA TRÅDFRI", onPi: true },
  { integration: "evohome", title: "Honeywell evohome", onPi: false },
  { integration: "eufy", title: "Eufy", onPi: true },
  { integration: "brel", title: "Brel Home blinds", onPi: true },
  { integration: "bravia", title: "Sony TV", onPi: true },
];

function time(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "–";
}

function describe(d: Device) {
  const s = d.state as Record<string, string | number | boolean | null | undefined>;
  switch (d.kind) {
    case "light":
    case "plug":
    case "group":
      return [s.on ? "On" : "Off", s.brightness != null && s.on ? `${s.brightness}%` : null, s.lights ? `${s.lights} lights` : null]
        .filter(Boolean)
        .join(" · ");
    case "zone":
      return [
        s.temperature != null ? `${s.temperature} °C` : "no reading",
        s.setpoint != null ? `set to ${s.setpoint} °C` : null,
        s.mode && s.mode !== "FollowSchedule" ? `override${s.until ? ` until ${time(String(s.until))}` : ""}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    case "heating":
      return `Mode: ${s.mode ?? "unknown"}${s.faults ? ` · ${s.faults} fault(s)` : ""}`;
    case "blind": {
      const where =
        s.position == null
          ? s.reports_position === false
            ? "this motor doesn't report its position"
            : "position unknown"
          : s.position === 0
            ? "Open"
            : s.position === 100
              ? "Closed"
              : `${100 - Number(s.position)}% open`;
      return [where, s.moving ? "moving" : null, s.battery_v != null ? `Battery ${s.battery_v} V` : null]
        .filter(Boolean)
        .join(" · ");
    }
    case "tv":
      return s.on
        ? ["On", s.playing, s.volume != null ? `Volume ${s.volume}${s.muted ? " (muted)" : ""}` : null].filter(Boolean).join(" · ")
        : "Standby";
    case "doorbell":
      return [s.battery != null ? `Battery ${s.battery}%` : null, `Last ring: ${s.last_ring_at ? new Date(String(s.last_ring_at)).toLocaleString() : "–"}`]
        .filter(Boolean)
        .join(" · ");
    default:
      return s.battery != null ? `Battery ${s.battery}%` : "";
  }
}

// A few test actions per device, enough to see that it responds.
type TestAction = { label: string; action: string; params: Record<string, unknown> };

function testActions(d: Device): TestAction[] {
  const s = d.state as Record<string, unknown>;
  if (d.kind === "light" || d.kind === "plug" || d.kind === "group") {
    return [{ label: s.on ? "Turn off" : "Turn on", action: "set", params: { on: !s.on } }];
  }
  if (d.kind === "blind" && d.integration === "brel") {
    return [
      { label: "Open", action: "open", params: {} },
      { label: "Stop", action: "stop", params: {} },
      { label: "Close", action: "close", params: {} },
    ];
  }
  if (d.kind === "blind") {
    return [
      { label: "Open", action: "set", params: { position: 0 } },
      { label: "Close", action: "set", params: { position: 100 } },
    ];
  }
  if (d.kind === "tv") {
    if (!s.on) return [{ label: "Turn on", action: "power", params: { on: true } }];
    return [
      { label: "Turn off", action: "power", params: { on: false } },
      { label: "Vol −", action: "volume", params: { delta: -2 } },
      { label: "Vol +", action: "volume", params: { delta: 2 } },
      { label: s.muted ? "Unmute" : "Mute", action: "mute", params: { on: !s.muted } },
    ];
  }
  if (d.kind === "zone" && typeof s.setpoint === "number") {
    const actions: TestAction[] = [
      { label: "+1 °C for 30 min", action: "set_temperature", params: { setpoint: s.setpoint + 1, minutes: 30 } },
    ];
    if (s.mode !== "FollowSchedule") actions.push({ label: "Resume schedule", action: "follow_schedule", params: {} });
    return actions;
  }
  return [];
}

export default function Dashboard() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [member, setMember] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [commands, setCommands] = useState<Command[]>([]);
  const [events, setEvents] = useState<HomeEvent[]>([]);
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const [statuses, setStatuses] = useState<IntegrationStatus[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data: isMember } = await supabase.rpc("am_i_member");
      if (cancelled) return;
      setMember(Boolean(isMember));
      if (!isMember) return;

      const [d, c, e, a, s] = await Promise.all([
        supabase.from("devices").select("*").order("room").order("name"),
        supabase.from("commands").select("*").order("created_at", { ascending: false }).limit(15),
        supabase.from("events").select("*").order("created_at", { ascending: false }).limit(10),
        supabase.from("agent_status").select("*").maybeSingle(),
        supabase.from("integration_status").select("*"),
      ]);
      if (cancelled) return;
      setDevices(d.data ?? []);
      setCommands(c.data ?? []);
      setEvents(e.data ?? []);
      setAgent(a.data);
      setStatuses(s.data ?? []);
    }

    load();

    const channel = supabase
      .channel("dashboard")
      .on<Device>("postgres_changes", { event: "*", schema: "public", table: "devices" }, (p) => {
        if (p.eventType === "DELETE") return;
        setDevices((list) => [...list.filter((x) => x.id !== p.new.id), p.new]);
      })
      .on<Command>("postgres_changes", { event: "*", schema: "public", table: "commands" }, (p) => {
        if (p.eventType === "DELETE") return;
        setCommands((list) =>
          [p.new, ...list.filter((x) => x.id !== p.new.id)].sort((a, b) => b.id - a.id).slice(0, 15),
        );
      })
      .on<HomeEvent>("postgres_changes", { event: "INSERT", schema: "public", table: "events" }, (p) => {
        setEvents((list) => [p.new, ...list].slice(0, 10));
      })
      .on<AgentStatus>("postgres_changes", { event: "*", schema: "public", table: "agent_status" }, (p) => {
        if (p.eventType !== "DELETE") setAgent(p.new);
      })
      .on<IntegrationStatus>("postgres_changes", { event: "*", schema: "public", table: "integration_status" }, (p) => {
        if (p.eventType === "DELETE") return;
        setStatuses((list) => [...list.filter((x) => x.name !== p.new.name), p.new]);
      })
      .subscribe();

    const tick = setInterval(() => setNow(Date.now()), 10_000);
    return () => {
      cancelled = true;
      clearInterval(tick);
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  async function send(device: Device, action: string, params: Record<string, unknown>) {
    setSendError(null);
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("commands")
      .insert({ device_id: device.id, action, params, created_by: auth.user?.id });
    if (error) setSendError(error.message);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const agentOnline = agent?.last_seen != null && now - Date.parse(agent.last_seen) < AGENT_OFFLINE_AFTER_MS;
  const nameOf = (id: string | null) => devices.find((d) => d.id === id)?.name ?? id ?? "–";
  const sorted = [...devices].sort(
    (a, b) => (a.room ?? "").localeCompare(b.room ?? "") || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
  );

  if (member === false) {
    return (
      <main>
        <header>
          <h1>Home</h1>
          <button onClick={signOut}>Sign out</button>
        </header>
        <p>Your email isn&apos;t on the household list yet. Ask the owner to add it in Supabase.</p>
      </main>
    );
  }

  return (
    <main>
      <header>
        <h1>Home</h1>
        <button onClick={signOut}>Sign out</button>
      </header>

      <h2>Raspberry Pi agent</h2>
      <ul className="list">
        <li>
          <span className="grow">
            <strong className={agentOnline ? "ok" : "bad"}>{agentOnline ? "Online" : "Offline"}</strong>
            <span className="muted"> · last seen {time(agent?.last_seen)}{agent?.version ? ` · v${agent.version}` : ""}</span>
          </span>
        </li>
      </ul>

      {sendError && <p className="bad">Couldn&apos;t send: {sendError}</p>}

      {SECTIONS.map(({ integration, title, onPi }) => {
        const list = sorted.filter((d) => d.integration === integration);
        const status = statuses.find((s) => s.name === integration);
        const reachable = (onPi ? agentOnline : true) && status?.ok === true;
        return (
          <section key={integration}>
            <h2>{title}</h2>
            <p className="muted">
              {status ? (
                <span className={status.ok ? "ok" : "bad"}>{status.ok ? "● Connected" : `○ ${status.error ?? "Not connected"}`}</span>
              ) : (
                "○ Not set up yet"
              )}
              {" · "}runs on {onPi ? "the Raspberry Pi" : "Supabase"}
            </p>
            {list.length === 0 ? (
              <p className="muted">No devices reported yet.</p>
            ) : (
              <ul className="list">
                {list.map((d) => {
                  const busy = commands.some(
                    (c) => c.device_id === d.id && (c.status === "pending" || c.status === "running"),
                  );
                  return (
                    <li key={d.id}>
                      <span className="grow">
                        <strong>{d.name}</strong>
                        {d.room && d.room !== d.name && <span className="muted"> · {d.room}</span>}
                        {!d.online && <span className="bad"> · unreachable</span>}
                        <div className="muted">
                          {d.kind} · {describe(d)}
                        </div>
                      </span>
                      <span className="actions">
                        {testActions(d).map((a) => (
                          <button key={a.label} disabled={busy || !reachable} onClick={() => send(d, a.action, a.params)}>
                            {busy ? "…" : a.label}
                          </button>
                        ))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      <h2>Command log</h2>
      {commands.length === 0 ? (
        <p className="muted">Nothing sent yet.</p>
      ) : (
        <ul className="list">
          {commands.map((c) => (
            <li key={c.id}>
              <span className="grow">
                {nameOf(c.device_id)} <span className="mono">{c.action} {JSON.stringify(c.params)}</span>
                {c.error && <div className="muted bad">{c.error}</div>}
              </span>
              <span className={c.status === "done" ? "ok" : c.status === "failed" ? "bad" : "wait"}>
                {c.status}
                {c.completed_at && (
                  <span className="muted"> {((Date.parse(c.completed_at) - Date.parse(c.created_at)) / 1000).toFixed(1)}s</span>
                )}
              </span>
              <span className="muted">{time(c.created_at)}</span>
            </li>
          ))}
        </ul>
      )}

      <h2>Events</h2>
      {events.length === 0 ? (
        <p className="muted">No events yet. Ring the doorbell to test.</p>
      ) : (
        <ul className="list">
          {events.map((e) => (
            <li key={e.id}>
              <span className="grow">
                {e.type === "doorbell.ring" ? "Doorbell rang" : e.type} <span className="muted">· {nameOf(e.device_id)}</span>
              </span>
              <span className="muted">{new Date(e.created_at).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
