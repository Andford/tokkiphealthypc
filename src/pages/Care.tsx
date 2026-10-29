// Mantenimiento: registry entries for programs that are gone (backed up
// first), Windows' own repairs, restore points, what Healthy PC has done,
// and the weekly clean.

import { useEffect, useState } from "preact/hooks";
import {
  activityList, registryBackups, registryFix, registryRestore, registryScan, repairRun, restoreOpen, restorePointCreate, restorePoints, routineGet, routineSet,
  type Backup, type Done, type Orphan, type RestorePoint, type Routine,
} from "../core/api";
import { bytes, count } from "../core/format";
import { N_, t, tn } from "../i18n/i18n";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/icons";
import { Sound } from "../core/sound";
import { AdminBanner, needsAdmin } from "../ui/AdminBanner";
import { age } from "./storage/common";

type Tab = "registry" | "repair" | "restore" | "activity" | "routine";
let lastTab: Tab = "registry";

/** Opens this section on a given tab next time (the dashboard\'s links). */
export function openTab(tab: Tab) {
  lastTab = tab;
}

export function Care() {
  const [tab, setTab] = useState<Tab>(lastTab);
  const go = (x: Tab) => {
    lastTab = x;
    if (x !== tab) Sound.play("blip");
    setTab(x);
  };
  const tabs: [Tab, IconName, string][] = [
    ["registry", "build", N_("Registry")],
    ["repair", "settings", N_("Repair")],
    ["restore", "history", N_("Restore points")],
    ["activity", "document", N_("Activity")],
    ["routine", "schedule", N_("Weekly clean")],
  ];
  return (
    <>
      <h1 class="display page-title">{t("Maintenance")}</h1>
      <nav class="tabs" role="tablist" aria-label={t("Maintenance")}>
        {tabs.map(([id, icon, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => go(id)}>
            <Icon name={icon} size={20} />
            {t(label)}
          </button>
        ))}
      </nav>
      {tab === "registry" && <Registry />}
      {tab === "repair" && <Repair />}
      {tab === "restore" && <Restore />}
      {tab === "activity" && <Activity />}
      {tab === "routine" && <WeeklyClean />}
    </>
  );
}

// ── Registry ─────────────────────────────────────────────────────────────

const KINDS: Record<Orphan["kind"], string> = {
  appPath: N_("Shortcut to a program that's gone"),
  uninstall: N_("Uninstall entry for a program that's gone"),
  startup: N_("Starts a program that's gone"),
};

function Registry() {
  const [list, setList] = useState<Orphan[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [admin, setAdmin] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const loadBackups = () => void registryBackups().then(setBackups);
  useEffect(loadBackups, []);

  const scan = async () => {
    setBusy(true);
    const l = await registryScan();
    setList(l);
    setChosen(new Set(l.map((o) => o.id)));
    setBusy(false);
  };
  const fix = async () => {
    setBusy(true);
    try {
      const ids = await registryFix([...chosen]);
      setList((list ?? []).filter((o) => !ids.includes(o.id)));
      setChosen(new Set());
      setDone(ids.length);
      Sound.play("finish");
      loadBackups();
    } catch (e) {
      if (needsAdmin(e)) setAdmin(true);
      Sound.play("error");
    }
    setBusy(false);
  };

  return (
    <>
      <section class="card tool-head">
        <div>
          <h2 class="section-title">{t("Registry entries for programs that are gone")}</h2>
          <p class="hint">{t("Only three safe kinds: shortcuts, uninstall entries and startup entries whose program is no longer on the PC. Each one is saved to a backup before it's removed, and can be put back.")}</p>
        </div>
        <button class="btn filled" disabled={busy} onClick={scan}>
          <Icon name={list ? "refresh" : "play"} size={20} />
          {list ? t("Look again") : t("Review")}
        </button>
      </section>
      {admin && <AdminBanner text={t("Some entries are for everyone on this PC, so removing them needs administrator rights.")} />}
      {done != null && (
        <div class="outcome" role="status">
          <Icon name="check" />
          <p>{tn("{n} entry removed and backed up.", "{n} entries removed and backed up.", done)}</p>
        </div>
      )}
      {list && list.length === 0 && (
        <section class="card empty-state">
          <Icon name="check" size={40} />
          <h2>{t("Nothing to fix")}</h2>
        </section>
      )}
      {list && list.length > 0 && (
        <section class="card list-card">
          <ul class="files">
            {list.map((o) => (
              <li key={o.id} class="file">
                <input
                  type="checkbox"
                  class="check"
                  checked={chosen.has(o.id)}
                  aria-label={o.name}
                  onChange={() => {
                    const n = new Set(chosen);
                    n.has(o.id) ? n.delete(o.id) : n.add(o.id);
                    setChosen(n);
                  }}
                />
                <span class="file-text">
                  <span class="file-name">
                    {o.name} {o.key.startsWith("HKLM") && <span class="chip">{t("Administrator")}</span>}
                  </span>
                  <span class="file-where">
                    {t(KINDS[o.kind])} · {o.target}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div class="actions pad">
            <button class="btn filled" disabled={chosen.size === 0 || busy} onClick={fix}>
              <Icon name="build" size={20} />
              {t("Back up and remove")}
            </button>
          </div>
        </section>
      )}
      {backups.length > 0 && (
        <section class="card list-card">
          <header class="list-head">
            <h2 class="section-title">{t("Backups")}</h2>
          </header>
          <ul class="files">
            {backups.map((b) => (
              <li key={b.file} class="file">
                <span class="file-text">
                  <span class="file-name">{age(b.at)}</span>
                  <span class="file-where">{b.file}</span>
                </span>
                <button
                  class="btn tonal small"
                  onClick={async () => {
                    if (await registryRestore(b.file)) {
                      Sound.play("pop");
                      loadBackups();
                    }
                  }}
                >
                  {t("Put back")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// ── Repair ───────────────────────────────────────────────────────────────

const REPAIRS: { id: "sfc" | "dism" | "chkdsk" | "optimize"; title: string; about: string }[] = [
  { id: "sfc", title: N_("Check Windows' files"), about: N_("SFC finds Windows' damaged files and puts good copies back. Takes about 10 minutes.") },
  { id: "dism", title: N_("Repair Windows' image"), about: N_("DISM fixes the copy SFC repairs from. Use it when SFC can't fix something. Takes a while and uses the internet.") },
  { id: "chkdsk", title: N_("Check the disk"), about: N_("CHKDSK looks for file system errors on the system drive without stopping Windows.") },
  { id: "optimize", title: N_("Optimize the disk"), about: N_("TRIM on SSDs, defragmenting on hard drives: what Windows does on its own schedule, now.") },
];

function Repair() {
  const [state, setState] = useState<Record<string, string>>({});
  const run = async (id: (typeof REPAIRS)[number]["id"]) => {
    setState((s) => ({ ...s, [id]: "working" }));
    try {
      const ok = await repairRun(id);
      setState((s) => ({ ...s, [id]: ok ? "done" : "failed" }));
      Sound.play(ok ? "finish" : "error");
    } catch (e) {
      setState((s) => ({ ...s, [id]: needsAdmin(e) ? "admin" : "failed" }));
      Sound.play("error");
    }
  };
  const label = (st?: string) =>
    st === "done" ? t("Done") : st === "working" ? t("Working… you can keep using the PC") : st === "admin" ? t("Needs administrator") : st === "failed" ? t("It found something it couldn't fix, or didn't finish") : "";
  return (
    <>
      {Object.values(state).includes("admin") && <AdminBanner text={t("Windows' repairs need administrator rights.")} />}
      <section class="grid">
        {REPAIRS.map((r) => (
          <article key={r.id} class="card stat">
            <span class="stat-icon">
              <Icon name="build" />
            </span>
            <h2 class="section-title">{t(r.title)}</h2>
            <p class="stat-note">{t(r.about)}</p>
            <div class="actions">
              <button class="btn tonal" disabled={Object.values(state).includes("working")} onClick={() => void run(r.id)}>
                {t("Run")}
              </button>
            </div>
            <p class="hint">{label(state[r.id])}</p>
          </article>
        ))}
      </section>
    </>
  );
}

// ── Restore points ───────────────────────────────────────────────────────

function Restore() {
  const [list, setList] = useState<RestorePoint[] | null>(null);
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const load = () => void restorePoints().then(setList);
  useEffect(load, []);
  const create = async () => {
    setBusy(true);
    try {
      const ok = await restorePointCreate();
      setNote(ok ? t("Restore point made.") : t("Windows didn't make it: it allows one a day, and System Protection must be on."));
      Sound.play(ok ? "finish" : "error");
      load();
    } catch (e) {
      if (needsAdmin(e)) setAdmin(true);
      Sound.play("error");
    }
    setBusy(false);
  };
  return (
    <>
      <section class="card tool-head">
        <div>
          <h2 class="section-title">{t("Restore points")}</h2>
          <p class="hint">{t("A snapshot of Windows' settings and programs to go back to if something goes wrong. Your files aren't touched.")}</p>
        </div>
        <div class="actions tight">
          <button class="btn filled" disabled={busy} onClick={create}>
            {busy ? t("Making it…") : t("Make one now")}
          </button>
          <button class="btn tonal" onClick={() => void restoreOpen()}>
            {t("Go back to one…")}
          </button>
        </div>
      </section>
      {admin && <AdminBanner />}
      {note && (
        <div class="outcome" role="status">
          <Icon name="info" />
          <p>{note}</p>
        </div>
      )}
      <section class="card list-card">
        {list && list.length === 0 && <p class="hint pad">{t("There are no restore points (or System Protection is off).")}</p>}
        <ul class="files">
          {(list ?? []).map((r) => (
            <li key={r.number} class="file">
              <span class="file-icon">
                <Icon name="history" size={20} />
              </span>
              <span class="file-text">
                <span class="file-name">{r.description}</span>
                <span class="file-where">{r.at ? new Date(r.at).toLocaleString() : ""}</span>
              </span>
              <span class="file-age">{r.at ? age(r.at) : ""}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

// ── Activity ─────────────────────────────────────────────────────────────

const DONE_TEXT: Record<string, [IconName, string]> = {
  clean: ["clean", N_("Cleaned {count} files ({size})")],
  routine: ["schedule", N_("Weekly clean: {count} files ({size})")],
  trash: ["trash", N_("Sent {count} to the Recycle Bin ({size})")],
  shred: ["shred", N_("Shredded {count} files ({size})")],
  empty: ["folderOff", N_("Removed {count} empty folders")],
  uninstall: ["apps", N_("Uninstalled {detail}")],
  apps: ["installer", N_("Removed the app {detail}")],
  service: ["settings", N_("Changed the service {detail}")],
  game: ["play", N_("Turned on game mode")],
  registry: ["build", N_("Removed {count} registry entries (backed up)")],
  privacy: ["lock", N_("Changed a privacy setting")],
  traces: ["history", N_("Cleared {count} traces")],
  firewall: ["web", N_("Adjusted the firewall")],
  scan: ["shield", N_("Ran a quick scan with Defender")],
  repair: ["build", N_("Ran a Windows repair ({detail})")],
  restorePoint: ["history", N_("Made a restore point")],
  routineSet: ["schedule", N_("Changed the weekly clean")],
};

const FREES = ["clean", "trash", "shred"];
const DAY = 86_400_000;

function Activity() {
  const [list, setList] = useState<Done[] | null>(null);
  const [view, setView] = useState<"summary" | "timeline">("summary");
  useEffect(() => void activityList().then(setList), []);
  if (!list) return null;
  if (!list.length)
    return (
      <section class="card empty-state">
        <Icon name="history" size={40} />
        <h2>{t("Nothing yet")}</h2>
        <p>{t("What you do with Healthy PC will show up here.")}</p>
      </section>
    );

  const freed = list.filter((d) => FREES.includes(d.kind)).reduce((s, d) => s + d.bytes, 0);
  const items = list.filter((d) => FREES.includes(d.kind) || d.kind === "empty" || d.kind === "traces").reduce((s, d) => s + d.count, 0);
  const cleans = list.filter((d) => d.kind === "clean").length;

  // Freed per day, last 30 days.
  const today = Math.floor(Date.now() / DAY);
  const days = Array.from({ length: 30 }, (_, i) => today - 29 + i);
  const perDay = days.map((day) => list.filter((d) => FREES.includes(d.kind) && Math.floor(d.at / DAY) === day).reduce((s, d) => s + d.bytes, 0));
  const maxDay = Math.max(...perDay, 1);

  // By kind.
  const byKind = new Map<string, number>();
  for (const d of list) {
    const k = d.kind === "clean" && d.detail === "routine" ? "routine" : d.kind;
    byKind.set(k, (byKind.get(k) ?? 0) + 1);
  }
  const kinds = [...byKind.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const total = kinds.reduce((s, k) => s + k[1], 0);

  // Weekday rhythm: Monday first.
  const week = [0, 0, 0, 0, 0, 0, 0];
  for (const d of list) week[(new Date(d.at).getDay() + 6) % 7]++;
  const maxWeek = Math.max(...week, 1);

  return (
    <>
      <div class="filters" role="radiogroup" aria-label={t("Show")}>
        <button role="radio" aria-checked={view === "summary"} onClick={() => setView("summary")}>
          {t("Summary")}
        </button>
        <button role="radio" aria-checked={view === "timeline"} onClick={() => setView("timeline")}>
          {t("Timeline")}
        </button>
      </div>
      {view === "summary" ? (
        <>
          <section class="meters">
            <article class="card meter">
              <p class="stat-label">{t("Things done")}</p>
              <p class="stat-value">{count(list.length)}</p>
            </article>
            <article class="card meter">
              <p class="stat-label">{t("Space recovered")}</p>
              <p class="stat-value">{bytes(freed)}</p>
            </article>
            <article class="card meter">
              <p class="stat-label">{t("Items handled")}</p>
              <p class="stat-value">{count(items)}</p>
            </article>
            <article class="card meter">
              <p class="stat-label">{t("Cleans")}</p>
              <p class="stat-value">{count(cleans)}</p>
            </article>
          </section>
          <section class="charts">
            <article class="card">
              <h2 class="section-title">{t("Space recovered, last 30 days")}</h2>
              <div class="bars" role="img" aria-label={t("Space recovered, last 30 days")}>
                {perDay.map((v, i) => (
                  <span key={i} class="bar-col" title={`${new Date(days[i] * DAY).toLocaleDateString()} · ${bytes(v)}`}>
                    <span style={{ height: `${Math.max(v ? 4 : 0, (v / maxDay) * 100)}%` }} />
                  </span>
                ))}
              </div>
              <p class="hint">{t("Most in one day: {size}", { size: bytes(maxDay === 1 ? 0 : maxDay) })}</p>
            </article>
            <article class="card">
              <h2 class="section-title">{t("What you've done most")}</h2>
              <Donut parts={kinds.map(([, n]) => n)} />
              <ul class="legend">
                {kinds.map(([k, n], i) => (
                  <li key={k}>
                    <span class={`dot kind-${i % 8}`} />
                    <span>{t(DONE_SHORT[k] ?? k)}</span>
                    <span class="hint">{Math.round((n / total) * 100)}%</span>
                  </li>
                ))}
              </ul>
            </article>
            <article class="card">
              <h2 class="section-title">{t("Your rhythm by day")}</h2>
              <div class="bars week" role="img" aria-label={t("Your rhythm by day")}>
                {week.map((v, i) => (
                  <span key={i} class="bar-col" title={`${t(WEEK[i])} · ${v}`}>
                    <span style={{ height: `${(v / maxWeek) * 100}%` }} />
                    <em>{t(WEEK[i]).slice(0, 2)}</em>
                  </span>
                ))}
              </div>
            </article>
          </section>
        </>
      ) : (
        <section class="card list-card">
          <ul class="files">
            {list.map((d, i) => {
              const key = d.kind === "clean" && d.detail === "routine" ? "routine" : d.kind === "routine" ? "routineSet" : d.kind;
              const [icon, text] = DONE_TEXT[key] ?? ["info", d.kind];
              return (
                <li key={i} class="file">
                  <span class="file-icon">
                    <Icon name={icon} size={20} />
                  </span>
                  <span class="file-text">
                    <span class="file-name">{t(text, { count: count(d.count), size: bytes(d.bytes), detail: d.detail })}</span>
                    <span class="file-where">{new Date(d.at).toLocaleString()}</span>
                  </span>
                  <span class="file-age">{age(d.at)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

const DONE_SHORT: Record<string, string> = {
  clean: N_("Cleans"), routine: N_("Weekly cleans"), trash: N_("To the Recycle Bin"), shred: N_("Shredded"), empty: N_("Empty folders"),
  uninstall: N_("Uninstalls"), apps: N_("Preinstalled apps"), service: N_("Services"), registry: N_("Registry"), privacy: N_("Privacy"),
  traces: N_("Traces"), firewall: N_("Firewall"), scan: N_("Defender scans"), repair: N_("Windows repairs"), restorePoint: N_("Restore points"),
  routineSet: N_("Weekly clean"), game: N_("Game mode"),
};

/** A ring split in parts, in the kind colours. */
function Donut({ parts }: { parts: number[] }) {
  const total = parts.reduce((s, p) => s + p, 0) || 1;
  const r = 40;
  const c = 2 * Math.PI * r;
  let at = 0;
  return (
    <svg class="donut" viewBox="0 0 100 100" width="140" height="140" aria-hidden="true">
      {parts.map((p, i) => {
        const len = (p / total) * c;
        const el = <circle key={i} cx="50" cy="50" r={r} class={`donut-part kind-stroke-${i % 8}`} stroke-dasharray={`${Math.max(0, len - 2)} ${c}`} stroke-dashoffset={-at} />;
        at += len;
        return el;
      })}
    </svg>
  );
}

// ── Weekly clean ─────────────────────────────────────────────────────────

const WEEK = [N_("Monday"), N_("Tuesday"), N_("Wednesday"), N_("Thursday"), N_("Friday"), N_("Saturday"), N_("Sunday")];

function WeeklyClean() {
  const [r, setR] = useState<Routine | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => void routineGet().then(setR), []);
  if (!r) return null;
  const save = async (next: Routine) => {
    try {
      await routineSet(next);
      setR(next);
      setFailed(false);
      Sound.play(next.on ? "pop" : "close");
    } catch {
      setFailed(true);
      Sound.play("error");
    }
  };
  return (
    <section class="card setting">
      <h2>
        <Icon name="schedule" /> {t("Weekly clean")}
      </h2>
      <p class="hint">{t("Once a week, Windows opens Healthy PC without a window and cleans what's safe and needs no permission: temporary files, caches and leftovers. Not the Recycle Bin, and nothing a program has open. Tokkip tells you on the island how much he freed.")}</p>
      <label class="switch-row">
        <span>{r.on ? t("On") : t("Off")}</span>
        <input type="checkbox" class="switch" checked={r.on} onChange={() => void save({ ...r, on: !r.on })} />
      </label>
      <div class="routine-when">
        <label>
          {t("Day")}
          <select value={r.day} onChange={(e) => void save({ ...r, day: +(e.target as HTMLSelectElement).value })}>
            {WEEK.map((d, i) => (
              <option key={d} value={i}>
                {t(d)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Time")}
          <select value={r.hour} onChange={(e) => void save({ ...r, hour: +(e.target as HTMLSelectElement).value })}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {`${h}:00`}
              </option>
            ))}
          </select>
        </label>
      </div>
      {failed && <p class="hint">{t("Windows' Task Scheduler didn't accept it. Try opening Healthy PC as administrator.")}</p>}
    </section>
  );
}
