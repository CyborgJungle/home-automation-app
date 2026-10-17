"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { THEME_COLORS, THEME_KEY, type ThemePref } from "@/lib/theme-script";

const DARK_QUERY = "(prefers-color-scheme: dark)";
const CHANGED = "home:theme-change";

// Used when localStorage is blocked, so the choice still applies until reload.
let fallback: ThemePref = "system";

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return fallback;
  }
}

// Points the <meta> tags at the choice; CSS follows meta[name="color-scheme"].
function applyPref(pref: ThemePref) {
  document.querySelectorAll<HTMLMetaElement>('meta[name="color-scheme"]').forEach((m) => {
    m.content = pref === "system" ? "light dark" : pref;
  });
  // Each theme-color tag carries a media query; when pinned, both show the pinned colour.
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    m.content = THEME_COLORS[pref !== "system" ? pref : m.media.includes("dark") ? "dark" : "light"];
  });
}

function subscribePref(onChange: () => void) {
  // Another tab changed it: apply it here too.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== THEME_KEY) return;
    applyPref(readPref());
    onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGED, onChange);
  };
}

function subscribeSystem(onChange: () => void) {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useTheme() {
  const pref = useSyncExternalStore(subscribePref, readPref, () => "system" as const);
  const systemDark = useSyncExternalStore(subscribeSystem, () => window.matchMedia(DARK_QUERY).matches, () => false);

  const setPref = useCallback((next: ThemePref) => {
    fallback = next;
    try {
      // "system" is the absence of a choice, so a later iPhone switch is followed again.
      if (next === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage blocked: still apply it for this visit.
    }
    applyPref(next);
    window.dispatchEvent(new Event(CHANGED));
  }, []);

  return { pref, setPref, dark: pref === "dark" || (pref === "system" && systemDark) };
}

// The inline script only sets the color-scheme meta; this also fixes the
// theme-color tags once the page is up.
export function ThemeSync() {
  useEffect(() => applyPref(readPref()), []);
  return null;
}
