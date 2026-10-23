"use client";

import { NumberField } from "@/components/actions";
import { Icon, type IconKey } from "@/components/icons";
import { ChipChoice, deviceGroups, Picker, sceneItem } from "@/components/picker";
import { DAYS, WEEK, deviceStateLabel } from "@/lib/automations";
import {
  categoryOf,
  emptyRule,
  type Category,
  type RuleDraft,
} from "@/lib/automation-draft";
import { canTrigger, triggerOptions } from "@/lib/devices";
import type { Device, Scene } from "@/lib/supabase";
import { WEATHER_OPTIONS } from "@/lib/weather";

export const CATEGORIES: {
  id: Category;
  label: string;
  icon: IconKey;
  tone: string;
}[] = [
  { id: "time", label: "Time", icon: "clock", tone: "lavender" },
  { id: "device", label: "Device", icon: "bulb", tone: "yellow" },
  { id: "weather", label: "Weather", icon: "cloud", tone: "sky" },
];
const SCENE = "scene:";

export const categoryInfo = (rule: RuleDraft) =>
  CATEGORIES.find((c) => c.id === categoryOf(rule.when))!;

export function AutomationRuleFields({
  rule,
  devices,
  scenes,
  onChange,
}: {
  rule: RuleDraft;
  devices: Device[];
  scenes: Scene[];
  onChange: (rule: RuleDraft) => void;
}) {
  const set = (patch: Partial<RuleDraft>) => onChange({ ...rule, ...patch });
  const category = categoryOf(rule.when);
  const timeMode =
    rule.when === "time" ? "time" : rule.until === "24:00" ? "from" : rule.at === "00:00" ? "until" : "time_range";
  const scene = rule.when === "scene" ? scenes.find((s) => s.id === rule.device) : undefined;
  const device = rule.when === "scene" ? undefined : devices.find((d) => d.id === rule.device);
  const options = device ? triggerOptions(device) : [];
  const option = options.find((o) => o.id === rule.option);
  const weatherOption = WEATHER_OPTIONS.find(
    (o) => o.id === rule.weatherOption,
  );
  const groups = deviceGroups(devices.filter(canTrigger));
  const offerDoorbell =
    devices.some((d) => d.kind === "doorbell") || (rule.when === "event" && !rule.device);
  if (offerDoorbell) groups.push({
    title: "Doorbell",
    items: [
      {
        value: "__any_doorbell__",
        label: "Any doorbell",
        art: (
          <span className="picker-icon tone-sage">
            <Icon name="bell" size={17} />
          </span>
        ),
      },
    ],
  });
  // A scene counts as on when its devices look the way it sets them.
  const sceneItems = scenes.filter((s) => s.kind === "custom").map((s) => sceneItem(s, `${SCENE}${s.id}`));
  if (sceneItems.length) groups.push({ title: "Scenes", items: sceneItems });

  return (
    <>
      <div
        className="segmented automation-starts"
        role="radiogroup"
        aria-label="Rule category"
      >
        {CATEGORIES.map((c) => (
          <button
            type="button"
            key={c.id}
            role="radio"
            aria-checked={category === c.id}
            className={category === c.id ? "selected" : ""}
            onClick={() => {
              if (category !== c.id) onChange(emptyRule(c.id));
            }}
          >
            <Icon name={c.icon} size={16} />
            {c.label}
          </button>
        ))}
      </div>

      {category === "time" && (
        <>
          <ChipChoice
            label="Time option"
            value={timeMode}
            options={[
              { value: "time", label: "At" },
              { value: "from", label: "From" },
              { value: "until", label: "Until" },
              { value: "time_range", label: "Between" },
            ]}
            onChange={(mode) =>
              set(
                // "From 21:00" runs until midnight, "Until 07:00" from midnight.
                mode === "time"
                  ? { when: "time" }
                  : mode === "from"
                    ? { when: "time_range", at: rule.at === "00:00" ? "21:00" : rule.at, until: "24:00" }
                    : mode === "until"
                      ? { when: "time_range", at: "00:00", until: rule.until === "24:00" ? "07:00" : rule.until }
                      : { when: "time_range", at: rule.at === "00:00" ? "21:00" : rule.at, until: rule.until === "24:00" ? "23:00" : rule.until },
              )
            }
          />
          <div className={timeMode === "time_range" ? "rule-times" : undefined}>
            {timeMode !== "until" && (
              <label className="field">
                <span>{timeMode === "time_range" ? "From" : timeMode === "from" ? "From (until midnight)" : "At"}</span>
                <input type="time" value={rule.at} onChange={(e) => set({ at: e.target.value })} />
              </label>
            )}
            {(timeMode === "time_range" || timeMode === "until") && (
              <label className="field">
                <span>{timeMode === "until" ? "Until (from midnight)" : "Until"}</span>
                <input type="time" value={rule.until} onChange={(e) => set({ until: e.target.value })} />
              </label>
            )}
          </div>
          {timeMode === "time_range" && rule.at > rule.until && (
            <p className="muted small">
              Ends the next day. Choose the days it starts.
            </p>
          )}
        </>
      )}

      {category === "device" && (
        <>
          <Picker
            label="Device"
            placeholder="Choose a device"
            value={
              rule.when === "event" && !rule.device
                ? "__any_doorbell__"
                : rule.when === "scene"
                  ? `${SCENE}${rule.device}`
                  : rule.device
            }
            groups={groups}
            onChange={(value) => {
              if (value.startsWith(SCENE)) {
                set({ device: value.slice(SCENE.length), when: "scene", option: "scene_on", value: null });
                return;
              }
              const picked = devices.find((d) => d.id === value);
              const ring =
                value === "__any_doorbell__" || picked?.kind === "doorbell";
              set({
                device: value === "__any_doorbell__" ? "" : value,
                when: ring ? "event" : "device",
                option: ring ? "ring" : "",
                value: null,
              });
            }}
          />
          {(device || rule.when === "event") && (
            <Picker
              label="Device option"
              placeholder="Choose what to check"
              value={rule.option}
              groups={[
                {
                  title: device?.name ?? "Doorbell",
                  items: [
                    ...(rule.when === "event" || device?.kind === "doorbell"
                      ? [
                          {
                            value: "ring",
                            label: "Rings",
                            art: <Icon name="bell" size={17} />,
                          },
                        ]
                      : []),
                    ...options.map((o) => ({
                      value: o.id,
                      label: deviceStateLabel(o.label),
                      art: <Icon name="sensor" size={17} />,
                    })),
                  ],
                },
              ]}
              onChange={(option) =>
                set({
                  option,
                  // Doorbell rings and remote button presses are events.
                  when:
                    option === "ring" || options.find((o) => o.id === option)?.event
                      ? "event"
                      : "device",
                  value: null,
                })
              }
            />
          )}
          {scene && (
            <ChipChoice
              label="Scene option"
              value={rule.option}
              options={[
                { value: "scene_on", label: "Is on" },
                { value: "scene_off", label: "Is off" },
              ]}
              onChange={(option) => set({ option })}
            />
          )}
          {rule.when === "device" && option && (
            <ChipChoice
              label="When"
              value={rule.becomes ? "becomes" : "is"}
              options={[
                {
                  value: "becomes",
                  label:
                    deviceStateLabel(option.label) === option.label
                      ? `Becomes: ${option.label}`
                      : option.label.replace(/^./, (c) => c.toUpperCase()),
                },
                { value: "is", label: deviceStateLabel(option.label).replace(/^./, (c) => c.toUpperCase()) },
              ]}
              onChange={(v) => set({ becomes: v === "becomes" })}
            />
          )}
          {rule.when === "device" && option?.number && (
            <NumberField
              input={option.number}
              label={option.label.replace(/^./, (c) => c.toUpperCase())}
              value={rule.value}
              onChange={(value) => set({ value })}
            />
          )}
        </>
      )}

      {category === "weather" && (
        <>
          <Picker
            label="Weather option"
            placeholder="Choose weather"
            value={rule.when === "sun" ? rule.sunEvent : rule.when === "dark" ? "dark" : rule.weatherOption}
            groups={[
              {
                title: "Sun",
                items: [
                  {
                    value: "dark",
                    label: "While it's dark",
                    art: (
                      <span className="picker-icon tone-lavender">
                        <Icon name="sun" size={17} />
                      </span>
                    ),
                  },
                  ...["sunrise", "sunset"].map((event) => ({
                  value: event,
                  label: event === "sunrise" ? "Sunrise" : "Sunset",
                  art: (
                    <span className="picker-icon tone-yellow">
                      <Icon name="sun" size={17} />
                    </span>
                  ),
                  })),
                ],
              },
              {
                title: "Weather",
                items: WEATHER_OPTIONS.map((o) => ({
                  value: o.id,
                  label: o.conditionLabel,
                  art: (
                    <span className="picker-icon tone-sky">
                      <Icon name="cloud" size={17} />
                    </span>
                  ),
                })),
              },
            ]}
            onChange={(value) =>
              value === "dark"
                ? set({ when: "dark" })
                : value === "sunrise" || value === "sunset"
                ? set({ when: "sun", sunEvent: value })
                : set({
                    when: "weather",
                    weatherOption: value,
                    weatherValue: null,
                  })
            }
          />
          {rule.when === "weather" && weatherOption?.number && (
            <NumberField
              input={weatherOption.number}
              label={weatherOption.label}
              value={rule.weatherValue}
              onChange={(weatherValue) => set({ weatherValue })}
            />
          )}
          {rule.when === "dark" && (
            <>
              <NumberField
                input={{ min: -180, max: 180, step: 5, default: 0, unit: " min" }}
                label="Starts, from sunset"
                value={rule.darkFrom}
                onChange={(darkFrom) => set({ darkFrom })}
              />
              <NumberField
                input={{ min: -180, max: 180, step: 5, default: 0, unit: " min" }}
                label="Ends, from sunrise"
                value={rule.darkUntil}
                onChange={(darkUntil) => set({ darkUntil })}
              />
              <p className="muted small">
                Negative minutes are before; positive minutes are after. Pair it with motion to only light up in the evening and night.
              </p>
            </>
          )}
          {rule.when === "sun" && (
            <>
              <NumberField
                input={{
                  min: -180,
                  max: 180,
                  step: 5,
                  default: 0,
                  unit: " min",
                }}
                label={`From ${rule.sunEvent}`}
                value={rule.sunOffset}
                onChange={(sunOffset) => set({ sunOffset })}
              />
              <p className="muted small">
                Negative minutes are before; positive minutes are after.
              </p>
            </>
          )}
        </>
      )}

      {(category === "time" || rule.when === "sun") && (
        <div className="days" role="group" aria-label="Days">
          {WEEK.map((day) => (
            <button
              type="button"
              key={day}
              className={rule.days.includes(day) ? "day on" : "day"}
              aria-pressed={rule.days.includes(day)}
              onClick={() =>
                set({
                  days: rule.days.includes(day)
                    ? rule.days.filter((d) => d !== day)
                    : [...rule.days, day],
                })
              }
            >
              {DAYS[day].slice(0, 2)}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
