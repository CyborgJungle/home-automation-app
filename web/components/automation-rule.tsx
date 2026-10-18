"use client";

import { NumberField } from "@/components/actions";
import { Icon, type IconKey } from "@/components/icons";
import { ChipChoice, deviceGroups, Picker } from "@/components/picker";
import { DAYS, WEEK, deviceStateLabel } from "@/lib/automations";
import {
  categoryOf,
  emptyRule,
  type Category,
  type RuleDraft,
} from "@/lib/automation-draft";
import { canTrigger, triggerOptions } from "@/lib/devices";
import type { Device } from "@/lib/supabase";
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
export const categoryInfo = (rule: RuleDraft) =>
  CATEGORIES.find((c) => c.id === categoryOf(rule.when))!;

export function AutomationRuleFields({
  rule,
  devices,
  onChange,
}: {
  rule: RuleDraft;
  devices: Device[];
  onChange: (rule: RuleDraft) => void;
}) {
  const set = (patch: Partial<RuleDraft>) => onChange({ ...rule, ...patch });
  const category = categoryOf(rule.when);
  const device = devices.find((d) => d.id === rule.device);
  const options = device ? triggerOptions(device) : [];
  const option = options.find((o) => o.id === rule.option);
  const weatherOption = WEATHER_OPTIONS.find(
    (o) => o.id === rule.weatherOption,
  );
  const groups = deviceGroups(devices.filter(canTrigger));
  groups.push({
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
            value={rule.when}
            options={[
              { value: "time", label: "At a time" },
              { value: "time_range", label: "Between times" },
            ]}
            onChange={(when) => set({ when: when as "time" | "time_range" })}
          />
          <div
            className={rule.when === "time_range" ? "rule-times" : undefined}
          >
            <label className="field">
              <span>{rule.when === "time_range" ? "From" : "At"}</span>
              <input
                type="time"
                value={rule.at}
                onChange={(e) => set({ at: e.target.value })}
              />
            </label>
            {rule.when === "time_range" && (
              <label className="field">
                <span>Until</span>
                <input
                  type="time"
                  value={rule.until}
                  onChange={(e) => set({ until: e.target.value })}
                />
              </label>
            )}
          </div>
          {rule.when === "time_range" && rule.at > rule.until && (
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
                : rule.device
            }
            groups={groups}
            onChange={(value) => {
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
          {rule.when === "device" && option?.number && (
            <NumberField
              input={option.number}
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
            value={rule.when === "sun" ? rule.sunEvent : rule.weatherOption}
            groups={[
              {
                title: "Sun",
                items: ["sunrise", "sunset"].map((event) => ({
                  value: event,
                  label: event === "sunrise" ? "Sunrise" : "Sunset",
                  art: (
                    <span className="picker-icon tone-yellow">
                      <Icon name="sun" size={17} />
                    </span>
                  ),
                })),
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
              value === "sunrise" || value === "sunset"
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
              value={rule.weatherValue}
              onChange={(weatherValue) => set({ weatherValue })}
            />
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
