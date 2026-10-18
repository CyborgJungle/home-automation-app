"use client";

import { useState, useSyncExternalStore } from "react";
import { DeviceSheet, DeviceTile } from "@/components/devices";
import { Blob, Icon } from "@/components/icons";
import { PiStatus } from "@/components/ui";
import { CATEGORIES, displayState, isActive, lowBattery, membersOf, num, ON_PI, type IconName } from "@/lib/devices";
import { useHome } from "@/lib/home";
import type { Device } from "@/lib/supabase";

function greeting() {
  const h = new Date().getHours();
  return h < 6 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

// Groups (whole rooms) before single lights, the heating system before its zones.
const KIND_ORDER = ["heating", "zone", "group", "light"];
const byKindThenName = (a: Device, b: Device) =>
  (KIND_ORDER.indexOf(a.kind) + 1 || 99) - (KIND_ORDER.indexOf(b.kind) + 1 || 99) || a.name.localeCompare(b.name);

const SECTION_ICONS: Record<string, IconName> = {
  climate: "thermo",
  lights: "bulb",
  plugs: "plug",
  blinds: "blind",
  media: "tv",
  doorbell: "bell",
  sensors: "sensor",
};

// Which groups are unfolded is remembered per phone, so Home opens the way
// you left it. Read through useSyncExternalStore so the server render (all
// folded) and the phone's saved choice never clash.
const OPEN_KEY = "home.open-sections";
const OPEN_EVENT = "home-open-sections";

function readOpen(): string {
  try {
    return localStorage.getItem(OPEN_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function subscribeOpen(onChange: () => void) {
  window.addEventListener(OPEN_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(OPEN_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function saveOpen(ids: string[]) {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(ids));
  } catch {
    // private mode or storage blocked; it just won't be remembered
  }
  window.dispatchEvent(new Event(OPEN_EVENT));
}

function parseOpen(raw: string): string[] {
  try {
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

// Lights by room: single lamps, lamp groups made in the app (whose lamps are
// then only shown inside the group), and plugs that have a lamp on them.
// Hub room groups aren't shown. Lamps that aren't in a room go under "Other".
function lightsByRoom(list: Device[]) {
  const grouped = new Set(list.flatMap(membersOf));
  const rooms = new Map<string, Device[]>();
  for (const d of list) {
    const shown = (d.kind === "light" && !grouped.has(d.id)) || membersOf(d).length > 0 || d.also_light;
    if (!shown) continue;
    const name = d.room ?? "Other";
    rooms.set(name, [...(rooms.get(name) ?? []), d]);
  }
  return [...rooms.entries()]
    .sort(([a], [b]) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)))
    .map(([name, lights]) => ({ name, lights: lights.sort((a, b) => a.name.localeCompare(b.name)) }));
}

// One line that says what's going on in a folded group.
function sectionSummary(id: string, list: Device[], commands: Parameters<typeof displayState>[1]) {
  const live = list.filter((d) => d.online);
  const states = live.map((d) => ({ d, s: displayState(d, commands) }));
  const count = (pred: (x: (typeof states)[number]) => boolean) => states.filter(pred).length;
  switch (id) {
    case "climate": {
      const temps = states.filter(({ d }) => d.kind === "zone").map(({ s }) => num(s.temperature)).filter((t): t is number => t !== null);
      return temps.length ? `${(temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1)}° average` : "No readings";
    }
    case "lights": {
      const on = count(({ d, s }) => d.kind === "light" && Boolean(s.on));
      return on ? `${on} on` : "All off";
    }
    case "plugs": {
      const on = count(({ s }) => Boolean(s.on));
      return on ? `${on} on` : "All off";
    }
    case "blinds": {
      const open = count(({ d, s }) => isActive(d, s));
      return open ? `${open} open` : "All closed";
    }
    case "media": {
      const on = count(({ s }) => Boolean(s.on));
      return on ? `${on} on` : "Standby";
    }
    case "sensors": {
      const low = count(({ s }) => lowBattery(s));
      return low ? `${low} low battery` : "All good";
    }
    default:
      return live.length < list.length ? `${list.length - live.length} offline` : "All good";
  }
}

export default function DevicesPage() {
  const { devices, commands, agentOnline, userName } = useHome();
  const [openId, setOpenId] = useState<string | null>(null);
  const openSections = parseOpen(useSyncExternalStore(subscribeOpen, readOpen, () => "[]"));
  const toggleSection = (id: string) =>
    saveOpen(openSections.includes(id) ? openSections.filter((x) => x !== id) : [...openSections, id]);
  const open = devices.find((d) => d.id === openId) ?? null;

  const lightsOn = devices.filter((d) => d.kind === "light" && d.online && displayState(d, commands).on).length;
  const temps = devices.filter((d) => d.kind === "zone").map((d) => num(d.state.temperature)).filter((t): t is number => t !== null);
  const avgTemp = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
  const piDevices = devices.some((d) => ON_PI.includes(d.integration));

  const sections = CATEGORIES.map((c) => ({
    ...c,
    // Plugs with a lamp on them show under Lights too.
    devices: devices.filter((d) => c.kinds.includes(d.kind) || (c.id === "lights" && d.also_light)).sort(byKindThenName),
  })).filter((c) => c.devices.length > 0);

  return (
    <main className="page">
      <header className="hello">
        <div className="hello-row">
          <Blob size={44} tone="var(--pink)" idle />
          <span className="muted">
            {greeting()}
            {userName ? `, ${userName.replace(/^./, (c) => c.toUpperCase())}` : ""}
          </span>
          <PiStatus inline />
        </div>
        <h1 className="display">
          Here&apos;s your
          <br />
          home today
        </h1>
      </header>

      <div className="chips scroll">
        <span className="chip tone-yellow">
          <Icon name="bulb" size={16} /> {lightsOn} {lightsOn === 1 ? "light" : "lights"} on
        </span>
        {avgTemp !== null && (
          <span className="chip tone-peach">
            <Icon name="thermo" size={16} /> {avgTemp.toFixed(1)}° inside
          </span>
        )}
      </div>

      {piDevices && !agentOnline && (
        <div className="banner">
          <Blob size={40} tone="var(--peach)" look="up" />
          <p>
            <strong>The Raspberry Pi is offline.</strong> Lights, blinds and the TV can&apos;t be controlled until it&apos;s back.
          </p>
        </div>
      )}

      {sections.length === 0 && (
        <div className="empty">
          <Blob size={88} tone="var(--yellow)" look="up" />
          <p>No devices yet. They show up here as soon as the Pi or Honeywell reports them.</p>
        </div>
      )}

      <div className="groups">
        {sections.map((s) => {
          const unfolded = openSections.includes(s.id);
          const warn = s.id === "sensors" && s.devices.some((d) => lowBattery(d.state));
          return (
            <section key={s.id} className={`group tone-${s.tone}${unfolded ? " open" : ""}`}>
              <button
                className="group-head"
                aria-expanded={unfolded}
                aria-controls={`group-${s.id}`}
                onClick={() => toggleSection(s.id)}
              >
                <span className="group-icon">
                  <Icon name={SECTION_ICONS[s.id] ?? "sensor"} size={20} />
                </span>
                <span className="group-text">
                  <strong>
                    {s.title}{" "}
                    <span className="count">{s.id === "lights" ? lightsByRoom(s.devices).reduce((n, r) => n + r.lights.length, 0) : s.devices.length}</span>
                  </strong>
                  <span className={warn ? "warn" : undefined}>{sectionSummary(s.id, s.devices, commands)}</span>
                </span>
                <span className="group-chevron">
                  <Icon name="down" size={18} stroke={2.6} />
                </span>
              </button>
              {unfolded && s.id === "lights" && (
                <div className="rooms" id={`group-${s.id}`}>
                  {lightsByRoom(s.devices).map((r) => {
                    const on = r.lights.filter((d) => d.online && displayState(d, commands).on).length;
                    return (
                      <div key={r.name} className="room">
                        <h3 className="room-title">
                          {r.name}
                          {r.lights.length > 0 && <span>{on ? `${on} of ${r.lights.length} on` : "off"}</span>}
                        </h3>
                        <div className="grid">
                          {r.lights.map((d) => (
                            <DeviceTile key={d.id} device={d} icon={d.also_light ? "bulb" : undefined} tone={d.also_light ? "yellow" : undefined} onOpen={() => setOpenId(d.id)} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {unfolded && s.id !== "lights" && (
                <div className="grid" id={`group-${s.id}`}>
                  {s.devices.map((d) => (
                    <DeviceTile key={d.id} device={d} onOpen={() => setOpenId(d.id)} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <DeviceSheet device={open} onClose={() => setOpenId(null)} />
    </main>
  );
}
