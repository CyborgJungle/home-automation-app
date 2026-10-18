// Shared by the root layout (server) and lib/theme.ts (client).
//
// The chosen appearance lives in <meta name="color-scheme">: "light dark"
// follows the iPhone (including Automatic at sunset), "light" or "dark" pins
// one. globals.css maps that meta to the CSS `color-scheme` property.

export type ThemePref = "system" | "light" | "dark";

export const THEME_KEY = "color-scheme";

// Page backgrounds, for the browser and status bar (theme-color).
export const THEME_COLORS = { light: "#f4eee3", dark: "#14110d" } as const;

// Runs inline before the page paints, so a pinned scheme never flashes.
export const THEME_SCRIPT = `try{var p=localStorage.getItem("${THEME_KEY}");if(p==="light"||p==="dark"){document.querySelectorAll('meta[name="color-scheme"]').forEach(function(m){m.content=p});document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.content=p==="dark"?"${THEME_COLORS.dark}":"${THEME_COLORS.light}"})}}catch(e){}`;
