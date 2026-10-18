"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { Picker } from "@/components/picker";
import { Sheet, Slider, Switch, timeAgo } from "@/components/ui";
import {
  describe,
  displayState,
  iconOf,
  floorOf,
  isActive,
  isOpen,
  lowBattery,
  modeLabel,
  num,
  ON_PI,
  tapAction,
  toneOf,
} from "@/lib/devices";
import { useHome } from "@/lib/home";
import type { Device } from "@/lib/supabase";

export const INTEGRATION_NAMES: Record<Device["integration"], string> = {
  dirigera: "IKEA DIRIGERA",
  tradfri: "IKEA TRÅDFRI",
  evohome: "Honeywell evohome",
  eufy: "Eufy",
  brel: "Brel Home",
  bravia: "Sony BRAVIA",
  sonos: "Sonos",
  apple: "Apple",
};

function useDevice(d: Device) {
  const { commands, agentOnline, send } = useHome();
  const state = displayState(d, commands);
  const busy = commands.some((c) => c.device_id === d.id && isOpen(c));
  const reachable = d.online && (!ON_PI.includes(d.integration) || agentOnline);
  return { state, busy, reachable, send };
}

// `title` replaces the device name, e.g. "All lights" for a room's group under its room heading.
export function DeviceTile({ device, onOpen, title }: { device: Device; onOpen: () => void; title?: string }) {
  const { state, busy, reachable, send } = useDevice(device);
  const tap = reachable ? tapAction(device, state) : null;
  const active = reachable && isActive(device, state);
  const temp = device.kind === "zone" ? num(state.temperature) : null;

  return (
    <div
      className={["tile", `tone-${toneOf(device)}`, active && "active", !reachable && "off"]
        .filter(Boolean)
        .join(" ")}
      role="button"
      tabIndex={0}
      aria-pressed={tap ? Boolean(state.on) : undefined}
      onClick={() => (tap ? send(device, tap.action, tap.params) : onOpen())}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
    >
      <div className="tile-top">
        <span className="tile-icon">
          <Icon name={iconOf(device)} size={20} />
        </span>
        {device.kind === "zone" && (
          <span className="tile-value">
            {temp !== null ? temp.toFixed(1) : "–"}
            <small>°</small>
          </span>
        )}
        {device.kind === "heating" && <span className="tile-value">{modeLabel(state.mode)}</span>}
        {busy && <span className="spinner" aria-label="Sending" />}
        <button
          className="tile-more"
          aria-label={`${device.name} details`}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          <Icon name="chevron" size={16} stroke={2.6} />
        </button>
      </div>
      <div className="tile-name">{title ?? device.name}</div>
      <div className={lowBattery(state) ? "tile-state warn" : "tile-state"}>
        {reachable ? describe(device, state) : offlineLabel(device)}
      </div>
    </div>
  );
}

const offlineLabel = (d: Device) => (d.online ? "Pi offline" : "Unreachable");

const HEAT_MODES = [
  { mode: "Auto", label: "Schedule" },
  { mode: "AutoWithEco", label: "Eco" },
  { mode: "Away", label: "Away" },
  { mode: "HeatingOff", label: "Off" },
];

export function DeviceSheet({ device, onClose }: { device: Device | null; onClose: () => void }) {
  return (
    <Sheet open={device !== null} onClose={onClose} title={device?.name} tone={device ? toneOf(device) : undefined}>
      {device && <DeviceControls device={device} />}
    </Sheet>
  );
}

function DeviceControls({ device: d }: { device: Device }) {
  const { state: s, busy, reachable, send } = useDevice(d);
  const [setpoint, setSetpoint] = useState<number | null>(null);
  const go = (action: string, params: Record<string, unknown> = {}) => send(d, action, params);
  const position = num(s.position);

  return (
    <div className="controls">
      <div className="control-hero">
        <span className="hero-icon">
          <Icon name={iconOf(d)} size={28} />
        </span>
        <div>
          <div className="hero-state">{reachable ? describe(d, s) : offlineLabel(d)}</div>
          <div className="muted">
            {[d.room !== d.name ? d.room : null, INTEGRATION_NAMES[d.integration]].filter(Boolean).join(" · ")}
            {busy && " · sending…"}
          </div>
        </div>
      </div>

      {(d.kind === "light" || d.kind === "group" || d.kind === "plug") && (
        <>
          <div className="row-card">
            <span className="grow">{d.kind === "group" ? `All ${s.lights ?? ""} lights` : "Power"}</span>
            <Switch on={Boolean(s.on)} label="Power" disabled={!reachable} onChange={(on) => go("set", { on })} />
          </div>
          {d.kind !== "plug" && (num(s.brightness) !== null || d.kind === "group") && (
            <Slider
              label="Brightness"
              value={num(s.brightness) ?? (s.on ? 100 : 0)}
              min={1}
              max={100}
              format={(n) => `${n}%`}
              disabled={!reachable}
              onCommit={(n) => go("set", { on: true, brightness: n })}
            />
          )}
        </>
      )}

      {d.kind === "zone" && floorOf(s) && <FloorControls state={s} />}

      {d.kind === "zone" && Boolean(s.floor_helper) && (
        <div className="note-card">
          <strong>Boiler switch for the floor heating</strong>
          <p className="muted small">
            The living-room thermostat sets this zone to 30° to make the boiler fire and to 5° to stop it. Its own
            temperature is ignored. Its radiator should be closed underneath, so this room doesn&apos;t heat.
          </p>
          <ZoneInfo state={s} />
        </div>
      )}

      {d.kind === "zone" && !floorOf(s) && !s.floor_helper && (
        <>
          <div className="stat-row">
            <div className="stat">
              <span className="muted">Now</span>
              <strong>{num(s.temperature)?.toFixed(1) ?? "–"}°</strong>
            </div>
            <div className="stat">
              <span className="muted">Target</span>
              <div className="stepper">
                <button className="round" disabled={!reachable} onClick={() => setSetpoint((v) => Math.max(5, (v ?? num(s.setpoint) ?? 20) - 0.5))} aria-label="Lower">
                  <Icon name="minus" size={18} />
                </button>
                <strong>{(setpoint ?? num(s.setpoint) ?? 20).toFixed(1)}°</strong>
                <button className="round" disabled={!reachable} onClick={() => setSetpoint((v) => Math.min(30, (v ?? num(s.setpoint) ?? 20) + 0.5))} aria-label="Raise">
                  <Icon name="plus" size={18} />
                </button>
              </div>
            </div>
          </div>
          <div className="button-row">
            <button
              className="pill"
              disabled={!reachable || setpoint === null}
              onClick={() => {
                go("set_temperature", { setpoint, minutes: 60 });
                setSetpoint(null);
              }}
            >
              Hold 1 hour
            </button>
            <button
              className="pill light"
              disabled={!reachable || setpoint === null}
              onClick={() => {
                go("set_temperature", { setpoint });
                setSetpoint(null);
              }}
            >
              Keep
            </button>
          </div>
          {s.mode && s.mode !== "FollowSchedule" && (
            <button className="pill light wide" disabled={!reachable} onClick={() => go("follow_schedule")}>
              Back to schedule{s.until ? ` (override until ${new Date(String(s.until)).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })})` : ""}
            </button>
          )}
          <ZoneInfo state={s} />
          <p className="muted small">Honeywell updates every 5 minutes, so new temperatures can take a moment to show.</p>
        </>
      )}

      {d.kind === "heating" && (
        <>
          <div className="chips">
            {HEAT_MODES.map((m) => (
              <button key={m.mode} className={s.mode === m.mode ? "chip selected" : "chip"} disabled={!reachable} onClick={() => go("set_mode", { mode: m.mode })}>
                {m.label}
              </button>
            ))}
          </div>
          <p className="muted small">
            Current mode: {modeLabel(s.mode)}
            {num(s.faults) ? ` · ${s.faults} fault(s) reported` : ""}
          </p>
        </>
      )}

      {d.kind === "blind" && (
        <>
          <div className="button-row three">
            <button className="pill light" disabled={!reachable} onClick={() => (d.integration === "brel" ? go("open") : go("set", { position: 0 }))}>
              <Icon name="up" size={18} /> Open
            </button>
            {d.integration === "brel" && (
              <button className="pill light" disabled={!reachable} onClick={() => go("stop")}>
                <Icon name="stop" size={16} /> Stop
              </button>
            )}
            <button className="pill light" disabled={!reachable} onClick={() => (d.integration === "brel" ? go("close") : go("set", { position: 100 }))}>
              <Icon name="down" size={18} /> Close
            </button>
          </div>
          {position !== null && (
            <Slider
              label="Open"
              value={100 - position}
              min={0}
              max={100}
              step={5}
              format={(n) => `${n}%`}
              disabled={!reachable}
              onCommit={(n) => go("set", { position: 100 - n })}
            />
          )}
          {num(s.battery_v) !== null && <p className="muted small">Motor battery {String(s.battery_v)} V</p>}
        </>
      )}

      {d.kind === "tv" && (
        <>
          <button className={s.on ? "pill wide" : "pill wide light"} disabled={!reachable} onClick={() => go("power", { on: !s.on })}>
            <Icon name="power" size={18} /> {s.on ? "Turn off" : "Turn on"}
          </button>
          {Boolean(s.on) && (
            <div className="button-row three">
              <button className="pill light" disabled={!reachable} onClick={() => go("volume", { delta: -2 })} aria-label="Volume down">
                <Icon name="volDown" size={20} />
              </button>
              <div className="tv-volume">{num(s.volume) ?? (d.integration === "apple" ? "Vol" : "–")}</div>
              <button className="pill light" disabled={!reachable} onClick={() => go("volume", { delta: 2 })} aria-label="Volume up">
                <Icon name="volUp" size={20} />
              </button>
            </div>
          )}
          {Boolean(s.on) && d.integration !== "apple" && (
            <button className="pill light wide" disabled={!reachable} onClick={() => go("mute", { on: !s.muted })}>
              <Icon name="mute" size={18} /> {s.muted ? "Unmute" : "Mute"}
            </button>
          )}
          {Boolean(s.on) && d.integration === "apple" && <AppleTvControls state={s} reachable={reachable} go={go} />}
        </>
      )}

      {d.kind === "speaker" && <SpeakerControls state={s} reachable={reachable} go={go} sonos={d.integration === "sonos"} />}

      {(d.kind === "doorbell" || d.kind === "sensor" || d.kind === "remote") && (
        <div className="stat-row">
          {num(s.battery) !== null && (
            <div className="stat">
              <span className="muted">Battery</span>
              <strong>{String(s.battery)}%</strong>
            </div>
          )}
          {d.kind === "sensor" && typeof s.motion === "boolean" && (
            <div className="stat">
              <span className="muted">Motion</span>
              <strong>{s.motion ? "Detected" : "Clear"}</strong>
            </div>
          )}
          {d.kind === "remote" && d.integration === "dirigera" && (
            <div className="stat">
              <span className="muted">Last press</span>
              <strong className="small-strong">{s.last_press_at ? timeAgo(String(s.last_press_at)) : "–"}</strong>
            </div>
          )}
          {d.kind === "doorbell" && (
            <div className="stat">
              <span className="muted">Last ring</span>
              <strong className="small-strong">{s.last_ring_at ? timeAgo(String(s.last_ring_at)) : "–"}</strong>
            </div>
          )}
        </div>
      )}
      {(d.kind === "sensor" || d.kind === "remote") && d.integration === "tradfri" && (
        <p className="muted small">The IKEA gateway only shares the battery level of sensors and remotes, not their button presses.</p>
      )}

      <p className="muted small">Updated {timeAgo(d.updated_at)}</p>
    </div>
  );
}

function SpeakerControls({
  state: s,
  reachable,
  go,
  sonos,
}: {
  sonos: boolean;
  state: Record<string, unknown>;
  reachable: boolean;
  go: (action: string, params?: Record<string, unknown>) => void;
}) {
  const favorites = Array.isArray(s.favorites) ? (s.favorites as { id: string; title: string }[]) : [];
  const grouped = Array.isArray(s.grouped_with) ? (s.grouped_with as string[]) : [];
  return (
    <>
      <div className="now-playing">
        <span className="muted small">{s.playing ? "Now playing" : "Paused"}{s.source ? ` · ${String(s.source)}` : ""}</span>
        <strong>{String(s.title ?? s.source ?? "Nothing playing")}</strong>
        {Boolean(s.artist) && <span className="muted">{String(s.artist)}</span>}
        {grouped.length > 0 && <span className="muted small">Grouped with {grouped.join(", ")}</span>}
      </div>
      <div className="transport">
        <button className="round big-round" disabled={!reachable} aria-label="Previous" onClick={() => go("previous")}>
          <Icon name="prev" size={22} />
        </button>
        <button className="round big-round dark" disabled={!reachable} aria-label={s.playing ? "Pause" : "Play"} onClick={() => go(s.playing ? "pause" : "play")}>
          <Icon name={s.playing ? "pause" : "play"} size={26} />
        </button>
        <button className="round big-round" disabled={!reachable} aria-label="Next" onClick={() => go("next")}>
          <Icon name="next" size={22} />
        </button>
      </div>
      <Slider
        label="Volume"
        value={num(s.volume) ?? 0}
        min={0}
        max={100}
        format={(n) => `${n}%`}
        disabled={!reachable}
        onCommit={(n) => go("volume", { volume: n })}
      />
      <button className="pill light wide" disabled={!reachable} onClick={() => go("mute", { on: !s.muted })}>
        <Icon name="mute" size={18} /> {s.muted ? "Unmute" : "Mute"}
      </button>
      {favorites.length > 0 ? (
        <>
          <h3 className="sheet-subtitle">Favourites</h3>
          <div className="chips">
            {favorites.map((f) => (
              <button key={f.id} className="chip" disabled={!reachable} onClick={() => go("favorite", { id: f.id, title: f.title })}>
                <Icon name="play" size={14} /> {f.title}
              </button>
            ))}
          </div>
        </>
      ) : (
        sonos && <p className="muted small">Add favourites in the Sonos app (heart a station or playlist) to start them here, in scenes and in automations.</p>
      )}
    </>
  );
}

function AppleTvControls({
  state: s,
  reachable,
  go,
}: {
  state: Record<string, unknown>;
  reachable: boolean;
  go: (action: string, params?: Record<string, unknown>) => void;
}) {
  const apps = Array.isArray(s.apps) ? (s.apps as { id: string; name: string }[]) : [];
  return (
    <>
      {Boolean(s.title) && (
        <div className="now-playing">
          <span className="muted small">{s.playing ? "Now playing" : "Paused"}{s.app ? ` · ${String(s.app)}` : ""}</span>
          <strong>{String(s.title)}</strong>
          {Boolean(s.artist) && <span className="muted">{String(s.artist)}</span>}
        </div>
      )}
      <div className="transport">
        <button className="round big-round" disabled={!reachable} aria-label="Previous" onClick={() => go("previous")}>
          <Icon name="prev" size={22} />
        </button>
        <button className="round big-round dark" disabled={!reachable} aria-label={s.playing ? "Pause" : "Play"} onClick={() => go(s.playing ? "pause" : "play")}>
          <Icon name={s.playing ? "pause" : "play"} size={26} />
        </button>
        <button className="round big-round" disabled={!reachable} aria-label="Next" onClick={() => go("next")}>
          <Icon name="next" size={22} />
        </button>
      </div>
      {apps.length > 0 && (
        <Picker
          label="Open an app"
          placeholder="Open an app…"
          value=""
          groups={[
            {
              title: "Apps",
              items: apps.map((a) => ({
                value: a.id,
                label: a.name,
                art: (
                  <span className="picker-icon tone-pink">
                    <Icon name="tv" size={17} />
                  </span>
                ),
              })),
            },
          ]}
          onChange={(id) => go("app", { id })}
        />
      )}
    </>
  );
}

// How Honeywell has the zone set up, and any faults, in words.
const ZONE_TYPES: Record<string, string> = {
  RadiatorZone: "Radiator zone (radiator knobs)",
  UnderfloorHeating: "Floor heating",
  ZoneValves: "Zone valve (relay)",
  ElectricHeating: "Electric heating",
  MixingValve: "Mixing valve",
};

const FAULTS: Record<string, string> = {
  TempZoneSensorLowBattery: "Sensor battery low",
  TempZoneActuatorLowBattery: "Radiator knob battery low",
  TempZoneSensorCommunicationLost: "Sensor out of contact",
  TempZoneActuatorCommunicationLost: "Radiator knob out of contact",
};

function ZoneInfo({ state: s }: { state: Record<string, unknown> }) {
  const faults = Array.isArray(s.fault_types) ? (s.fault_types as string[]) : [];
  if (!s.zone_type && !faults.length) return null;
  return (
    <div className="list-card">
      {Boolean(s.zone_type) && (
        <div className="list-row">
          <span className="grow">
            <span className="muted small sub">Set up as</span>
            <strong>{ZONE_TYPES[String(s.zone_type)] ?? String(s.zone_type)}</strong>
          </span>
        </div>
      )}
      {faults.map((f) => (
        <div key={f} className="list-row">
          <span className="dot bad" />
          <span className="grow">{FAULTS[f] ?? f.replace(/([a-z])([A-Z])/g, "$1 $2")}</span>
        </div>
      ))}
    </div>
  );
}

// The living-room floor-heating thermostat (Supabase switches the helper zone).
function FloorControls({ state: s }: { state: Record<string, unknown> }) {
  const { floor, setFloor, devices, send } = useHome();
  const f = floorOf(s);
  if (!floor || !f) return null;
  const system = devices.find((d) => d.kind === "heating" && d.integration === "evohome");
  const systemOff = system?.state.mode === "HeatingOff";
  const helper = devices.find((d) => d.id === floor.helper_zone);
  const step = (delta: number) => setFloor({ target: Math.min(25, Math.max(15, Number(floor.target) + delta)) });

  return (
    <>
      <div className="row-card">
        <span className="grow">
          Floor heating
          <span className="muted small sub">
            {!floor.enabled ? "Off" : floor.heating ? "Heating: the boiler is on for the floor" : "Idle: at temperature"}
          </span>
        </span>
        <Switch on={floor.enabled} label="Floor heating" onChange={(enabled) => setFloor({ enabled })} />
      </div>
      <div className="stat-row">
        <div className="stat">
          <span className="muted">Now</span>
          <strong>{num(s.temperature)?.toFixed(1) ?? "–"}°</strong>
        </div>
        <div className="stat">
          <span className="muted">Target</span>
          <div className="stepper">
            <button className="round" aria-label="Lower" onClick={() => step(-0.5)}>
              <Icon name="minus" size={18} />
            </button>
            <strong>{Number(floor.target).toFixed(1)}°</strong>
            <button className="round" aria-label="Raise" onClick={() => step(0.5)}>
              <Icon name="plus" size={18} />
            </button>
          </div>
        </div>
      </div>
      {systemOff && system && (
        <div className="note-card warn">
          <strong>The heating system is switched Off</strong>
          <p className="muted small">Nothing can fire the boiler until it&apos;s on Schedule.</p>
          <button className="pill small" onClick={() => send(system, "set_mode", { mode: "Auto" })}>
            Switch to Schedule
          </button>
        </div>
      )}
      <p className="muted small">
        Heats when the living room is below {Number(floor.target).toFixed(1)}° and stops at{" "}
        {(Number(floor.target) + 0.5).toFixed(1)}°, by switching {helper?.name ?? "the helper zone"} between 30° and 5°.
        Floor heating is slow: expect half an hour or more before you feel it.
      </p>
    </>
  );
}
