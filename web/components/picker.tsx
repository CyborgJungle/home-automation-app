"use client";

// A compact, searchable replacement for <select>: a one-line button that
// opens a sheet with a search field and a grouped list. Plus ChipChoice for
// short lists, where tapping a chip beats opening a menu.

import { useMemo, useState } from "react";
import { Icon, SceneArt } from "@/components/icons";
import { Sheet } from "@/components/ui";
import { CATEGORIES, iconOf, KIND_LABELS, toneOf } from "@/lib/devices";
import type { Device, Scene } from "@/lib/supabase";

export type PickerItem = {
  value: string;
  label: string;
  sub?: string;
  art: React.ReactNode;
};

export type PickerGroup = { title: string; items: PickerItem[] };

// Ignore case and accents, so "trad" finds "TRÅDFRI".
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function Picker({
  label,
  placeholder,
  value,
  groups,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  groups: PickerGroup[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const all = groups.flatMap((g) => g.items);
  const selected = all.find((i) => i.value === value);

  const shown = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return groups;
    return groups
      .map((g) => ({ ...g, items: g.items.filter((i) => fold(`${i.label} ${i.sub ?? ""} ${g.title}`).includes(q)) }))
      .filter((g) => g.items.length > 0);
  }, [groups, query]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <>
      <button type="button" className={selected ? "picker" : "picker empty"} aria-haspopup="dialog" aria-label={label} onClick={() => setOpen(true)}>
        {selected ? (
          <>
            <span className="picker-art">{selected.art}</span>
            <span className="picker-text">
              <strong>{selected.label}</strong>
              {selected.sub && <span>{selected.sub}</span>}
            </span>
          </>
        ) : (
          <span className="picker-text">
            <strong>{placeholder}</strong>
          </span>
        )}
        <Icon name="down" size={16} stroke={2.6} />
      </button>

      <Sheet open={open} onClose={close} title={label} tall>
        <div className="picker-search">
          <Icon name="search" size={18} />
          <input
            type="search"
            value={query}
            placeholder="Search"
            enterKeyHint="search"
            autoComplete="off"
            aria-label={`Search ${label.toLowerCase()}`}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter picks the only (or first) match.
              const first = shown[0]?.items[0];
              if (e.key === "Enter" && first) {
                onChange(first.value);
                close();
              }
            }}
          />
          {query && (
            <button type="button" className="round small" aria-label="Clear search" onClick={() => setQuery("")}>
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
        {shown.length === 0 && <p className="muted picker-none">Nothing matches “{query}”.</p>}
        {shown.map((g) => (
          <div key={g.title} className="picker-group">
            <h3>{g.title}</h3>
            <div className="picker-list" role="listbox" aria-label={g.title}>
              {g.items.map((i) => (
                <button
                  type="button"
                  key={i.value}
                  role="option"
                  aria-selected={i.value === value}
                  className={i.value === value ? "picker-option selected" : "picker-option"}
                  onClick={() => {
                    onChange(i.value);
                    close();
                  }}
                >
                  <span className="picker-art">{i.art}</span>
                  <span className="picker-text">
                    <strong>{i.label}</strong>
                    {i.sub && <span>{i.sub}</span>}
                  </span>
                  {i.value === value && <Icon name="check" size={18} stroke={3} />}
                </button>
              ))}
            </div>
          </div>
        ))}
      </Sheet>
    </>
  );
}

export function ChipChoice({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="chip-choice" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? "selected" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ready-made items

export function deviceItem(d: Device): PickerItem {
  const kind = KIND_LABELS[d.kind] ?? d.kind;
  const sub = [d.name.toLowerCase() === kind.toLowerCase() ? null : kind, d.room && d.room !== d.name ? d.room : null]
    .filter(Boolean)
    .join(" · ");
  return {
    value: d.id,
    label: d.name,
    sub: sub || undefined,
    art: (
      <span className={`picker-icon tone-${toneOf(d)}`}>
        <Icon name={iconOf(d)} size={17} />
      </span>
    ),
  };
}

// Devices grouped the same way as on the Home tab.
export function deviceGroups(devices: Device[]): PickerGroup[] {
  return CATEGORIES.map((c) => ({
    title: c.title,
    items: devices
      .filter((d) => c.kinds.includes(d.kind))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(deviceItem),
  })).filter((g) => g.items.length > 0);
}

export function sceneItem(s: Scene, value = s.id): PickerItem {
  return {
    value,
    label: s.name,
    sub: `Scene · ${s.actions.length} ${s.actions.length === 1 ? "device" : "devices"}`,
    art: <SceneArt shape={s.shape} tone={s.tone} awake size={34} />,
  };
}
