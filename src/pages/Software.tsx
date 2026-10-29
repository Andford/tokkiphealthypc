// Software: what starts with Windows (switch it off and on, the way Task
// Manager does), and your programs, removed with their own uninstallers.

import { useEffect, useMemo, useState } from "preact/hooks";
import {
  preinstalledList, programsList, relaunchAdmin, removeLeftovers, removePreinstalled, startupList, startupSet, uninstall, updateRun, updatesList,
  type Leftover, type Preinstalled, type Program, type Removed, type StartupItem, type Update,
} from "../core/api";
import { bytes } from "../core/format";
import { language, N_, t, tn } from "../i18n/i18n";
import { Check, Dock, Outcome, useChoice } from "./storage/common";
import { Icon } from "../ui/Icon";
import { Sound } from "../core/sound";

type Tab = "startup" | "programs" | "preinstalled" | "updates";
let lastTab: Tab = "startup";

export function Software() {
  const [tab, setTab] = useState<Tab>(lastTab);
  const go = (x: Tab) => {
    lastTab = x;
    if (x !== tab) Sound.play("blip");
    setTab(x);
  };
  return (
    <>
      <h1 class="display page-title">{t("Software")}</h1>
      <nav class="tabs" role="tablist" aria-label={t("Software")}>
        <button role="tab" aria-selected={tab === "startup"} onClick={() => go("startup")}>
          <Icon name="play" size={20} />
          {t("Startup")}
        </button>
        <button role="tab" aria-selected={tab === "programs"} onClick={() => go("programs")}>
          <Icon name="apps" size={20} />
          {t("Programs")}
        </button>
        <button role="tab" aria-selected={tab === "preinstalled"} onClick={() => go("preinstalled")}>
          <Icon name="installer" size={20} />
          {t("Preinstalled apps")}
        </button>
        <button role="tab" aria-selected={tab === "updates"} onClick={() => go("updates")}>
          <Icon name="refresh" size={20} />
          {t("Updates")}
        </button>
      </nav>
      {tab === "startup" && <Startup />}
      {tab === "programs" && <Programs />}
      {tab === "preinstalled" && <PreinstalledApps />}
      {tab === "updates" && <Updates />}
    </>
  );
}

function Startup() {
  const [list, setList] = useState<StartupItem[] | null>(null);
  const [needAdmin, setNeedAdmin] = useState(false);
  useEffect(() => {
    void startupList().then(setList);
  }, []);
  if (!list) return <section class="card"><p class="hint">{t("Looking…")}</p></section>;

  const flip = async (it: StartupItem) => {
    try {
      await startupSet(it.id, !it.enabled);
      setList(list.map((x) => (x.id === it.id ? { ...x, enabled: !x.enabled } : x)));
      Sound.play(it.enabled ? "close" : "pop");
    } catch (e) {
      if (e === "admin" || String(e).includes("admin")) setNeedAdmin(true);
      Sound.play("error");
    }
  };
  const on = list.filter((x) => x.enabled).length;

  return (
    <>
      <section class="card tool-head">
        <div>
          <h2 class="section-title">{tn("{n} program starts with Windows", "{n} programs start with Windows", on)}</h2>
          <p class="hint">{t("Each one makes Windows take longer to be ready. Switching one off doesn't uninstall it: it just waits until you open it. You can switch it back on any time.")}</p>
        </div>
      </section>
      {needAdmin && (
        <div class="banner">
          <Icon name="admin" />
          <p>{t("That one starts for everyone on this PC, so changing it needs administrator rights.")}</p>
          <button class="btn tonal" onClick={() => void relaunchAdmin()}>
            {t("Open as administrator")}
          </button>
        </div>
      )}
      <section class="card list-card">
        {list.length === 0 && <p class="hint">{t("Nothing starts with Windows.")}</p>}
        <ul class="files">
          {list.map((it) => (
            <li key={it.id} class="file">
              <span class="file-icon">
                <Icon name="app" size={20} />
              </span>
              <span class="file-text">
                <span class="file-name">
                  {it.name} {it.admin && <span class="chip">{t("Everyone")}</span>}
                </span>
                <span class="file-where" title={it.command}>{it.command}</span>
              </span>
              <input type="checkbox" class="switch" checked={it.enabled} aria-label={it.name} onChange={() => void flip(it)} />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function date(yyyymmdd: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(yyyymmdd);
  if (!m) return "";
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function Programs() {
  const [list, setList] = useState<Program[] | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"name" | "size" | "date">("name");
  const [asking, setAsking] = useState<Program | null>(null);
  const [working, setWorking] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [left, setLeft] = useState<{ name: string; items: Leftover[] } | null>(null);
  const leftChoice = useChoice();
  const [leftResult, setLeftResult] = useState<Removed | null>(null);
  useEffect(() => {
    void programsList().then(setList);
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const l = (list ?? []).filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.publisher.toLowerCase().includes(needle));
    if (sort === "size") l.sort((a, b) => b.bytes - a.bytes);
    if (sort === "date") l.sort((a, b) => b.installed.localeCompare(a.installed));
    return l;
  }, [list, q, sort]);

  if (!list) return <section class="card"><p class="hint">{t("Looking…")}</p></section>;

  const remove = async (p: Program) => {
    setAsking(null);
    setWorking(p.id);
    setNote("");
    try {
      const r = await uninstall(p.id);
      if (r.gone) {
        setList(list.filter((x) => x.id !== p.id));
        setNote(t("{name} was uninstalled.", { name: p.name }));
        setLeftResult(null);
        setLeft(r.leftovers.length ? { name: p.name, items: r.leftovers } : null);
        leftChoice.set([]);
        Sound.play("finish");
      } else {
        setNote(t("{name} is still installed: its uninstaller was closed or didn't finish.", { name: p.name }));
      }
    } catch {
      setNote(t("{name}'s uninstaller couldn't be opened.", { name: p.name }));
      Sound.play("error");
    }
    setWorking(null);
  };

  return (
    <>
      <section class="card tool-head">
        <div>
          <h2 class="section-title">{tn("{n} program installed", "{n} programs installed", list.length)}</h2>
          <p class="hint">{t("Each one is removed with its own uninstaller, the same as from Windows' Settings.")}</p>
          <div class="search-row">
            <input class="search" type="search" placeholder={t("Search by name or publisher")} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
            <div class="filters" role="radiogroup" aria-label={t("Sort")}>
              {(["name", "size", "date"] as const).map((s) => (
                <button key={s} role="radio" aria-checked={sort === s} onClick={() => setSort(s)}>
                  {s === "name" ? t("Name") : s === "size" ? t("Size") : t("Newest")}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
      {note && (
        <div class="outcome" role="status">
          <Icon name="info" />
          <p>{note}</p>
        </div>
      )}
      {leftResult && <Outcome freed={leftResult.freed} files={leftResult.files} kept={leftResult.kept.length} verb="trash" />}
      {left && (
        <section class="card list-card">
          <header class="list-head">
            <h2 class="section-title">{tn("{name} left {n} folder behind", "{name} left {n} folders behind", left.items.length, { name: left.name })}</h2>
            <p class="hint">{t("Settings and data its uninstaller didn't remove. Look before you choose: some programs keep your files here.")}</p>
          </header>
          <ul class="files">
            {left.items.map((l) => (
              <li key={l.id} class="file">
                <Check on={leftChoice.has(l.id)} onChange={() => leftChoice.toggle(l.id)} label={l.path} />
                <span class="file-icon">
                  <Icon name="folder" size={20} />
                </span>
                <span class="file-text">
                  <span class="file-where strong">{l.path}</span>
                </span>
                <span class="file-size">{bytes(l.bytes)}</span>
              </li>
            ))}
          </ul>
          <div class="actions">
            <button
              class="btn filled"
              disabled={leftChoice.chosen.size === 0}
              onClick={async () => {
                const r = await removeLeftovers([...leftChoice.chosen]);
                setLeftResult(r);
                setLeft(null);
                Sound.play(r.files > 0 ? "finish" : "error");
              }}
            >
              <Icon name="trash" size={20} />
              {t("Send to the Recycle Bin")}
            </button>
            <button class="btn text" onClick={() => setLeft(null)}>
              {t("Leave them")}
            </button>
          </div>
        </section>
      )}
      <section class="card list-card">
        <ul class="files">
          {shown.map((p) => (
            <li key={p.id} class="file">
              <span class="file-icon">
                <Icon name="app" size={20} />
              </span>
              <span class="file-text">
                <span class="file-name">{p.name}</span>
                <span class="file-where">{[p.publisher, p.version, date(p.installed)].filter(Boolean).join(" · ")}</span>
              </span>
              <span class="file-size">{p.bytes > 0 ? bytes(p.bytes) : ""}</span>
              {asking?.id === p.id ? (
                <span class="confirm">
                  <button class="btn text small" onClick={() => setAsking(null)}>
                    {t("Cancel")}
                  </button>
                  <button class="btn danger small" onClick={() => void remove(p)}>
                    {t("Uninstall")}
                  </button>
                </span>
              ) : (
                <button class="btn tonal small" disabled={working !== null} onClick={() => setAsking(p)}>
                  {working === p.id ? t("Uninstalling…") : t("Uninstall")}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

const GROUPS: Record<Preinstalled["group"], string> = {
  microsoft: N_("Came with Windows"),
  oem: N_("Came with your PC (its maker's)"),
  communication: N_("Chat and social, preinstalled"),
  gaming: N_("Games, preinstalled"),
  media: N_("Music and video, preinstalled"),
  utility: N_("Tools, preinstalled"),
};

function PreinstalledApps() {
  const [list, setList] = useState<Preinstalled[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ removed: number; failed: number } | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  useEffect(() => {
    void preinstalledList().then(setList);
  }, []);
  if (!list) return <section class="card"><p class="hint">{t("Looking…")}</p></section>;

  const toggle = (p: string) => {
    const n = new Set(chosen);
    n.has(p) ? n.delete(p) : n.add(p);
    setChosen(n);
    Sound.play("tick");
  };
  const size = list.filter((a) => chosen.has(a.package)).reduce((s, a) => s + a.bytes, 0);
  const remove = async () => {
    setBusy(true);
    const asked = [...chosen];
    const removed = await removePreinstalled(asked);
    setList(list.filter((a) => !removed.includes(a.package)));
    setChosen(new Set());
    setDone({ removed: removed.length, failed: asked.length - removed.length });
    setBusy(false);
    Sound.play(removed.length ? "finish" : "error");
  };

  return (
    <>
      <section class="card tool-head">
        <div>
          <h2 class="section-title">{tn("{n} preinstalled app found", "{n} preinstalled apps found", list.length)}</h2>
          <p class="hint">{t("Apps that came with Windows or your PC and most people never use. They're removed only for you, and you can install them again from the Microsoft Store.")}</p>
        </div>
      </section>
      {done && (
        <div class="outcome" role="status">
          <Icon name={done.removed ? "check" : "info"} />
          <p>
            {tn("{n} app removed.", "{n} apps removed.", done.removed)} {done.failed > 0 && tn("{n} couldn't be removed (Windows keeps it).", "{n} couldn't be removed (Windows keeps them).", done.failed)}
          </p>
        </div>
      )}
      {list.length === 0 && (
        <section class="card empty-state">
          <Icon name="check" size={40} />
          <h2>{t("None of the usual ones")}</h2>
        </section>
      )}
      {list.length > 0 && (
        <section class="card list-card">
          <ul class="files">
            {list.map((a) => (
              <li key={a.package} class="file">
                <Check on={chosen.has(a.package)} onChange={() => toggle(a.package)} label={a.name} />
                <span class="file-icon">
                  <Icon name="installer" size={20} />
                </span>
                <span class="file-text">
                  <span class="file-name">{a.name}</span>
                  <span class="file-where">{language() === "en" ? a.aboutEn : t(GROUPS[a.group])} · {a.publisher}</span>
                </span>
                <span class="file-size">{a.bytes > 0 ? bytes(a.bytes) : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {list.length > 0 && (
        <Dock
          text={chosen.size ? tn("{n} app chosen · {size}", "{n} apps chosen · {size}", chosen.size, { size: bytes(size) }) : t("Choose the apps you don't use")}
          action={busy ? t("Removing…") : t("Remove")}
          icon="trash"
          disabled={chosen.size === 0 || busy}
          onClick={remove}
        />
      )}
    </>
  );
}

function Updates() {
  const [list, setList] = useState<Update[] | null | undefined>(undefined);
  const [state, setState] = useState<Record<string, "working" | "done" | "failed">>({});
  const load = () => {
    setList(undefined);
    void updatesList().then(setList);
  };
  useEffect(load, []);
  if (list === undefined) return <section class="card"><p class="hint">{t("Asking winget what has updates… this takes a moment.")}</p></section>;
  if (list === null)
    return (
      <section class="card empty-state">
        <Icon name="info" size={40} />
        <h2>{t("This PC doesn't have winget")}</h2>
        <p>{t("winget comes with Windows 10 and 11 as 'App Installer'. Install it from the Microsoft Store and come back.")}</p>
      </section>
    );

  const run = async (ids: string[]) => {
    for (const id of ids) {
      setState((s) => ({ ...s, [id]: "working" }));
      const ok = await updateRun(id);
      setState((s) => ({ ...s, [id]: ok ? "done" : "failed" }));
      Sound.play(ok ? "pop" : "error");
    }
  };
  const pending = list.filter((u) => !state[u.id] || state[u.id] === "failed");
  const working = Object.values(state).includes("working");

  return (
    <>
      <section class="card tool-head">
        <div>
          <h2 class="section-title">{list.length ? tn("{n} program has an update", "{n} programs have an update", list.length) : t("Everything's up to date")}</h2>
          <p class="hint">{t("Through winget, Windows' own installer: each program comes from its official source. Some may ask for permission while they update.")}</p>
        </div>
        <div class="actions tight">
          <button class="btn tonal" onClick={load} disabled={working}>
            <Icon name="refresh" size={20} />
            {t("Look again")}
          </button>
          {pending.length > 0 && (
            <button class="btn filled" onClick={() => void run(pending.map((u) => u.id))} disabled={working}>
              <Icon name="download" size={20} />
              {t("Update all")}
            </button>
          )}
        </div>
      </section>
      {list.length > 0 && (
        <section class="card list-card">
          <ul class="files">
            {list.map((u) => (
              <li key={u.id} class="file">
                <span class="file-icon">
                  <Icon name="app" size={20} />
                </span>
                <span class="file-text">
                  <span class="file-name">{u.name}</span>
                  <span class="file-where">
                    {u.version} → {u.available}
                  </span>
                </span>
                {state[u.id] === "done" ? (
                  <span class="chip ok">{t("Updated")}</span>
                ) : state[u.id] === "working" ? (
                  <span class="chip">{t("Updating…")}</span>
                ) : (
                  <>
                    {state[u.id] === "failed" && <span class="chip warn">{t("Didn't work")}</span>}
                    <button class="btn tonal small" disabled={working} onClick={() => void run([u.id])}>
                      {t("Update")}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
