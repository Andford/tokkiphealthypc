// Inicio: how your PC feels, why, and what to do about it.

import { useEffect, useRef, useState } from "preact/hooks";
import {
  activityList, defenderStatus, health, perfSample, privacyList, restorePoints, startupList, updatesList,
  type Done, type Health, type Reason, type Sample,
} from "../core/api";
import { ago, bytes } from "../core/format";
import { moodState, moodTitle } from "../core/mood";
import { N_, t, tn } from "../i18n/i18n";
import type { IconName } from "../ui/icons";
import { openTab as openSoftware } from "./Software";
import { openTab as openProtection } from "./Protection";
import { openTab as openPerformance } from "./Performance";
import { openTab as openCare } from "./Care";
import { Icon } from "../ui/Icon";
import { Tokkip } from "../ui/Tokkip";
import type { Page } from "../App";
import type { TokkipMotion } from "../tokkip/motion";

let greeted = false;

export function Home({ go }: { go: (p: Page) => void }) {
  const [h, setH] = useState<Health | null>(null);
  useEffect(() => {
    void health().then(setH);
  }, []);

  const ready = (e: TokkipMotion) => {
    if (greeted) return;
    greeted = true;
    window.setTimeout(() => e.greet(), 600);
  };

  return (
    <>
      <section class="hero card">
        <Tokkip size={150} state={h ? moodState(h.mood) : "idle"} onReady={ready} label={h ? moodTitle(h.mood) : "Tokkip"} />
        <div class="hero-text">
          {h ? (
            <>
              <p class="eyebrow">{t("Your PC's health")}</p>
              <h1 class="display">{moodTitle(h.mood)}</h1>
              <p class="lead">{summary(h)}</p>
              <div class="actions">
                <button class="btn filled" onClick={() => go("clean")}>
                  <Icon name="sweep" size={20} />
                  {t("Clean now")}
                </button>
              </div>
            </>
          ) : (
            <p class="lead">{t("Looking at your PC…")}</p>
          )}
        </div>
        {h && <Score value={h.score} />}
      </section>

      {h && (
        <section class="grid">
          {h.reasons.map((r) => (
            <ReasonCard key={r.id} r={r} h={h} go={go} />
          ))}
          <article class="card stat">
            <span class="stat-icon">
              <Icon name="heart" />
            </span>
            <p class="stat-label">{t("Freed with Tokkip")}</p>
            <p class="stat-value">{bytes(h.totalFreed)}</p>
            <p class="stat-note">{h.lastFreed > 0 ? t("{size} the last time", { size: bytes(h.lastFreed) }) : t("Your first clean is waiting")}</p>
          </article>
        </section>
      )}
      <Live go={go} />
      {h && <CareScore h={h} go={go} />}
    </>
  );
}

// ── Right now ────────────────────────────────────────────────────────────

function Spark({ values, max, tone }: { values: number[]; max: number; tone: string }) {
  if (values.length < 2) return <svg class="spark" />;
  const W = 200;
  const H = 40;
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * W).toFixed(1)},${(H - 2 - (v / Math.max(max, 1)) * (H - 4)).toFixed(1)}`).join(" ");
  return (
    <svg class={`spark ${tone}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${d} L${W},${H} L0,${H} Z`} class="spark-area" />
      <path d={d} class="spark-line" vector-effect="non-scaling-stroke" />
    </svg>
  );
}

function Live({ go }: { go: (p: Page) => void }) {
  const [s, setS] = useState<Sample | null>(null);
  const hist = useRef<{ cpu: number[]; mem: number[] }>({ cpu: [], mem: [] });
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const x = await perfSample();
        if (!alive) return;
        const h = hist.current;
        h.cpu.push(x.cpu);
        h.mem.push((x.memoryUsed / x.memoryTotal) * 100);
        if (h.cpu.length > 40) h.cpu.shift();
        if (h.mem.length > 40) h.mem.shift();
        setS(x);
      } finally {
        if (alive) window.setTimeout(tick, document.hidden ? 6000 : 2000);
      }
    };
    void tick();
    return () => {
      alive = false;
    };
  }, []);
  if (!s) return null;
  const mem = (s.memoryUsed / s.memoryTotal) * 100;
  const top = s.procs.find((p) => !p.critical);
  return (
    <section class="live">
      <article class="card live-card">
        <p class="stat-label">
          <Icon name="speed" size={18} /> {t("Processor")}
        </p>
        <p class="stat-value">{Math.round(s.cpu)}%</p>
        <Spark values={hist.current.cpu} max={100} tone="" />
        <p class="stat-note">{s.cpuName}</p>
      </article>
      <article class="card live-card">
        <p class="stat-label">
          <Icon name="app" size={18} /> {t("Memory")}
        </p>
        <p class="stat-value">{Math.round(mem)}%</p>
        <Spark values={hist.current.mem} max={100} tone="tertiary" />
        <p class="stat-note">
          {t("{used} of {total}", { used: bytes(s.memoryUsed), total: bytes(s.memoryTotal) })}
          {mem > 85 && top ? " · " + t("{name} uses the most", { name: top.name }) : ""}
        </p>
      </article>
      <button
        class="card live-card link-card"
        onClick={() => {
          openPerformance("now");
          go("speed");
        }}
      >
        <p class="stat-label">
          <Icon name="history" size={18} /> {t("On for")}
        </p>
        <p class="stat-value">{Math.floor(s.uptime / 86400) > 0 ? tn("{n} day", "{n} days", Math.floor(s.uptime / 86400)) : `${Math.floor(s.uptime / 3600)} h`}</p>
        <p class="stat-note">{t("See performance in real time")}</p>
        <Icon name="chevronRight" class="link-arrow" />
      </button>
    </section>
  );
}

// ── Care score ───────────────────────────────────────────────────────────

interface Check {
  id: string;
  ok: boolean;
  icon: IconName;
  text: string;
  action?: string;
  go?: () => void;
}

function CareScore({ h, go }: { h: Health; go: (p: Page) => void }) {
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [done, setDone] = useState<Done[]>([]);
  const put = (c: Check) => setChecks((x) => ({ ...x, [c.id]: c }));

  useEffect(() => {
    const disk = h.reasons.find((r) => r.id === "disk");
    const clean = h.reasons.find((r) => r.id === "clean");
    put({ id: "disk", ok: disk?.level === "ok", icon: "storage", text: disk?.level === "ok" ? t("Enough free space") : t("Your disk is getting full"), action: t("See what fills it"), go: () => go("storage") });
    put({ id: "clean", ok: clean?.level === "ok", icon: "clean", text: clean?.level === "ok" ? t("Cleaned recently") : t("A clean is due"), action: t("Clean"), go: () => go("clean") });
    void defenderStatus().then((d) => {
      const recent = d.quickScan > 0 && Date.now() - d.quickScan < 14 * 86_400_000;
      const ok = !d.available || (d.realtime && !d.threats.some((x) => x.active) && recent);
      put({
        id: "antivirus", ok, icon: "shield",
        text: !d.available ? t("Another antivirus protects your PC") : ok ? t("Protected, and scanned recently") : !d.realtime ? t("Real-time protection is off") : t("No scan in two weeks"),
        action: t("Open"), go: () => { openProtection("antivirus"); go("protect"); },
      });
    }).catch(() => {});
    void startupList().then((l) => {
      const on = l.filter((x) => x.enabled).length;
      put({ id: "startup", ok: on <= 8, icon: "play", text: tn("{n} program starts with Windows", "{n} programs start with Windows", on), action: t("Review"), go: () => { openSoftware("startup"); go("software"); } });
    }).catch(() => {});
    void privacyList().then((l) => {
      const p = l.filter((x) => x.group !== "security");
      const on = p.filter((x) => x.on).length;
      put({ id: "privacy", ok: on >= p.length / 2, icon: "lock", text: t("Privacy: {n} of {total} settings private", { n: on, total: p.length }), action: t("Review"), go: () => { openProtection("privacy"); go("protect"); } });
    }).catch(() => {});
    void restorePoints().then((l) => {
      const recent = l.some((r) => Date.now() - r.at < 30 * 86_400_000);
      put({ id: "restore", ok: recent, icon: "history", text: recent ? t("You have a recent restore point") : t("No restore point this month"), action: t("Make one"), go: () => { openCare("restore"); go("care"); } });
    }).catch(() => {});
    void updatesList().then((u) => {
      if (u == null) return;
      put({ id: "updates", ok: u.length === 0, icon: "download", text: u.length ? tn("{n} program has an update", "{n} programs have an update", u.length) : t("Your programs are up to date"), action: t("Update"), go: () => { openSoftware("updates"); go("software"); } });
    }).catch(() => {});
    void activityList().then(setDone).catch(() => {});
  }, []);

  const list = Object.values(checks);
  const ok = list.filter((c) => c.ok).length;
  const score = list.length ? Math.round((ok / list.length) * 100) : 0;
  const week = done.filter((d) => Date.now() - d.at < 7 * 86_400_000);
  const r = 46;
  const c = 2 * Math.PI * r;

  return (
    <section class="care">
      <article class="card care-card">
        <header class="care-head">
          <div class="care-ring" role="img" aria-label={t("Care score {n} of 100", { n: score })}>
            <svg viewBox="0 0 110 110" width="110" height="110">
              <circle cx="55" cy="55" r={r} class="ring-track" />
              <circle cx="55" cy="55" r={r} class="ring-fill" stroke-dasharray={`${(c * score) / 100} ${c}`} />
            </svg>
            <span class="care-value">{score}</span>
          </div>
          <div>
            <p class="eyebrow plain">{t("Care score")}</p>
            <h2 class="section-title">{ok === list.length && list.length > 0 ? t("Everything's in order") : tn("{n} thing to look at", "{n} things to look at", list.length - ok)}</h2>
            <p class="hint">{tn("{n} of {total} checks fine", "{n} of {total} checks fine", ok, { total: list.length })}</p>
          </div>
        </header>
        <ul class="checks">
          {[...list].sort((a, b) => Number(a.ok) - Number(b.ok)).map((x) => (
            <li key={x.id} class={x.ok ? "ok" : "todo"}>
              <span class="check-icon">
                <Icon name={x.ok ? "check" : x.icon} size={18} />
              </span>
              <span class="check-text">{x.text}</span>
              {!x.ok && x.go && (
                <button class="btn text small" onClick={x.go}>
                  {x.action}
                  <Icon name="chevronRight" size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      </article>
      <button
        class="card care-card link-card"
        onClick={() => {
          openCare("activity");
          go("care");
        }}
      >
        <p class="eyebrow plain">{t("This week")}</p>
        <p class="stat-value">{tn("{n} thing done", "{n} things done", week.length)}</p>
        <p class="stat-note">{t("{size} freed", { size: bytes(week.reduce((s, d) => s + (["clean", "trash", "shred"].includes(d.kind) ? d.bytes : 0), 0)) })}</p>
        <ul class="mini-activity">
          {done.slice(0, 4).map((d, i) => (
            <li key={i}>
              <span>{t(KIND_SHORT[d.kind] ?? N_("Something"))}</span>
              <span class="hint">{ago(d.at)}</span>
            </li>
          ))}
        </ul>
        <p class="stat-note link-more">
          {t("See all the activity")} <Icon name="chevronRight" size={16} />
        </p>
      </button>
    </section>
  );
}

const KIND_SHORT: Record<string, string> = {
  clean: N_("Clean"), trash: N_("To the Recycle Bin"), shred: N_("Shredded"), empty: N_("Empty folders"), uninstall: N_("Uninstall"),
  apps: N_("Preinstalled app"), service: N_("Service"), registry: N_("Registry"), privacy: N_("Privacy"), traces: N_("Traces"),
  firewall: N_("Firewall"), scan: N_("Defender scan"), repair: N_("Windows repair"), restorePoint: N_("Restore point"),
  routine: N_("Weekly clean"), game: N_("Game mode"),
};

function summary(h: Health): string {
  const bad = h.reasons.filter((r) => r.level !== "ok");
  if (bad.length === 0) return t("Plenty of room and clean. Nothing to do today.");
  if (bad.some((r) => r.id === "disk" && r.level === "bad")) return t("Your disk is almost full. A clean will give it some air.");
  if (bad.some((r) => r.id === "clean")) return t("It's been a while since the last clean. Want to see what can go?");
  return t("Your disk is filling up. A clean will help.");
}

function Score({ value }: { value: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div class="score" role="img" aria-label={t("Health {n} of 100", { n: value })}>
      <svg viewBox="0 0 120 120" width="132" height="132">
        <circle cx="60" cy="60" r={r} class="score-track" />
        <circle cx="60" cy="60" r={r} class="score-fill" stroke-dasharray={`${(c * value) / 100} ${c}`} />
      </svg>
      <span class="score-value">{value}</span>
      <span class="score-of">/ 100</span>
    </div>
  );
}

function ReasonCard({ r, h, go }: { r: Reason; h: Health; go: (p: Page) => void }) {
  if (r.id === "disk") {
    const used = h.diskTotal ? 1 - h.diskFree / h.diskTotal : 0;
    return (
      <article class={`card stat level-${r.level}`}>
        <span class="stat-icon">
          <Icon name="storage" />
        </span>
        <p class="stat-label">{t("Free space")}</p>
        <p class="stat-value">{bytes(h.diskFree)}</p>
        <div class="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used * 100)}>
          <span style={{ width: `${Math.round(used * 100)}%` }} />
        </div>
        <p class="stat-note">{t("of {total} on your system disk", { total: bytes(h.diskTotal) })}</p>
      </article>
    );
  }
  return (
    <article class={`card stat level-${r.level}`}>
      <span class="stat-icon">
        <Icon name="clean" />
      </span>
      <p class="stat-label">{t("Last clean")}</p>
      <p class="stat-value">{ago(h.lastClean)}</p>
      <button class="btn text" onClick={() => go("clean")}>
        {t("See what can go")}
        <Icon name="chevronRight" size={18} />
      </button>
    </article>
  );
}
