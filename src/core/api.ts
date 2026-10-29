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

// ── Almacenamiento ───────────────────────────────────────────────────────

export interface Drive {
  root: string;
  label: string;
  total: number;
  free: number;
  system: boolean;
  removable: boolean;
}

export interface SpaceDay {
  /** Days since 1970. */
  day: number;
  free: number;
  total: number;
}

export interface MapNode {
  name: string;
  /** Empty for "the rest" (loose files and small folders). */
  path: string;
  bytes: number;
  files: number;
  children: MapNode[];
}

export type FileKind = "video" | "image" | "music" | "document" | "archive" | "installer" | "app" | "other";

export interface KindTotal {
  kind: FileKind;
  bytes: number;
  files: number;
}

export interface BigFile {
  id: number;
  name: string;
  folder: string;
  bytes: number;
  modified: number;
  kind: FileKind;
}

export interface Analysis {
  root: MapNode;
  kinds: KindTotal[];
  big: BigFile[];
  unreadable: number;
  cancelled: boolean;
}

export interface Removed {
  freed: number;
  files: number;
  kept: number[];
}

export interface DupCopy {
  id: number;
  path: string;
  modified: number;
}

export interface DupGroup {
  bytes: number;
  kind: FileKind;
  /** The first is the one to keep. */
  copies: DupCopy[];
}

export interface DupFound {
  groups: DupGroup[];
  files: number;
  cancelled: boolean;
}

export interface EmptyFolder {
  id: number;
  path: string;
  depth: number;
}

export interface EmptyFound {
  folders: EmptyFolder[];
  scanned: number;
  cancelled: boolean;
}

export type DownloadKind = "installer" | "archive" | "diskImage" | "other";

export interface Download {
  id: number;
  name: string;
  bytes: number;
  modified: number;
  kind: DownloadKind;
}

export interface DownloadsFound {
  folder: string;
  files: Download[];
}

export interface ShredChoice {
  path: string;
  name: string;
  bytes: number;
  files: number;
  folder: boolean;
  protected: boolean;
}

export interface Shredded {
  files: number;
  bytes: number;
  failed: number;
  cancelled: boolean;
}

export interface Report {
  tool: string;
  files: number;
  bytes: number;
  path: string;
}

/** Hears how a long walk goes. Returns how to stop listening. */
export async function onProgress(cb: (r: Report) => void): Promise<() => void> {
  if (!inApp) {
    let files = 0;
    const timer = window.setInterval(() => {
      files += 1873;
      cb({ tool: "demo", files, bytes: files * 412_000, path: "C:\\Users\\Andy\\Videos\\Viajes\\2025\\clip_" + files + ".mp4" });
    }, 150);
    return () => window.clearInterval(timer);
  }
  const { listen } = await import("@tauri-apps/api/event");
  return listen<Report>("progress", (e) => cb(e.payload));
}

export async function cancel() {
  if (inApp) await invoke("cancel");
}

export async function homeDir(): Promise<string> {
  if (!inApp) return "C:\\Users\\Andy";
  const { homeDir } = await import("@tauri-apps/api/path");
  return homeDir();
}

/** Asks for a folder (or files, or folders) with Windows' own window. */
export async function pickPaths(opts: { directory: boolean; multiple: boolean; title: string }): Promise<string[]> {
  if (!inApp) return opts.directory ? ["C:\\Users\\Andy\\Documents\\Viejo"] : ["C:\\Users\\Andy\\Desktop\\contraseñas viejas.txt"];
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ directory: opts.directory, multiple: opts.multiple, title: opts.title });
  if (!r) return [];
  return Array.isArray(r) ? r : [r];
}

export async function revealFound(id: number) {
  if (inApp) await invoke("reveal", { id });
}

const D = 86_400_000;
const today = Math.floor(Date.now() / D);

const demoStorage = {
  drives: [
    { root: "C:\\", label: "Windows", total: 476 * GB, free: 61 * GB, system: true, removable: false },
    { root: "D:\\", label: "Datos", total: 931 * GB, free: 402 * GB, system: false, removable: false },
  ] as Drive[],
  history: Array.from({ length: 90 }, (_, i) => {
    const day = today - 89 + i;
    const free = 92 * GB - i * 0.42 * GB + (i % 9 === 0 ? 6 * GB : 0) + Math.sin(i / 4) * GB;
    return { day, free, total: 476 * GB };
  }) as SpaceDay[],
  analysis(): Analysis {
    const n = (name: string, gb: number, children: MapNode[] = []): MapNode => ({
      name, path: name ? `C:\\${name}` : "", bytes: gb * GB, files: Math.round(gb * 900), children,
    });
    const users = n("Users", 212, [
      n("Andy", 205, [n("Videos", 74), n("AppData", 48), n("Documents", 31), n("Downloads", 22), n("Pictures", 18), n("OneDrive", 9), n("", 3)]),
      n("Public", 4), n("", 3),
    ]);
    const root = n("C:", 415, [
      users,
      n("Windows", 38, [n("WinSxS", 11), n("System32", 9), n("SoftwareDistribution", 6), n("Installer", 5), n("", 7)]),
      n("Program Files", 61, [n("Steam", 34), n("Adobe", 12), n("Microsoft Office", 6), n("", 9)]),
      n("Program Files (x86)", 22), n("ProgramData", 14), n("XboxGames", 52), n("pagefile.sys", 0), n("", 16),
    ]);
    root.path = "C:\\";
    return {
      root,
      kinds: [
        ["video", 96], ["app", 88], ["other", 71], ["installer", 52], ["image", 38], ["document", 21], ["archive", 19], ["music", 12],
      ].map(([kind, gb]) => ({ kind, bytes: (gb as number) * GB, files: (gb as number) * 410 }) as KindTotal),
      big: [
        ["Viaje Mazatlán 4K.mp4", "C:\\Users\\Andy\\Videos\\Viajes", 14.2, "video", 400],
        ["Win11_24H2_Spanish_x64.iso", "C:\\Users\\Andy\\Downloads", 5.8, "installer", 230],
        ["Respaldo celular 2024.zip", "C:\\Users\\Andy\\Documents\\Respaldos", 4.1, "archive", 310],
        ["boda-prima-editado.mov", "C:\\Users\\Andy\\Videos", 3.6, "video", 120],
        ["Ubuntu-24.04-desktop.iso", "C:\\Users\\Andy\\Downloads", 2.9, "installer", 520],
        ["proyecto final.psd", "C:\\Users\\Andy\\Documents\\Diseño", 1.2, "image", 80],
        ["Steam_setup_old.exe", "C:\\Users\\Andy\\Downloads", 0.9, "installer", 700],
        ["podcast ep 12 crudo.wav", "C:\\Users\\Andy\\Music\\Podcast", 0.7, "music", 40],
      ].map(([name, folder, gb, kind, days], i) => ({ id: i + 1, name, folder, bytes: (gb as number) * GB, modified: Date.now() - (days as number) * D, kind }) as BigFile),
      unreadable: 214,
      cancelled: false,
    };
  },
  dups: {
    files: 48_210,
    cancelled: false,
    groups: [
      { bytes: 2.1 * GB, kind: "video", copies: [
        { id: 101, path: "C:\\Users\\Andy\\Videos\\graduación.mp4", modified: Date.now() - 300 * D },
        { id: 102, path: "C:\\Users\\Andy\\Downloads\\graduación (1).mp4", modified: Date.now() - 200 * D },
      ] },
      { bytes: 640 * MB, kind: "archive", copies: [
        { id: 103, path: "C:\\Users\\Andy\\Documents\\fotos 2023.zip", modified: Date.now() - 400 * D },
        { id: 104, path: "C:\\Users\\Andy\\Desktop\\fotos 2023.zip", modified: Date.now() - 390 * D },
        { id: 105, path: "C:\\Users\\Andy\\Downloads\\fotos 2023 (2).zip", modified: Date.now() - 380 * D },
      ] },
      { bytes: 12 * MB, kind: "document", copies: [
        { id: 106, path: "C:\\Users\\Andy\\Documents\\factura.pdf", modified: Date.now() - 30 * D },
        { id: 107, path: "C:\\Users\\Andy\\Downloads\\factura.pdf", modified: Date.now() - 31 * D },
      ] },
    ],
  } as DupFound,
  empty: {
    scanned: 8_412,
    cancelled: false,
    folders: [
      "C:\\Users\\Andy\\Documents\\Proyecto viejo\\assets\\temp",
      "C:\\Users\\Andy\\Documents\\Proyecto viejo\\assets",
      "C:\\Users\\Andy\\Pictures\\Capturas\\2021",
      "C:\\Users\\Andy\\Desktop\\Nueva carpeta",
      "C:\\Users\\Andy\\Desktop\\Nueva carpeta (2)",
    ].map((path, i) => ({ id: 200 + i, path, depth: 3 - Math.min(i, 2) })),
  } as EmptyFound,
  downloads: {
    folder: "C:\\Users\\Andy\\Downloads",
    files: [
      ["Win11_24H2_Spanish_x64.iso", 5.8 * GB, 230, "diskImage"],
      ["Ubuntu-24.04-desktop.iso", 2.9 * GB, 520, "diskImage"],
      ["Steam_setup_old.exe", 0.9 * GB, 700, "installer"],
      ["fotos boda.zip", 820 * MB, 60, "archive"],
      ["ChromeSetup.exe", 9 * MB, 410, "installer"],
      ["factura-octubre.pdf", 2 * MB, 12, "other"],
      ["Cotización Sumo.docx", 0.4 * MB, 3, "other"],
    ].map(([name, bytes, days, kind], i) => ({ id: 300 + i, name, bytes, modified: Date.now() - (days as number) * D, kind }) as Download),
  } as DownloadsFound,
};

export async function drives(): Promise<Drive[]> {
  return inApp ? invoke<Drive[]>("drives") : demoStorage.drives;
}

export async function spaceHistory(): Promise<SpaceDay[]> {
  return inApp ? invoke<SpaceDay[]>("space_history") : demoStorage.history;
}

export async function analyze(root: string): Promise<Analysis> {
  if (!inApp) {
    await wait(2600);
    return demoStorage.analysis();
  }
  return invoke<Analysis>("storage_analyze", { root });
}

export async function removeBig(ids: number[]): Promise<Removed> {
  if (!inApp) {
    await wait(900);
    return { freed: ids.length * 3.1 * GB, files: ids.length, kept: [] };
  }
  return invoke<Removed>("big_remove", { ids });
}

export async function findDuplicates(root: string): Promise<DupFound> {
  if (!inApp) {
    await wait(2400);
    return demoStorage.dups;
  }
  return invoke<DupFound>("duplicates_find", { root });
}

export async function removeDuplicates(ids: number[]): Promise<Removed> {
  if (!inApp) {
    await wait(900);
    return { freed: ids.length * 700 * MB, files: ids.length, kept: [] };
  }
  return invoke<Removed>("duplicates_remove", { ids });
}

export async function findEmpty(root: string): Promise<EmptyFound> {
  if (!inApp) {
    await wait(1400);
    return demoStorage.empty;
  }
  return invoke<EmptyFound>("empty_find", { root });
}

export async function removeEmpty(ids: number[]): Promise<{ removed: number; kept: number[] }> {
  if (!inApp) {
    await wait(500);
    return { removed: ids.length, kept: [] };
  }
  const [removed, kept] = await invoke<[number, number[]]>("empty_remove", { ids });
  return { removed, kept };
}

export async function findDownloads(): Promise<DownloadsFound> {
  if (!inApp) {
    await wait(500);
    return demoStorage.downloads;
  }
  return invoke<DownloadsFound>("downloads_find");
}

export async function removeDownloads(ids: number[]): Promise<Removed> {
  if (!inApp) {
    await wait(700);
    const files = demoStorage.downloads.files.filter((f) => ids.includes(f.id));
    return { freed: files.reduce((s, f) => s + f.bytes, 0), files: files.length, kept: [] };
  }
  return invoke<Removed>("downloads_remove", { ids });
}

export async function describeShred(paths: string[]): Promise<ShredChoice[]> {
  if (!inApp) {
    return paths.map((path) => ({ path, name: path.split("\\").pop() ?? path, bytes: path.endsWith(".txt") ? 18_000 : 240 * MB, files: path.endsWith(".txt") ? 1 : 38, folder: !path.endsWith(".txt"), protected: false }));
  }
  return invoke<ShredChoice[]>("shred_describe", { paths });
}

export async function shred(paths: string[]): Promise<Shredded> {
  if (!inApp) {
    await wait(1600);
    return { files: 39, bytes: 240 * MB, failed: 0, cancelled: false };
  }
  return invoke<Shredded>("shred", { paths });
}

// ── Software ─────────────────────────────────────────────────────────────

export interface StartupItem {
  id: number;
  name: string;
  command: string;
  source: "user" | "machine" | "machine32" | "userFolder" | "machineFolder";
  enabled: boolean;
  admin: boolean;
}

export interface Program {
  id: number;
  name: string;
  publisher: string;
  version: string;
  /** YYYYMMDD, or empty. */
  installed: string;
  bytes: number;
  location: string;
  user: boolean;
}

const demoSoftware = {
  startup: [
    ["Discord", "C:\\Users\\Andy\\AppData\\Local\\Discord\\Update.exe --processStart Discord.exe", "user", true],
    ["Spotify", "C:\\Users\\Andy\\AppData\\Roaming\\Spotify\\Spotify.exe /minimized", "user", true],
    ["Steam", "\"C:\\Program Files (x86)\\Steam\\steam.exe\" -silent", "user", false],
    ["SecurityHealth", "%windir%\\system32\\SecurityHealthSystray.exe", "machine", true],
    ["Tokkip", "C:\\Users\\Andy\\AppData\\Local\\Tokkip\\tokkip.exe", "user", true],
  ].map(([name, command, source, enabled], i) => ({ id: 400 + i, name, command, source, enabled, admin: source !== "user" }) as StartupItem),
  programs: [
    ["Adobe Photoshop 2025", "Adobe", "26.1", "20250310", 4.6 * GB],
    ["Discord", "Discord Inc.", "1.0.9170", "20240812", 410 * MB],
    ["Google Chrome", "Google LLC", "130.0", "20230101", 520 * MB],
    ["McAfee LiveSafe", "McAfee, LLC", "16.0", "20230101", 890 * MB],
    ["Steam", "Valve Corporation", "2.10", "20220405", 610 * MB],
    ["Visual Studio Code", "Microsoft Corporation", "1.94", "20241001", 380 * MB],
    ["WinRAR 6.24", "win.rar GmbH", "6.24", "20210915", 9 * MB],
  ].map(([name, publisher, version, installed, bytes], i) => ({ id: 500 + i, name, publisher, version, installed, bytes, location: "", user: false }) as Program),
};

export async function startupList(): Promise<StartupItem[]> {
  return inApp ? invoke<StartupItem[]>("startup_list") : demoSoftware.startup;
}

/** Throws "admin" when it needs administrator rights. */
export async function startupSet(id: number, on: boolean): Promise<void> {
  if (!inApp) {
    const it = demoSoftware.startup.find((s) => s.id === id);
    if (it?.admin) throw "admin";
    if (it) it.enabled = on;
    return;
  }
  await invoke("startup_set", { id, on });
}

export async function programsList(): Promise<Program[]> {
  if (!inApp) {
    await wait(400);
    return demoSoftware.programs;
  }
  return invoke<Program[]>("programs_list");
}

/** Opens the program's own uninstaller; true if it's gone afterwards. */
export async function uninstall(id: number): Promise<boolean> {
  if (!inApp) {
    await wait(1500);
    demoSoftware.programs = demoSoftware.programs.filter((p) => p.id !== id);
    return true;
  }
  return invoke<boolean>("program_uninstall", { id });
}
