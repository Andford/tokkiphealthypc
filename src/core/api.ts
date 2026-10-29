// What the page asks the app (src-tauri/src/lib.rs). Outside the app (vite in a
// browser, for the look) it answers with an example PC, so every page can be seen.

import { invoke } from "@tauri-apps/api/core";

export type Mood = "happy" | "calm" | "tired" | "dizzy";

export interface Reason {
  id: "disk" | "clean";
  level: "ok" | "warn" | "bad";
}

export interface Health {
  score: number;
  mood: Mood;
  diskTotal: number;
  diskFree: number;
  /** ms since 1970; 0 = never. */
  lastClean: number;
  lastFreed: number;
  totalFreed: number;
  elevated: boolean;
  reasons: Reason[];
}

export type Group = "system" | "browsers" | "apps";

export interface RuleScan {
  id: string;
  group: Group;
  name: string;
  nameEn: string;
  about: string;
  aboutEn: string;
  admin: boolean;
  running: boolean;
  bytes: number;
  files: number;
}

export interface CleanReport {
  freed: number;
  files: number;
  skipped: number;
  needsAdmin: string[];
}

export const inApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const DAY = 86_400_000;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const demo = {
  health: {
    score: 70, mood: "calm", diskTotal: 476 * GB, diskFree: 61 * GB, lastClean: Date.now() - 19 * DAY,
    lastFreed: 1.4 * GB, totalFreed: 6.8 * GB, elevated: false,
    reasons: [{ id: "disk", level: "warn" }, { id: "clean", level: "warn" }],
  } as Health,
  scan: [
    ["user-temp", "system", "Temporales tuyos", "Your temporary files", "Lo que los programas dejan al trabajar y ya no usan.", "What programs leave behind while working and no longer use.", false, false, 812 * MB, 2310],
    ["windows-temp", "system", "Temporales de Windows", "Windows temporary files", "Lo que Windows y los instaladores dejan atrás.", "What Windows and installers leave behind.", true, false, 233 * MB, 412],
    ["thumbnails", "system", "Miniaturas", "Thumbnails", "Las vistas previas de tus fotos; Windows las vuelve a hacer.", "Previews of your pictures; Windows makes them again.", false, false, 148 * MB, 12],
    ["crash-dumps", "system", "Volcados de errores", "Crash dumps", "Lo que guardan los programas cuando se cierran de golpe.", "What programs save when they crash.", false, false, 96 * MB, 7],
    ["recycle-bin", "system", "Papelera", "Recycle Bin", "Lo que borraste. Vaciarla no se puede deshacer.", "What you deleted. Emptying it can't be undone.", false, false, 1.1 * GB, 86],
    ["chrome", "browsers", "Google Chrome", "Google Chrome", "Caché: páginas y código guardados para cargar más rápido.", "Cache: pages and code kept to load faster.", false, true, 540 * MB, 3100],
    ["edge", "browsers", "Microsoft Edge", "Microsoft Edge", "Caché: páginas y código guardados para cargar más rápido.", "Cache: pages and code kept to load faster.", false, false, 310 * MB, 1800],
    ["discord", "apps", "Discord", "Discord", "Imágenes y código guardados de tus chats.", "Pictures and code kept from your chats.", false, false, 205 * MB, 940],
    ["steam", "apps", "Steam", "Steam", "Las páginas de la tienda guardadas.", "Saved store pages.", false, false, 0, 0],
  ].map(([id, group, name, nameEn, about, aboutEn, admin, running, bytes, files]) => ({ id, group, name, nameEn, about, aboutEn, admin, running, bytes, files }) as RuleScan),
};

export async function health(): Promise<Health> {
  if (!inApp) return demo.health;
  return invoke<Health>("health");
}

export async function scan(): Promise<RuleScan[]> {
  if (!inApp) {
    await wait(1800);
    return demo.scan;
  }
  return invoke<RuleScan[]>("cleaner_scan");
}

export async function clean(ids: string[]): Promise<CleanReport> {
  if (!inApp) {
    await wait(2200);
    const picked = demo.scan.filter((r) => ids.includes(r.id));
    const ran = picked.filter((r) => !r.admin);
    demo.health = { ...demo.health, score: 90, mood: "happy", lastClean: Date.now(), reasons: [{ id: "disk", level: "warn" }, { id: "clean", level: "ok" }] };
    return {
      freed: ran.reduce((s, r) => s + r.bytes * (r.running ? 0.6 : 1), 0),
      files: ran.reduce((s, r) => s + r.files, 0),
      skipped: ran.filter((r) => r.running).reduce((s, r) => s + Math.round(r.files * 0.4), 0),
      needsAdmin: picked.filter((r) => r.admin).map((r) => r.id),
    };
  }
  return invoke<CleanReport>("cleaner_clean", { ids });
}

/** Opens the app again as administrator; false if Windows (or you) said no. */
export async function relaunchAdmin(): Promise<boolean> {
  if (!inApp) return false;
  return invoke<boolean>("relaunch_admin");
}

/** Tells Tokkip PC, on the island, how the PC is. */
export async function tokkipNotice(n: { score: number; mood: string; kind: "clean" | "care" | "status"; message: string; bytes?: number }) {
  if (!inApp) return;
  await invoke("tokkip_notice", { score: n.score, mood: n.mood, kind: n.kind, message: n.message, bytes: n.bytes ?? null }).catch(() => {});
}
