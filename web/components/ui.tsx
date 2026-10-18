"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconKey } from "@/components/icons";
import { ON_PI } from "@/lib/devices";
import { useHome } from "@/lib/home";

const TABS: { href: string; label: string; icon: IconKey }[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/scenes", label: "Scenes", icon: "sparkle" },
  { href: "/automations", label: "Automations", icon: "bolt" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export function PiStatus({ inline = false }: { inline?: boolean }) {
  const path = usePathname();
  const { agent, agentOnline, devices } = useHome();
  if (!inline && path === "/") return null;
  if (!agent && !devices.some((d) => ON_PI.includes(d.integration))) return null;

  const status = (
    <span className={`pi-status${agentOnline ? "" : " offline"}`} role="status" aria-label={`Raspberry Pi ${agentOnline ? "online" : "offline"}`}>
      <span className="pi-status-dot" aria-hidden="true" />
      Pi {agentOnline ? "online" : "offline"}
    </span>
  );

  return inline ? status : <div className="app-status">{status}</div>;
}

export function TabBar() {
  const path = usePathname();
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((t) => {
        const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={active ? "tab active" : "tab"} aria-current={active ? "page" : undefined}>
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  tone,
  tall,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  tone?: string;
  // Fixed height, so the sheet doesn't jump while a search narrows its list.
  tall?: boolean;
  children: React.ReactNode;
}) {
  // Keep the page behind from scrolling while the sheet is up.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Nothing to portal into during server rendering.
  if (!open || typeof document === "undefined") return null;
  // Rendered at the end of <body>, so a sheet opened from inside another
  // sheet (like a picker in an editor) always sits on top of it.
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className={tall ? "sheet tall" : "sheet"}
        role="dialog"
        aria-modal="true"
        style={tone ? ({ "--sheet-tone": `var(--${tone})` } as React.CSSProperties) : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" />
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="round" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={on ? "switch on" : "switch"}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
    >
      <span />
    </button>
  );
}

// A big, thumb-friendly bar like iOS Control Centre: drag anywhere on it.
// Sends its value when you let go, not on every move.
export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  label,
  format,
  onCommit,
  disabled,
  track,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  format: (n: number) => string;
  onCommit: (n: number) => void;
  disabled?: boolean;
  // A background for the whole bar (e.g. a colour gradient) instead of a fill.
  track?: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const draft = useRef<number | null>(null);
  const [shown, setShown] = useState<number | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  // Keep showing what was sent until the device reports (about) that value,
  // or give up after a few seconds if it never does.
  const holding = sent !== null && Math.abs(value - sent) > step;
  const current = shown ?? (holding ? sent : value);

  useEffect(() => {
    if (sent === null) return;
    const timer = setTimeout(() => setSent(null), 5000);
    return () => clearTimeout(timer);
  }, [sent]);
  const pct = ((current - min) / (max - min)) * 100;

  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n / step) * step));
  const at = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return clamp(min + ((clientX - r.left) / r.width) * (max - min));
  };
  const move = (n: number) => {
    draft.current = n;
    setShown(n);
  };
  const commit = () => {
    const n = draft.current;
    if (n !== null && n !== (holding ? sent : value)) {
      setSent(n);
      onCommit(n);
    }
    draft.current = null;
    setShown(null);
  };

  return (
    <div
      ref={bar}
      className={["slider", track && "track", disabled && "disabled"].filter(Boolean).join(" ")}
      style={{ "--pct": `${pct}%`, ...(track ? { "--track": track } : {}) } as React.CSSProperties}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={current}
      aria-valuetext={format(current)}
      aria-disabled={disabled}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        move(at(e.clientX));
      }}
      onPointerMove={(e) => {
        if (draft.current !== null) move(at(e.clientX));
      }}
      onPointerUp={commit}
      onPointerCancel={commit}
      onKeyDown={(e) => {
        if (disabled) return;
        const delta = e.key === "ArrowRight" || e.key === "ArrowUp" ? step : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -step : 0;
        if (!delta) return;
        e.preventDefault();
        draft.current = clamp(current + delta);
        commit();
      }}
    >
      <span className="slider-fill" />
      <span className="slider-label">{label}</span>
      <span className="slider-value">{format(current)}</span>
    </div>
  );
}

export function Toasts() {
  const { toasts, updateReady } = useHome();
  return (
    <div className="toasts" aria-live="polite">
      {updateReady && (
        <button className="toast update" onClick={() => window.location.reload()}>
          A new version is ready · <strong>Tap to update</strong>
        </button>
      )}
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function timeAgo(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "never";
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
