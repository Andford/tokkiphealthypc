// Copied from Andford/tokkip (windows/src) by scripts/sync-tokkip.mjs — change it there.
// Tokkip PC's colours: a Material 3 scheme grown from one seed colour (Tokkip's
// own accent, or one you pick), light or dark, or following Windows. Every
// window (the island, Settings, Tokkip on the desktop) reads it from here and
// gets it as CSS variables (`--c-primary`, `--c-surface-container`…), so they
// all change together. Kept in localStorage, which the three windows share.

import {
  Hct, MaterialDynamicColors as D, SchemeTonalSpot, argbFromHex, hexFromArgb,
} from "@material/material-color-utilities";
import { loadLook, onLookChange } from "../tokkip/tokkip";

export type ThemeMode = "system" | "light" | "dark";

export interface ThemePrefs {
  mode: ThemeMode;
  /** The seed colour, #RRGGBB; "" grows the scheme from Tokkip's own accent. */
  seed: string;
}

export const DEFAULT_THEME: ThemePrefs = { mode: "system", seed: "" };

/** Seeds offered in Settings ("" = Tokkip's colour). */
export const SEEDS: readonly string[] = ["", "#3F9E9A", "#6750A4", "#4C8DF6", "#D9628F", "#E8735A", "#E3A33B", "#5C9E4A"];

const KEY = "tokkip.theme";
const EVENT = "tokkip-theme";
const HEX = /^#[0-9a-f]{6}$/i;

export function parseTheme(raw: unknown): ThemePrefs {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const mode = o.mode === "light" || o.mode === "dark" ? o.mode : "system";
  const seed = typeof o.seed === "string" && HEX.test(o.seed) ? o.seed : "";
  return { mode, seed };
}

export function loadTheme(): ThemePrefs {
  try {
    return parseTheme(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {
    return { ...DEFAULT_THEME };
  }
}

export function saveTheme(prefs: ThemePrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(parseTheme(prefs)));
  } catch {
    /* not kept: it still applies to this window */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

// ── The scheme ────────────────────────────────────────────────────────────────

/** Every colour role, as CSS variable names (camelCase role → --c-kebab-case). */
const ROLES = [
  "primary", "onPrimary", "primaryContainer", "onPrimaryContainer",
  "secondary", "onSecondary", "secondaryContainer", "onSecondaryContainer",
  "tertiary", "onTertiary", "tertiaryContainer", "onTertiaryContainer",
  "error", "onError", "errorContainer", "onErrorContainer",
  "surface", "surfaceDim", "surfaceBright", "onSurface", "onSurfaceVariant",
  "surfaceContainerLowest", "surfaceContainerLow", "surfaceContainer",
  "surfaceContainerHigh", "surfaceContainerHighest",
  "outline", "outlineVariant", "inverseSurface", "inverseOnSurface", "inversePrimary",
  "shadow", "scrim",
] as const;

export type Role = (typeof ROLES)[number];
export type Palette = Record<Role, string> & { dark: boolean };

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

/** The scheme for `seed` (#RRGGBB) in light or dark. */
export function schemeFor(seed: string, dark: boolean): Palette {
  const scheme = new SchemeTonalSpot(Hct.fromInt(argbFromHex(HEX.test(seed) ? seed : "#3F9E9A")), dark, 0);
  const out = { dark } as Palette;
  for (const role of ROLES) {
    const dyn = (D as unknown as Record<string, { getArgb(s: unknown): number }>)[role];
    out[role] = hexFromArgb(dyn.getArgb(scheme));
  }
  return out;
}

function systemDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return true;
  }
}

export function isDark(prefs: ThemePrefs = loadTheme()): boolean {
  return prefs.mode === "system" ? systemDark() : prefs.mode === "dark";
}

/** The seed in force: the one picked, else Tokkip's accent. */
export function seedOf(prefs: ThemePrefs = loadTheme()): string {
  return prefs.seed || loadLook().accent;
}

let current: Palette | null = null;

/** The palette in force (for canvases, which can't read CSS variables cheaply). */
export function palette(): Palette {
  if (current) return current;
  if (typeof document === "undefined") return schemeFor("#3F9E9A", true);
  return applyTheme();
}

/** `hex` (#RRGGBB) with alpha `a`, for canvases. */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Writes the scheme onto `root` as CSS variables, and returns it. */
export function applyTheme(root: HTMLElement = document.documentElement): Palette {
  const prefs = loadTheme();
  const p = schemeFor(seedOf(prefs), isDark(prefs));
  for (const role of ROLES) root.style.setProperty(`--c-${kebab(role)}`, p[role]);
  root.dataset.theme = p.dark ? "dark" : "light";
  root.style.colorScheme = p.dark ? "dark" : "light";
  current = p;
  return p;
}

/** Keeps `root` in step with the preferences, Windows' light/dark and Tokkip's colour. */
export function watchTheme(onChange?: (p: Palette) => void, root: HTMLElement = document.documentElement) {
  const update = () => {
    const p = applyTheme(root);
    onChange?.(p);
  };
  update();
  window.addEventListener(EVENT, update);
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) update();
  });
  try {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", update);
  } catch {
    /* no media queries: the mode chosen still applies */
  }
  onLookChange(update);
}
