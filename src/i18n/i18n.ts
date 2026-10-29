// Healthy PC speaks Spanish (Mexican, de tú) and English. The keys are the
// English texts; their Spanish is in es.json. `{name}` in a text is a variable.

import es from "./es.json";

export const LANGUAGE_CODES = ["es", "en"] as const;
export type Language = (typeof LANGUAGE_CODES)[number];
export const LANGUAGES: readonly { code: Language; name: string }[] = [
  { code: "es", name: "Español" },
  { code: "en", name: "English" },
];
export type Vars = Record<string, string | number>;

const KEY = "tokkip.language";
const SPANISH = es as Record<string, string>;
const listeners = new Set<(lang: Language) => void>();

export function isLanguage(code: unknown): code is Language {
  return typeof code === "string" && (LANGUAGE_CODES as readonly string[]).includes(code);
}

/** The picked language, else the system's when it is English, else Spanish. */
export function resolveLanguage(picked: string | null | undefined, system: readonly string[]): Language {
  if (isLanguage(picked)) return picked;
  for (const s of system) {
    const base = s.toLowerCase().split("-")[0];
    if (isLanguage(base)) return base;
  }
  return "es";
}

function stored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

let current: Language =
  typeof navigator === "undefined" ? "es" : resolveLanguage(stored(), navigator.languages ?? [navigator.language]);

export function language(): Language {
  return current;
}

export function setLanguage(lang: Language) {
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* not kept */
  }
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  for (const l of listeners) l(lang);
}

export function onLanguageChange(cb: (lang: Language) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** The text for `key` in the current language. */
export function t(key: string, vars?: Vars): string {
  return fill(current === "es" ? (SPANISH[key] ?? key) : key, vars);
}

/** One or other by count; `{n}` is the count. */
export function tn(one: string, other: string, n: number, vars?: Vars): string {
  return t(n === 1 ? one : other, { n, ...vars });
}

/** Marks a key for translation without translating it yet. */
export function N_<T extends string>(key: T): T {
  return key;
}

/** A record of keys, translated each time it is read. */
export function labels<K extends string>(keys: Record<K, string>): Record<K, string> {
  return new Proxy(keys, { get: (o, k) => (typeof k === "string" && k in o ? t(o[k as K]) : undefined) });
}

export function allKeys(): string[] {
  return Object.keys(SPANISH);
}
