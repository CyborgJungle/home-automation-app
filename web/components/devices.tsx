"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { Sheet, Slider, Switch, timeAgo } from "@/components/ui";
import {
  describe,
  displayState,
  iconOf,
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
  tradfri: "IKEA TRÅDFRI",
  evohome: "Honeywell evohome",
  eufy: "Eufy",
  brel: "Brel Home",
  bravia: "Sony BRAVIA",
};

function useDevice(d: Device) {
  const { commands, agentOnline, send } = useHome();
  const state = displayState(d, commands);
  const busy = commands.some((c) => c.device_id === d.id && isOpen(c));
  const reachable = d.online && (!ON_PI.includes(d.integration) || agentOnline);
  return { state, busy, reachable, send };
}

export function DeviceTile({ device, onOpen }: { device: Device; onOpen: () => void }) {
  const { state, busy, reachable, send } = useDevice(device);
  const tap = reachable ? tapAction(device, state) : null;
  const active = reachable && isActive(device, state);
  const temp = device.kind === "zone" ? num(state.temperature) : null;

  return (
    <div
      className={["tile", `tone-${toneOf(device)}`, active && "active", !reachable && "off", (device.kind === "zone" || device.kind === "heating") && device.kind]
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
      {device.kind === "zone" && (
        <div className="tile-big">
          {temp !== null ? temp.toFixed(1) : "–"}
          <small>°C</small>
        </div>
      )}
      {device.kind === "heating" && <div className="tile-big">{modeLabel(state.mode)}</div>}
      <div className="tile-name">{device.name}</div>
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

      {d.kind === "zone" && (
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
              <div className="tv-volume">{num(s.volume) ?? "–"}</div>
              <button className="pill light" disabled={!reachable} onClick={() => go("volume", { delta: 2 })} aria-label="Volume up">
                <Icon name="volUp" size={20} />
              </button>
            </div>
          )}
          {Boolean(s.on) && (
            <button className="pill light wide" disabled={!reachable} onClick={() => go("mute", { on: !s.muted })}>
              <Icon name="mute" size={18} /> {s.muted ? "Unmute" : "Mute"}
            </button>
          )}
        </>
      )}

      {(d.kind === "doorbell" || d.kind === "sensor" || d.kind === "remote") && (
        <div className="stat-row">
          {num(s.battery) !== null && (
            <div className="stat">
              <span className="muted">Battery</span>
              <strong>{String(s.battery)}%</strong>
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
      {(d.kind === "sensor" || d.kind === "remote") && (
        <p className="muted small">The IKEA gateway only shares the battery level of sensors and remotes, not their button presses.</p>
      )}

      <p className="muted small">Updated {timeAgo(d.updated_at)}</p>
    </div>
  );
}
