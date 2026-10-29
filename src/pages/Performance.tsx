// Rendimiento: the PC right now, Windows services with a recommendation each,
// game mode, and network fixes.

import { useEffect, useRef, useState } from "preact/hooks";
import {
  endProcess, gameOff, gameOn, gameStatus, health, networkFix, perfSample, relaunchAdmin, serviceSet, servicesList,
  type GameSnapshot, type Sample, type Service,
} from "../core/api";
import { bytes } from "../core/format";
import { language, N_, t, tn } from "../i18n/i18n";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/icons";
import { Sound } from "../core/sound";
import { Tokkip } from "../ui/Tokkip";

type Tab = "now" | "services" | "game" | "network";
let lastTab: Tab = "now";

export function Performance() {
  const [tab, setTab] = useState<Tab>(lastTab);
  const go = (x: Tab) => {
    lastTab = x;
    if (x !== tab) Sound.play("blip");
    setTab(x);
  };
  const tabs: [Tab, IconName, string][] = [
    ["now", "speed", N_("Right now")],
    ["services", "settings", N_("Services")],
    ["game", "play", N_("Game mode")],
    ["network", "web", N_("Network")],
  ];
  return (
    <>
      <h1 class="display page-title">{t("Performance")}</h1>
      <nav class="tabs" role="tablist" aria-label={t("Performance")}>
        {tabs.map(([id, icon, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => go(id)}>
            <Icon name={icon} size={20} />
            {t(label)}
          </button>
        ))}
      </nav>
      {tab === "now" && <Now />}
      {tab === "services" && <Services />}
      {tab === "game" && <Game />}
      {tab === "network" && <Network />}
    </>
  );
}

// ── Right now ────────────────────────────────────────────────────────────

const rate = (n: number) => `${bytes(n)}/s`;

function Spark({ values, max }: { values: number[]; max: number }) {
  if (values.length < 2) return <svg class="spark" />;
  const W = 120;
  const H = 32;
  const m = Math.max(max, ...values, 1);
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * W).toFixed(1)},${(H - 2 - (v / m) * (H - 4)).toFixed(1)}`).join(" ");
  return (
    <svg class="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${d} L${W},${H} L0,${H} Z`} class="spark-area" />
      <path d={d} class="spark-line" vector-effect="non-scaling-stroke" />
    </svg>
  );
}

function Now() {
  const [s, setS] = useState<Sample | null>(null);
  const hist = useRef<{ cpu: number[]; mem: number[]; disk: number[]; net: number[] }>({ cpu: [], mem: [], disk: [], net: [] });
  const [asking, setAsking] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const tick = async () => {
      try {
        const x = await perfSample();
        if (!alive) return;
        const h = hist.current;
        const push = (a: number[], v: number) => {
          a.push(v);
          if (a.length > 60) a.shift();
        };
        push(h.cpu, x.cpu);
        push(h.mem, x.memoryUsed);
        push(h.disk, x.diskRead + x.diskWrite);
        push(h.net, x.netDown + x.netUp);
        setS(x);
      } finally {
        if (alive && !document.hidden) timer = window.setTimeout(tick, 1500);
        else if (alive) timer = window.setTimeout(tick, 5000);
      }
    };
    void tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);
  if (!s) return <section class="card"><p class="hint">{t("Looking…")}</p></section>;

  const memPct = (s.memoryUsed / s.memoryTotal) * 100;
  const level = (p: number) => (p > 90 ? "bad" : p > 75 ? "warn" : "ok");
  const mood = s.cpu > 85 || memPct > 90 ? "dizzy" : s.cpu > 60 || memPct > 80 ? "working" : "idle";
  const days = Math.floor(s.uptime / 86400);

  const end = async (name: string) => {
    setAsking("");
    try {
      await endProcess(name);
      setNote(t("{name} was closed.", { name }));
      Sound.play("close");
    } catch {
      setNote(t("{name} couldn't be closed.", { name }));
      Sound.play("error");
    }
  };

  return (
    <>
      <section class="card now-head">
        <Tokkip size={84} state={mood} label="Tokkip" />
        <div>
          <h2 class="section-title">{mood === "dizzy" ? t("Your PC is working very hard") : mood === "working" ? t("Your PC is busy") : t("Your PC is calm")}</h2>
          <p class="hint">
            {s.cpuName} · {tn("{n} core", "{n} cores", s.cores)} · {days > 0 ? tn("on for {n} day", "on for {n} days", days) : t("on since today")}
          </p>
          {days >= 7 && <p class="hint">{t("Restarting now and then clears out what's piled up in memory.")}</p>}
        </div>
      </section>
      <section class="meters">
        <article class={`card meter level-${level(s.cpu)}`}>
          <p class="stat-label">{t("Processor")}</p>
          <p class="stat-value">{Math.round(s.cpu)}%</p>
          <Spark values={hist.current.cpu} max={100} />
        </article>
        <article class={`card meter level-${level(memPct)}`}>
          <p class="stat-label">{t("Memory")}</p>
          <p class="stat-value">{Math.round(memPct)}%</p>
          <p class="stat-note">{t("{used} of {total}", { used: bytes(s.memoryUsed), total: bytes(s.memoryTotal) })}</p>
          <Spark values={hist.current.mem} max={s.memoryTotal} />
        </article>
        <article class="card meter">
          <p class="stat-label">{t("Disk")}</p>
          <p class="stat-value small">{rate(s.diskRead + s.diskWrite)}</p>
          <p class="stat-note">{t("Read {r} · write {w}", { r: rate(s.diskRead), w: rate(s.diskWrite) })}</p>
          <Spark values={hist.current.disk} max={1} />
        </article>
        <article class="card meter">
          <p class="stat-label">{t("Network")}</p>
          <p class="stat-value small">{rate(s.netDown + s.netUp)}</p>
          <p class="stat-note">{t("Down {d} · up {u}", { d: rate(s.netDown), u: rate(s.netUp) })}</p>
          <Spark values={hist.current.net} max={1} />
        </article>
        {s.temperature != null && (
          <article class={`card meter level-${s.temperature > 90 ? "bad" : s.temperature > 80 ? "warn" : "ok"}`}>
            <p class="stat-label">{t("Temperature")}</p>
            <p class="stat-value">{Math.round(s.temperature)}°C</p>
          </article>
        )}
      </section>
      {note && (
        <div class="outcome" role="status">
          <Icon name="info" />
          <p>{note}</p>
        </div>
      )}
      <section class="card list-card">
        <header class="list-head">
          <h2 class="section-title">{t("What's using it")}</h2>
        </header>
        <ul class="files">
          {s.procs.map((p) => (
            <li key={p.name} class="file">
              <span class="file-icon">
                <Icon name={p.critical ? "lock" : "app"} size={20} />
              </span>
              <span class="file-text">
                <span class="file-name">{p.name}</span>
                <span class="file-where">{p.count > 1 ? tn("{n} process", "{n} processes", p.count) : p.critical ? t("Part of Windows") : ""}</span>
              </span>
              <span class="file-age">{p.cpu.toFixed(1)}%</span>
              <span class="file-size">{bytes(p.memory)}</span>
              {!p.critical &&
                (asking === p.name ? (
                  <span class="confirm">
                    <button class="btn text small" onClick={() => setAsking("")}>
                      {t("Cancel")}
                    </button>
                    <button class="btn danger small" onClick={() => void end(p.name)}>
                      {t("Close")}
                    </button>
                  </span>
                ) : (
                  <button class="icon-btn" title={t("Close it")} aria-label={t("Close it")} onClick={() => setAsking(p.name)}>
                    <Icon name="close" size={20} />
                  </button>
                ))}
            </li>
          ))}
        </ul>
        <p class="hint pad">{t("Closing a program this way doesn't save its work: save first.")}</p>
      </section>
    </>
  );
}

// ── Services ─────────────────────────────────────────────────────────────

const SVC_GROUPS: Record<string, string> = {
  telemetry: N_("Sends usage data to Microsoft"),
  xbox: N_("For Xbox and Game Pass"),
  print: N_("For printing"),
  fax: N_("For faxes"),
  media: N_("For sharing media"),
  network: N_("Network extras"),
  remote: N_("For remote access to this PC"),
  bluetooth: N_("For Bluetooth"),
  developer: N_("For developers"),
  core: N_("Part of Windows itself"),
  security: N_("Keeps your PC safe"),
  misc: N_("Windows extras"),
};
const SAFETY: Record<Service["safety"], string> = {
  safe: N_("Safe to switch off"),
  caution: N_("Switch off only if you don't use it"),
  unsafe: N_("Leave it on"),
};

function Services() {
  const [list, setList] = useState<Service[] | null>(null);
  const [admin, setAdmin] = useState(false);
  const load = () => void servicesList().then(setList);
  useEffect(load, []);
  useEffect(() => {
    void health().then((h) => setAdmin(h.elevated));
  }, []);
  const [needAdmin, setNeedAdmin] = useState(false);
  if (!list) return <section class="card"><p class="hint">{t("Looking…")}</p></section>;

  const set = async (s: Service, start: string) => {
    try {
      await serviceSet(s, start);
      Sound.play("pop");
      load();
    } catch (e) {
      if (String(e).includes("admin")) setNeedAdmin(true);
      Sound.play("error");
    }
  };

  return (
    <>
      <section class="card tool-head">
        <div>
          <h2 class="section-title">{t("Windows services")}</h2>
          <p class="hint">{t("Programs Windows runs in the background. These are the ones worth knowing about; switching one off stops it and keeps it from starting. Whatever you change can be put back as it was.")}</p>
        </div>
      </section>
      {(needAdmin || !admin) && (
        <div class="banner">
          <Icon name="admin" />
          <p>{t("Changing services needs administrator rights.")}</p>
          <button class="btn tonal" onClick={() => void relaunchAdmin()}>
            {t("Open as administrator")}
          </button>
        </div>
      )}
      <section class="card list-card">
        <ul class="files">
          {list.map((s) => (
            <li key={s.name} class="file">
              <span class={`file-icon safety-${s.safety}`}>
                <Icon name={s.safety === "unsafe" ? "lock" : "settings"} size={20} />
              </span>
              <span class="file-text">
                <span class="file-name">
                  {s.display} <span class={`chip ${s.safety === "safe" ? "ok" : s.safety === "caution" ? "warn" : ""}`}>{t(SAFETY[s.safety])}</span>
                </span>
                <span class="file-where">
                  {language() === "en" && s.noteEn ? s.noteEn : t(SVC_GROUPS[s.group] ?? "Windows extras")} · {s.running ? t("Running") : t("Stopped")} ·{" "}
                  {s.start === "disabled" ? t("Off") : s.start === "auto" ? t("Starts with Windows") : t("Starts when needed")}
                </span>
              </span>
              {s.was && s.was !== s.start ? (
                <button class="btn tonal small" disabled={!admin} onClick={() => void set(s, s.was!)}>
                  {t("Put back")}
                </button>
              ) : s.start !== "disabled" && s.safety !== "unsafe" ? (
                <button class="btn tonal small" disabled={!admin} onClick={() => void set(s, "disabled")}>
                  {t("Switch off")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

// ── Game mode ────────────────────────────────────────────────────────────

function Game() {
  const [g, setG] = useState<GameSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void gameStatus().then(setG);
  }, []);
  if (!g) return null;
  const flip = async () => {
    setBusy(true);
    if (g.on) {
      await gameOff();
      setG({ on: false, since: 0, scheme: "", stopped: [] });
      Sound.play("close");
    } else {
      setG(await gameOn());
      Sound.play("level_up");
    }
    setBusy(false);
  };
  return (
    <>
      <section class={`hero card compact ${g.on ? "" : "soon"}`}>
        <Tokkip size={110} state={g.on ? "working" : "idle"} dancing={g.on} label="Tokkip" />
        <div class="hero-text">
          <h1 class="display">{g.on ? t("Game mode is on") : t("Game mode")}</h1>
          <p class="lead">{t("While you play: the power plan for the most performance, the PC doesn't go to sleep, and (as administrator) Windows Search and Windows Update wait.")}</p>
          <div class="actions">
            <button class={`btn ${g.on ? "tonal" : "filled"}`} disabled={busy} onClick={flip}>
              <Icon name={g.on ? "stop" : "play"} size={20} />
              {g.on ? t("Turn off") : t("Turn on")}
            </button>
          </div>
        </div>
      </section>
      {g.on && (
        <section class="card">
          <ul class="soon-list">
            <li>{g.scheme ? t("Power plan: high performance") : t("This PC has no high performance plan: the power plan stays as it was")}</li>
            <li>{t("The PC won't go to sleep")}</li>
            {g.stopped.length > 0 && <li>{t("Paused: {list}", { list: g.stopped.join(", ") })}</li>}
          </ul>
          <p class="hint">{t("Turning it off, or closing Healthy PC, puts everything back as it was.")}</p>
        </section>
      )}
    </>
  );
}

// ── Network ──────────────────────────────────────────────────────────────

function Network() {
  const [state, setState] = useState<Record<string, string>>({});
  const run = async (what: "dns" | "arp" | "reset") => {
    setState((s) => ({ ...s, [what]: "working" }));
    try {
      const ok = await networkFix(what);
      setState((s) => ({ ...s, [what]: ok ? "done" : "failed" }));
      Sound.play(ok ? "pop" : "error");
    } catch (e) {
      setState((s) => ({ ...s, [what]: String(e).includes("admin") ? "admin" : "failed" }));
      Sound.play("error");
    }
  };
  const fixes: { id: "dns" | "arp" | "reset"; title: string; about: string; admin: boolean }[] = [
    { id: "dns", title: N_("Clear the DNS cache"), about: N_("When a site doesn't open or opens an old version. Windows asks for addresses again."), admin: false },
    { id: "arp", title: N_("Clear the ARP cache"), about: N_("When devices on your network can't find each other after a router change."), admin: true },
    { id: "reset", title: N_("Reset the network"), about: N_("When nothing else works: puts Windows' network settings back as new. Needs a restart, and Wi-Fi networks stay saved."), admin: true },
  ];
  const label = (st?: string) =>
    st === "done" ? t("Done") : st === "working" ? t("Working…") : st === "admin" ? t("Needs administrator") : st === "failed" ? t("Didn't work") : "";
  return (
    <>
      {Object.values(state).includes("admin") && (
        <div class="banner">
          <Icon name="admin" />
          <p>{t("This one needs administrator rights.")}</p>
          <button class="btn tonal" onClick={() => void relaunchAdmin()}>
            {t("Open as administrator")}
          </button>
        </div>
      )}
      {state.reset === "done" && (
        <div class="outcome" role="status">
          <Icon name="info" />
          <p>{t("Restart your PC to finish resetting the network.")}</p>
        </div>
      )}
      <section class="grid">
        {fixes.map((f) => (
          <article key={f.id} class="card stat">
            <span class="stat-icon">
              <Icon name="web" />
            </span>
            <h2 class="section-title">{t(f.title)}</h2>
            <p class="stat-note">{t(f.about)}</p>
            <div class="actions">
              <button class="btn tonal" disabled={state[f.id] === "working"} onClick={() => void run(f.id)}>
                {t("Do it")}
              </button>
              {f.admin && <span class="chip">{t("Administrator")}</span>}
              <span class="hint">{label(state[f.id])}</span>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
