// Protección: Windows Defender, privacy switches, traces, the firewall and
// safer settings. Every switch can be put back as it was.

import { useEffect, useState } from "preact/hooks";
import {
  defenderRun, defenderStatus, firewallFix, firewallReview, privacyList, privacySet, tracesClear, tracesList,
  type Defender, type Firewall, type SwitchState, type Trace,
} from "../core/api";
import { bytes, count } from "../core/format";
import { language, N_, t, tn } from "../i18n/i18n";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/icons";
import { Sound } from "../core/sound";
import { Tokkip } from "../ui/Tokkip";
import { AdminBanner, needsAdmin } from "../ui/AdminBanner";
import { age } from "./storage/common";

type Tab = "antivirus" | "privacy" | "traces" | "firewall";
let lastTab: Tab = "antivirus";

export function Protection() {
  const [tab, setTab] = useState<Tab>(lastTab);
  const go = (x: Tab) => {
    lastTab = x;
    if (x !== tab) Sound.play("blip");
    setTab(x);
  };
  const tabs: [Tab, IconName, string][] = [
    ["antivirus", "shield", N_("Antivirus")],
    ["privacy", "lock", N_("Privacy")],
    ["traces", "history", N_("Traces")],
    ["firewall", "web", N_("Firewall and safety")],
  ];
  return (
    <>
      <h1 class="display page-title">{t("Protection")}</h1>
      <nav class="tabs" role="tablist" aria-label={t("Protection")}>
        {tabs.map(([id, icon, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => go(id)}>
            <Icon name={icon} size={20} />
            {t(label)}
          </button>
        ))}
      </nav>
      {tab === "antivirus" && <Antivirus />}
      {tab === "privacy" && <Switches groups={["telemetry", "ads", "search", "sync", "ai", "browsers"]} />}
      {tab === "traces" && <Traces />}
      {tab === "firewall" && <FirewallTab />}
    </>
  );
}

// ── Antivirus ────────────────────────────────────────────────────────────

function Antivirus() {
  const [d, setD] = useState<Defender | null>(null);
  const [busy, setBusy] = useState<"" | "scan" | "update">("");
  const [admin, setAdmin] = useState(false);
  const load = () => void defenderStatus().then(setD);
  useEffect(load, []);
  if (!d) return <section class="card"><p class="hint">{t("Asking Windows Defender…")}</p></section>;
  if (!d.available)
    return (
      <section class="card empty-state">
        <Icon name="shield" size={40} />
        <h2>{t("Windows Defender isn't in charge")}</h2>
        <p>{t("Another antivirus is protecting this PC, or Defender is turned off. Check it from that antivirus or from Windows Security.")}</p>
      </section>
    );

  const run = async (what: "scan" | "update") => {
    setBusy(what);
    try {
      await defenderRun(what);
      Sound.play("finish");
    } catch (e) {
      if (needsAdmin(e)) setAdmin(true);
      Sound.play("error");
    }
    setBusy("");
    load();
  };
  const active = d.threats.filter((x) => x.active);
  const fine = d.realtime && active.length === 0;
  const oldDefs = Date.now() - d.signatures > 3 * 86_400_000;

  return (
    <>
      <section class={`hero card compact ${fine ? "" : "soon"}`}>
        <Tokkip size={110} state={busy === "scan" ? "searching" : fine ? "idle" : "approval"} label="Tokkip" />
        <div class="hero-text">
          <h1 class="display">{fine ? t("Your PC is protected") : active.length ? t("Defender found something") : t("Real-time protection is off")}</h1>
          <p class="lead">
            {t("Windows Defender")} · {d.quickScan ? t("last scan {when}", { when: age(d.quickScan) }) : t("no scan yet")} · {t("definitions from {when}", { when: d.signatures ? age(d.signatures) : "?" })}
          </p>
          <div class="actions">
            <button class="btn filled" disabled={busy !== ""} onClick={() => void run("scan")}>
              <Icon name="play" size={20} />
              {busy === "scan" ? t("Scanning… (a few minutes)") : t("Quick scan")}
            </button>
            <button class={`btn ${oldDefs ? "filled" : "tonal"}`} disabled={busy !== ""} onClick={() => void run("update")}>
              <Icon name="refresh" size={20} />
              {busy === "update" ? t("Updating…") : t("Update definitions")}
            </button>
          </div>
        </div>
      </section>
      {admin && <AdminBanner />}
      {!d.realtime && (
        <div class="banner">
          <Icon name="warning" />
          <p>{t("Real-time protection is off: Defender only checks when you scan. Turn it on in Windows Security.")}</p>
        </div>
      )}
      {d.threats.length > 0 && (
        <section class="card list-card">
          <header class="list-head">
            <h2 class="section-title">{t("What Defender has found")}</h2>
            <p class="hint">{t("Defender quarantines or removes these itself. Active ones still need attention in Windows Security.")}</p>
          </header>
          <ul class="files">
            {d.threats.map((x, i) => (
              <li key={i} class="file">
                <span class={`file-icon ${x.active ? "safety-caution" : "safety-safe"}`}>
                  <Icon name={x.active ? "warning" : "check"} size={20} />
                </span>
                <span class="file-text">
                  <span class="file-name">{x.name}</span>
                  <span class="file-where">{x.files[0] ?? ""}</span>
                </span>
                <span class={`chip ${x.active ? "warn" : "ok"}`}>{x.active ? t("Active") : t("Taken care of")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// ── Switches ─────────────────────────────────────────────────────────────

const GROUP_NAMES: Record<SwitchState["group"], string> = {
  telemetry: N_("What Windows sends to Microsoft"),
  ads: N_("Ads and suggestions"),
  search: N_("Search"),
  sync: N_("Sync and sharing"),
  ai: N_("AI features"),
  browsers: N_("Browsers (as policies)"),
  security: N_("Safer settings"),
};

function Switches({ groups }: { groups: SwitchState["group"][] }) {
  const [list, setList] = useState<SwitchState[] | null>(null);
  const [admin, setAdmin] = useState(false);
  const load = () => void privacyList().then(setList);
  useEffect(load, []);
  if (!list) return <section class="card"><p class="hint">{t("Looking…")}</p></section>;
  const flip = async (s: SwitchState) => {
    try {
      await privacySet(s.id, !s.on);
      Sound.play(s.on ? "close" : "pop");
      load();
    } catch (e) {
      if (needsAdmin(e)) setAdmin(true);
      Sound.play("error");
    }
  };
  const es = language() === "es";
  return (
    <>
      {groups.includes("telemetry") && (
        <section class="card tool-head">
          <div>
            <h2 class="section-title">{tn("{n} of {total} private", "{n} of {total} private", list.filter((s) => s.on && s.group !== "security").length, { total: list.filter((s) => s.group !== "security").length })}</h2>
            <p class="hint">{t("Each switch changes one Windows setting to its private side. Switching it back puts the exact value it had before.")}</p>
          </div>
        </section>
      )}
      {admin && <AdminBanner />}
      {groups.map((g) => {
        const items = list.filter((s) => s.group === g);
        if (!items.length) return null;
        return (
          <section class="card list-card" key={g}>
            <header class="list-head">
              <h2 class="section-title">{t(GROUP_NAMES[g])}</h2>
            </header>
            <ul class="files">
              {items.map((s) => (
                <li key={s.id} class="file">
                  <span class="file-text">
                    <span class="file-name">
                      {es ? s.name : s.nameEn} {s.admin && <span class="chip">{t("Administrator")}</span>}
                    </span>
                    {s.ours && <span class="file-where">{t("Changed by Healthy PC")}</span>}
                  </span>
                  <input type="checkbox" class="switch" checked={s.on} aria-label={es ? s.name : s.nameEn} onChange={() => void flip(s)} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

// ── Traces ───────────────────────────────────────────────────────────────

const TRACES: Record<Trace["id"], [string, string]> = {
  recent: [N_("Recent files"), N_("The list of files you opened lately (the files stay).")],
  jumplists: [N_("Jump lists"), N_("Recent items each program shows when you right-click it on the taskbar.")],
  run: [N_("Run history"), N_("What you typed in Win + R.")],
  typed: [N_("Explorer address history"), N_("Folders you typed in File Explorer's address bar.")],
};

function Traces() {
  const [list, setList] = useState<Trace[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set(["recent", "jumplists", "run", "typed"]));
  const [done, setDone] = useState<number | null>(null);
  const load = () => void tracesList().then(setList);
  useEffect(load, []);
  if (!list) return <section class="card"><p class="hint">{t("Looking…")}</p></section>;
  const toggle = (id: string) => {
    const n = new Set(chosen);
    n.has(id) ? n.delete(id) : n.add(id);
    setChosen(n);
  };
  const clear = async () => {
    const n = await tracesClear([...chosen].filter((id) => list.some((x) => x.id === id && x.items > 0)));
    setDone(n);
    Sound.play("finish");
    load();
  };
  return (
    <>
      <section class="card tool-head">
        <div>
          <h2 class="section-title">{t("Traces of what you do")}</h2>
          <p class="hint">{t("Lists Windows keeps of what you opened and typed. Clearing them doesn't touch your files, and can't be undone.")}</p>
        </div>
      </section>
      {done != null && (
        <div class="outcome" role="status">
          <Icon name="check" />
          <p>{tn("{n} trace cleared.", "{n} traces cleared.", done, { n: count(done) })}</p>
        </div>
      )}
      <section class="card list-card">
        <ul class="files">
          {list.map((x) => (
            <li key={x.id} class="file">
              <input type="checkbox" class="check" checked={chosen.has(x.id)} disabled={x.items === 0} onChange={() => toggle(x.id)} aria-label={t(TRACES[x.id][0])} />
              <span class="file-text">
                <span class="file-name">{t(TRACES[x.id][0])}</span>
                <span class="file-where">{t(TRACES[x.id][1])}</span>
              </span>
              <span class="file-age">{tn("{n} item", "{n} items", x.items, { n: count(x.items) })}</span>
              <span class="file-size">{x.bytes ? bytes(x.bytes) : ""}</span>
            </li>
          ))}
        </ul>
        <div class="actions pad">
          <button class="btn filled" disabled={![...chosen].some((id) => list.some((x) => x.id === id && x.items > 0))} onClick={clear}>
            <Icon name="sweep" size={20} />
            {t("Clear")}
          </button>
        </div>
      </section>
    </>
  );
}

// ── Firewall and safety ──────────────────────────────────────────────────

function FirewallTab() {
  const [f, setF] = useState<Firewall | null>(null);
  const [admin, setAdmin] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const load = () => void firewallReview().then(setF);
  useEffect(load, []);
  const fix = async (what: "on" | "rules") => {
    try {
      await firewallFix(what, [...chosen]);
      Sound.play("finish");
      setChosen(new Set());
      load();
    } catch (e) {
      if (needsAdmin(e)) setAdmin(true);
      Sound.play("error");
    }
  };
  return (
    <>
      {admin && <AdminBanner />}
      {!f ? (
        <section class="card"><p class="hint">{t("Reviewing the firewall…")}</p></section>
      ) : (
        <>
          <section class={`card tool-head`}>
            <div>
              <h2 class="section-title">{f.off.length ? t("The firewall is off for: {list}", { list: f.off.join(", ") }) : t("The firewall is on")}</h2>
              <p class="hint">{t("The firewall decides what can reach your PC from the network.")}</p>
            </div>
            {f.off.length > 0 && (
              <button class="btn filled" onClick={() => void fix("on")}>
                {t("Turn it on")}
              </button>
            )}
          </section>
          {f.stale.length > 0 && (
            <section class="card list-card">
              <header class="list-head">
                <h2 class="section-title">{tn("{n} open door for a program that's gone", "{n} open doors for programs that are gone", f.stale.length)}</h2>
                <p class="hint">{t("Rules that let a program in from the network, but the program is no longer here. Switching them off closes the door; they stay in Windows in case you need them.")}</p>
              </header>
              <ul class="files">
                {f.stale.map((r) => (
                  <li key={r.name} class="file">
                    <input
                      type="checkbox"
                      class="check"
                      checked={chosen.has(r.name)}
                      aria-label={r.display}
                      onChange={() => {
                        const n = new Set(chosen);
                        n.has(r.name) ? n.delete(r.name) : n.add(r.name);
                        setChosen(n);
                      }}
                    />
                    <span class="file-text">
                      <span class="file-name">{r.display || r.name}</span>
                      <span class="file-where">{r.program}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div class="actions pad">
                <button class="btn filled" disabled={chosen.size === 0} onClick={() => void fix("rules")}>
                  {t("Switch off")}
                </button>
              </div>
            </section>
          )}
        </>
      )}
      <Switches groups={["security"]} />
    </>
  );
}
