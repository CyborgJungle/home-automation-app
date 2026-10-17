"use client";

import { useState } from "react";
import { DeviceSheet, DeviceTile } from "@/components/devices";
import { Blob, Icon } from "@/components/icons";
import { CATEGORIES, displayState, num, ON_PI } from "@/lib/devices";
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

export default function DevicesPage() {
  const { devices, commands, agentOnline, userName } = useHome();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = devices.find((d) => d.id === openId) ?? null;

  const lightsOn = devices.filter((d) => d.kind === "light" && d.online && displayState(d, commands).on).length;
  const temps = devices.filter((d) => d.kind === "zone").map((d) => num(d.state.temperature)).filter((t): t is number => t !== null);
  const avgTemp = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
  const blindsOpen = devices.filter((d) => d.kind === "blind" && num(d.state.position) !== null && num(d.state.position)! < 100).length;
  const piDevices = devices.some((d) => ON_PI.includes(d.integration));

  const sections = CATEGORIES.map((c) => ({
    ...c,
    devices: devices.filter((d) => c.kinds.includes(d.kind)).sort(byKindThenName),
  })).filter((c) => c.devices.length > 0);

  return (
    <main className="page">
      <header className="hello">
        <div className="hello-row">
          <Blob size={44} tone="var(--pink)" />
          <span className="muted">
            {greeting()}
            {userName ? `, ${userName.replace(/^./, (c) => c.toUpperCase())}` : ""}
          </span>
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
        {devices.some((d) => d.kind === "blind") && (
          <span className="chip tone-lavender">
            <Icon name="blind" size={16} /> {blindsOpen} open
          </span>
        )}
        {piDevices && (
          <span className={agentOnline ? "chip tone-sage" : "chip tone-red"}>
            <span className="dot" /> Pi {agentOnline ? "online" : "offline"}
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

      {sections.map((s) => (
        <section key={s.id} className="section">
          <h2 className="section-title">
            {s.title} <span className="count">{s.devices.length}</span>
          </h2>
          <div className="grid">
            {s.devices.map((d) => (
              <DeviceTile key={d.id} device={d} onOpen={() => setOpenId(d.id)} />
            ))}
          </div>
        </section>
      ))}

      <DeviceSheet device={open} onClose={() => setOpenId(null)} />
    </main>
  );
}
