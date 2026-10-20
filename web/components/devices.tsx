"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Picker } from "@/components/picker";
import { Sheet, Slider, timeAgo } from "@/components/ui";
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
  type IconName,
  type Tone,
  tapAction,
  powerOf,
  roomOn,
  roomTarget,
  roomLimits,
  displayModes,
  membersOf,
  toneOf,
} from "@/lib/devices";
import { useHome } from "@/lib/home";
import type { Device } from "@/lib/supabase";
import { colorCss, HUE_TRACK, hueName, LAMP_COLORS, selectedColor, whiteName, whiteTrack } from "@/lib/colors";

export const INTEGRATION_NAMES: Record<Device["integration"], string> = {
  ikeadisplay: "IKEA display",
  roborock: "Roborock",
  app: "Lamp group",
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

// The lamp icon is the power button: it pops and sparkles on, and dims off.
export function PowerIcon({
  on,
  icon,
  size,
  label,
  disabled,
  onToggle,
  className,
  style,
}: {
  on: boolean;
  icon: IconName;
  size: number;
  label: string;
  disabled?: boolean;
  onToggle: () => void;
  className: string;
  style?: React.CSSProperties;
}) {
  const [anim, setAnim] = useState<"on" | "off" | null>(null);
  return (
    <button
      type="button"
      className={[className, "power-icon", on && "lit", anim && `turn-${anim}`].filter(Boolean).join(" ")}
      style={style}
      aria-pressed={on}
      aria-label={`${label}: turn ${on ? "off" : "on"}`}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        setAnim(on ? "off" : "on");
        onToggle();
      }}
      onAnimationEnd={(e) => {
        if (e.animationName === "power-boing" || e.animationName === "power-blink") setAnim(null);
      }}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

// `icon` and `tone` replace the device's own, e.g. for a lamp on a plug under Lights.
export function DeviceTile({ device, onOpen, icon, tone }: { device: Device; onOpen: () => void; icon?: IconName; tone?: Tone }) {
  const { state, busy, reachable, send } = useDevice(device);
  const power = powerOf(device, state);
  const tap = reachable && !power ? tapAction(device, state) : null;
  const active = reachable && isActive(device, state);
  const temp = device.kind === "zone" ? num(state.temperature) : null;

  return (
    <div
      className={["tile", `tone-${tone ?? toneOf(device)}`, active && "active", !reachable && "off"]
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
        {power ? (
          <PowerIcon
            className="tile-icon"
            on={reachable && power.on}
            icon={icon ?? iconOf(device)}
            size={18}
            label={device.name}
            disabled={!reachable}
            onToggle={() => send(device, power.toggle.action, power.toggle.params)}
          />
        ) : (
          <span className="tile-icon">
            <Icon name={icon ?? iconOf(device)} size={18} />
          </span>
        )}
        {device.kind === "zone" && (
          <span className="tile-value">
            {temp !== null ? temp.toFixed(1) : "–"}
            <small>°</small>
          </span>
        )}
        {device.kind === "heating" && <span className="tile-value">{modeLabel(state.mode)}</span>}
        <span className={lowBattery(state) ? "tile-state warn" : "tile-state"}>
          {reachable ? describe(device, state) : offlineLabel(device)}
        </span>
        {busy && <span className="spinner" aria-label="Sending" />}
        {tap && (
          <button
            className="tile-more"
            aria-label={`${device.name} details`}
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
          >
            <Icon name="chevron" size={14} stroke={2.6} />
          </button>
        )}
      </div>
      <div className="tile-name">{device.name}</div>
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
  const { state: s, reachable, send } = useDevice(d);
  const power = powerOf(d, s);
  const go = (action: string, params: Record<string, unknown> = {}) => send(d, action, params);
  const position = num(s.position);

  return (
    <div className="controls">
      {/* Switchable devices: a dark card when off, their colour when on, like the tiles. */}
      <div className={power && !(reachable && power.on) ? "control-hero dim" : "control-hero"}>
        {power ? (
          <PowerIcon
            className="hero-icon"
            on={power.on}
            icon={d.also_light ? "bulb" : iconOf(d)}
            size={28}
            label={d.name}
            disabled={!reachable}
            onToggle={() => go(power.toggle.action, power.toggle.params)}
          />
        ) : (
          <span className="hero-icon">
            <Icon name={iconOf(d)} size={28} />
          </span>
        )}
        <div>
          <div className="hero-state">{reachable ? describe(d, s) : offlineLabel(d)}</div>
          <div className="muted">
            {[d.room !== d.name ? d.room : null, INTEGRATION_NAMES[d.integration]].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>

      {(d.kind === "light" || d.kind === "group" || d.kind === "plug") && (
        <>
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
          {d.kind !== "plug" && <LampColour state={s} reachable={reachable} go={go} />}
          {membersOf(d).length > 0 && <GroupLamps ids={membersOf(d)} />}
        </>
      )}

      {d.integration === "ikeadisplay" && <DisplayControls device={d} state={s} reachable={reachable} go={go} />}

      {d.integration === "ikeadisplay" && s.brightnessScheduleEnabled === true && (
        <p className="muted small" role="status">
          Disable Scheduled brightness in the IKEA display app to use these controls. You can schedule the display here using automations.
        </p>
      )}

      {d.kind === "zone" && floorOf(s) && <RoomTemperature state={s} reachable={reachable} go={go} />}

      {d.kind === "zone" && Boolean(s.floor_helper) && (
        <div className="note-card">
          <strong>Boiler switch for the floor heating</strong>
          <p className="muted small">
            The living-room thermostat sets this zone to 30° to make the boiler fire and to 5° to stop it. Its own
            temperature is ignored. Its radiator should be closed underneath, so this room doesn&apos;t heat.
          </p>
        </div>
      )}

      {d.kind === "zone" && !floorOf(s) && !s.floor_helper && <RoomTemperature state={s} reachable={reachable} go={go} />}

      {d.kind === "heating" && (
        <>
          <div className="chips">
            {HEAT_MODES.map((m) => (
              <button key={m.mode} className={s.mode === m.mode ? "chip selected" : "chip"} disabled={!reachable} onClick={() => go("set_mode", { mode: m.mode })}>
                {m.label}
              </button>
            ))}
          </div>
          {num(s.faults) ? <p className="muted small">{String(s.faults)} fault(s) reported</p> : null}
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

      {d.kind === "speaker" && <SpeakerControls state={s} reachable={reachable} go={go} />}

      {d.kind === "vacuum" && <VacuumControls state={s} reachable={reachable} go={go} />}

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
      {d.kind === "remote" && Array.isArray(s.controls) && <RemoteLinks ids={s.controls as string[]} />}

    </div>
  );
}

// The LED wall: pick what it shows, or scroll a message across it once.
function DisplayControls({
  device: d,
  state: s,
  reachable,
  go,
}: {
  device: Device;
  state: Record<string, unknown>;
  reachable: boolean;
  go: (action: string, params?: Record<string, unknown>) => void;
}) {
  const [text, setText] = useState("");
  const modes = displayModes(d);
  return (
    <>
      {modes.length > 0 && (
        <Picker
          label="Showing"
          placeholder="Choose a mode"
          value={s.plugin != null ? String(s.plugin) : ""}
          groups={[
            {
              title: "Modes",
              items: modes.map((m) => ({
                value: String(m.id),
                label: m.name,
                art: (
                  <span className="picker-icon tone-yellow">
                    <Icon name="display" size={16} />
                  </span>
                ),
              })),
            },
          ]}
          onChange={(v) => reachable && go("plugin", { id: Number(v) })}
        />
      )}
      <form
        className="message-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim() || !reachable) return;
          go("message", { text: text.trim() });
          setText("");
        }}
      >
        <label className="field grow">
          <input
          value={text}
          maxLength={120}
          placeholder="Show a message…"
          aria-label="Message for the display"
          onChange={(e) => setText(e.target.value)}
          />
        </label>
        <button className="pill small" type="submit" disabled={!reachable || !text.trim()}>
          Show
        </button>
      </form>
    </>
  );
}

// Start, pause and dock, how loud it cleans, and where it is.
function VacuumControls({
  state: s,
  reachable,
  go,
}: {
  state: Record<string, unknown>;
  reachable: boolean;
  go: (action: string, params?: Record<string, unknown>) => void;
}) {
  const fans = [
    { id: "quiet", label: "Quiet" },
    { id: "balanced", label: "Balanced" },
    { id: "turbo", label: "Turbo" },
    { id: "max", label: "Max" },
  ];
  return (
    <>
      <div className="stat-row">
        <div className="stat">
          <span className="muted">Battery</span>
          <strong>{num(s.battery) !== null ? `${s.battery}%` : "–"}</strong>
        </div>
        {Boolean(s.cleaning) && (
          <div className="stat">
            <span className="muted">This run</span>
            <strong className="small-strong">
              {String(s.minutes ?? 0)} min · {String(s.area_m2 ?? 0)} m²
            </strong>
          </div>
        )}
      </div>
      <div className="chips">
        {s.cleaning ? (
          <button className="chip" disabled={!reachable} onClick={() => go("pause")}>
            Pause
          </button>
        ) : (
          <button className="chip selected" disabled={!reachable} onClick={() => go("start")}>
            {s.paused ? "Continue" : "Start cleaning"}
          </button>
        )}
        <button className="chip" disabled={!reachable || Boolean(s.docked)} onClick={() => go("dock")}>
          Return to dock
        </button>
        <button className="chip" disabled={!reachable} onClick={() => go("find")}>
          Find it
        </button>
      </div>
      <div className="chips" role="radiogroup" aria-label="Suction">
        {fans.map((f) => (
          <button
            key={f.id}
            role="radio"
            aria-checked={s.fan === f.id}
            className={s.fan === f.id ? "chip selected" : "chip"}
            disabled={!reachable}
            onClick={() => go("fan", { level: f.id })}
          >
            {f.label}
          </button>
        ))}
      </div>
      {num(s.error) ? <p className="muted small">The vacuum reports error {String(s.error)}. Check the Roborock app.</p> : null}
    </>
  );
}

// Lamps a remote switches by itself, through the hub (no app or Pi involved).
function RemoteLinks({ ids }: { ids: string[] }) {
  const { devices } = useHome();
  const names = ids.map((id) => devices.find((d) => d.id === id)?.name).filter(Boolean);
  return (
    <div className="row-card">
      <span className="grow">
        <span className="muted small sub">Switches directly, even without the Pi</span>
        <strong>{names.join(", ") || "–"}</strong>
      </span>
    </div>
  );
}

// The lamps in an app group, each with its own power button.
function GroupLamps({ ids }: { ids: string[] }) {
  const { devices } = useHome();
  const lamps = ids.map((id) => devices.find((d) => d.id === id)).filter((d): d is Device => Boolean(d));
  return (
    <div className="list-card">
      {lamps.map((l) => (
        <GroupLamp key={l.id} lamp={l} />
      ))}
    </div>
  );
}

function GroupLamp({ lamp }: { lamp: Device }) {
  const { state, reachable, send } = useDevice(lamp);
  return (
    <div className="list-row">
      <PowerIcon
        className="lamp-row-icon"
        on={Boolean(state.on)}
        icon="bulb"
        size={17}
        label={lamp.name}
        disabled={!reachable}
        onToggle={() => send(lamp, "set", { on: !state.on })}
      />
      <span className="grow">
        <strong>{lamp.name}</strong>
        <span className="muted small sub">{reachable ? describe(lamp, state) : offlineLabel(lamp)}</span>
      </span>
    </div>
  );
}

// Colour swatches and a rainbow slider for colour lamps, and a warm-to-cool
// slider for white-spectrum lamps. Lamps that can do neither show nothing.
function LampColour({
  state: s,
  reachable,
  go,
}: {
  state: Record<string, unknown>;
  reachable: boolean;
  go: (action: string, params?: Record<string, unknown>) => void;
}) {
  const warm = num(s.kelvin_warm);
  const cool = num(s.kelvin_cool);
  const hue = num(s.hue);
  const picked = selectedColor(s);
  return (
    <>
      {Boolean(s.color) && (
        <div className="swatches" role="group" aria-label="Colour">
          {LAMP_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={picked === c.id ? "swatch on" : "swatch"}
              style={{ "--swatch": colorCss(c.hue, c.saturation) } as React.CSSProperties}
              aria-label={c.label}
              aria-pressed={picked === c.id}
              disabled={!reachable}
              onClick={() => go("set", { on: true, hue: c.hue, saturation: c.saturation })}
            />
          ))}
        </div>
      )}
      {Boolean(s.color) && hue !== null && (
        <Slider
          label="Colour"
          value={hue}
          min={0}
          max={359}
          track={HUE_TRACK}
          format={(n) => hueName(n)}
          disabled={!reachable}
          onCommit={(n) => go("set", { on: true, hue: n, saturation: Math.max(num(s.saturation) ?? 100, 70) })}
        />
      )}
      {warm !== null && cool !== null && cool > warm && (
        <Slider
          label="White"
          value={Math.max(warm, Math.min(cool, num(s.color_temp) ?? warm))}
          min={warm}
          max={cool}
          step={50}
          track={whiteTrack(warm, cool)}
          format={(k) => whiteName(k).replace(" white", "")}
          disabled={!reachable}
          onCommit={(k) => go("set", { on: true, color_temp: k })}
        />
      )}
    </>
  );
}

function SpeakerControls({
  state: s,
  reachable,
  go,
}: {
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
      ) : null}
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

// Faults Honeywell reports for a room, in words.
const FAULTS: Record<string, string> = {
  TempZoneSensorLowBattery: "Sensor battery low",
  TempZoneActuatorLowBattery: "Radiator knob battery low",
  TempZoneSensorCommunicationLost: "Sensor out of contact",
  TempZoneActuatorCommunicationLost: "Radiator knob out of contact",
};

// A room's temperature now and the one it heats to. Tapping + or − turns the
// room on at that temperature; taps are gathered and only the final value is
// sent, a moment after the last tap. The range is the room's Honeywell limits.
const SEND_AFTER_MS = 900;

function RoomTemperature({
  state: s,
  reachable,
  go,
}: {
  state: Record<string, unknown>;
  reachable: boolean;
  go: (action: string, params?: Record<string, unknown>) => void;
}) {
  const { min: low, max } = roomLimits(s);
  // One step above "off", so + and − always mean "on at this temperature".
  const min = low + 0.5;
  const [pending, setPending] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = pending ?? roomTarget(s);
  const faults = (Array.isArray(s.fault_types) ? (s.fault_types as string[]) : []).map((f) => FAULTS[f] ?? f);

  const nudge = (delta: number) => {
    const next = Math.min(max, Math.max(min, shown + delta));
    setPending(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      go("room_on", { setpoint: next });
      setPending(null);
    }, SEND_AFTER_MS);
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <div className="stat-row">
      <div className="stat">
        <span className="muted">Now</span>
        <strong>{num(s.temperature)?.toFixed(1) ?? "–"}°</strong>
      </div>
      <div className="stat">
        <span className="muted">{roomOn(s) || pending !== null ? "Heating to" : "Off · heat to"}</span>
        <div className="stepper">
          <button className="round" disabled={!reachable || shown <= min} onClick={() => nudge(-0.5)} aria-label="Lower">
            <Icon name="minus" size={16} />
          </button>
          <strong>{shown.toFixed(1)}°</strong>
          <button className="round" disabled={!reachable || shown >= max} onClick={() => nudge(0.5)} aria-label="Raise">
            <Icon name="plus" size={16} />
          </button>
        </div>
      </div>
      {faults.length > 0 && <p className="muted small warn-text">{faults.join(" · ")}</p>}
    </div>
  );
}

