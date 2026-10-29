// Software: what starts with Windows (switch it off and on, the way Task
// Manager does), and your programs, removed with their own uninstallers.

import { useEffect, useMemo, useState } from "preact/hooks";
import { programsList, relaunchAdmin, startupList, startupSet, uninstall, type Program, type StartupItem } from "../core/api";
import { bytes } from "../core/format";
import { t, tn } from "../i18n/i18n";
import { Icon } from "../ui/Icon";
import { Sound } from "../core/sound";

type Tab = "startup" | "programs";
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
      </nav>
      {tab === "startup" ? <Startup /> : <Programs />}
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
      const gone = await uninstall(p.id);
      if (gone) {
        setList(list.filter((x) => x.id !== p.id));
        setNote(t("{name} was uninstalled.", { name: p.name }));
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
