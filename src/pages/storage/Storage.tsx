// Almacenamiento: your drives and how their space changes, and the tools that
// find what fills them. Each tool reviews first; nothing is touched until you choose.

import { useEffect, useState } from "preact/hooks";
import { drives as getDrives, spaceHistory, type Drive, type SpaceDay } from "../../core/api";
import { bytes } from "../../core/format";
import { N_, t } from "../../i18n/i18n";
import { Icon } from "../../ui/Icon";
import type { IconName } from "../../ui/icons";
import { Sound } from "../../core/sound";
import { MapTab } from "./MapTab";
import { BigTab } from "./BigTab";
import { DupTab } from "./DupTab";
import { DownloadsTab } from "./DownloadsTab";
import { EmptyTab } from "./EmptyTab";
import { ShredTab } from "./ShredTab";

export type Tab = "map" | "big" | "dups" | "downloads" | "empty" | "shred";

const TABS: readonly { id: Tab; icon: IconName; label: string }[] = [
  { id: "map", icon: "map", label: N_("Map") },
  { id: "big", icon: "storage", label: N_("Big files") },
  { id: "dups", icon: "copy", label: N_("Duplicates") },
  { id: "downloads", icon: "download", label: N_("Downloads") },
  { id: "empty", icon: "folderOff", label: N_("Empty folders") },
  { id: "shred", icon: "shred", label: N_("Shredder") },
];

let lastTab: Tab = "map";

/** Opens this section on a given tab next time (the dashboard\'s links). */
export function openTab(tab: Tab) {
  lastTab = tab;
}
let lastDrive = "";

export function Storage() {
  const [list, setList] = useState<Drive[]>([]);
  const [drive, setDrive] = useState(lastDrive);
  const [tab, setTab] = useState<Tab>(lastTab);
  const [history, setHistory] = useState<SpaceDay[]>([]);

  useEffect(() => {
    void getDrives().then((d) => {
      setList(d);
      if (!lastDrive && d[0]) pickDrive(d[0].root);
    });
    void spaceHistory().then(setHistory);
  }, []);

  const pickDrive = (root: string) => {
    lastDrive = root;
    setDrive(root);
  };
  const go = (next: Tab) => {
    lastTab = next;
    if (next !== tab) Sound.play("blip");
    setTab(next);
  };

  return (
    <>
      <h1 class="display page-title">{t("Storage")}</h1>
      <section class="drives">
        {list.map((d) => (
          <button key={d.root} class="drive card" aria-pressed={drive === d.root} onClick={() => pickDrive(d.root)}>
            <span class="drive-icon">
              <Icon name={d.removable ? "usb" : "drive"} />
            </span>
            <span class="drive-text">
              <span class="drive-name">
                {d.root.replace(/\\$/, "")} {d.label && <span class="drive-label">{d.label}</span>}
                {d.system && <span class="chip">{t("System")}</span>}
              </span>
              <span class="drive-free">{t("{free} free of {total}", { free: bytes(d.free), total: bytes(d.total) })}</span>
              <span class={`bar ${d.free / d.total < 0.1 ? "level-bad" : d.free / d.total < 0.2 ? "level-warn" : ""}`}>
                <span style={{ width: `${Math.round((1 - d.free / d.total) * 100)}%` }} />
              </span>
            </span>
          </button>
        ))}
        {history.length > 1 && <History days={history} />}
      </section>

      <nav class="tabs" role="tablist" aria-label={t("Storage tools")}>
        {TABS.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} onClick={() => go(x.id)}>
            <Icon name={x.icon} size={20} />
            {t(x.label)}
          </button>
        ))}
      </nav>

      {tab === "map" && <MapTab root={drive} goBig={() => go("big")} />}
      {tab === "big" && <BigTab root={drive} />}
      {tab === "dups" && <DupTab />}
      {tab === "downloads" && <DownloadsTab />}
      {tab === "empty" && <EmptyTab />}
      {tab === "shred" && <ShredTab />}
    </>
  );
}

/** How the system drive's free space changed, as a small line. */
function History({ days }: { days: SpaceDay[] }) {
  const recent = days.slice(-90);
  const W = 260;
  const H = 64;
  const max = Math.max(...recent.map((d) => d.free));
  const min = Math.min(...recent.map((d) => d.free));
  const span = Math.max(1, max - min);
  const x = (i: number) => (recent.length === 1 ? W : (i / (recent.length - 1)) * W);
  const y = (v: number) => 6 + (1 - (v - min) / span) * (H - 12);
  const line = recent.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.free).toFixed(1)}`).join(" ");
  const first = recent[0];
  const last = recent[recent.length - 1];
  const change = last.free - first.free;
  const daysAgo = last.day - first.day;
  return (
    <article class="card history">
      <p class="stat-label">
        <Icon name="history" size={18} /> {t("Free space on Windows' drive")}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={t("Free space over the last {n} days", { n: daysAgo })}>
        <path d={`${line} L${W},${H} L0,${H} Z`} class="history-area" />
        <path d={line} class="history-line" vector-effect="non-scaling-stroke" />
      </svg>
      <p class="stat-note">
        {Math.abs(change) < 1024 ** 3 * 0.1
          ? t("About the same as {n} days ago", { n: daysAgo })
          : change < 0
            ? t("{size} less than {n} days ago", { size: bytes(-change), n: daysAgo })
            : t("{size} more than {n} days ago", { size: bytes(change), n: daysAgo })}
      </p>
    </article>
  );
}
