// Downloads: what's sitting in your Downloads folder. Installers, compressed
// files and disk images you downloaded over a month ago come chosen.

import { useEffect, useState } from "preact/hooks";
import { findDownloads, removeDownloads, revealFound, type Download, type DownloadKind, type Removed } from "../../core/api";
import { bytes } from "../../core/format";
import { N_, t, tn } from "../../i18n/i18n";
import { Icon } from "../../ui/Icon";
import type { IconName } from "../../ui/icons";
import { Sound } from "../../core/sound";
import { age, Check, Dock, Outcome, useChoice } from "./common";
import { found } from "./state";
import { Working } from "../../ui/Working";

const KIND: Record<DownloadKind, { icon: IconName; label: string }> = {
  installer: { icon: "installer", label: N_("Installers") },
  archive: { icon: "archive", label: N_("Compressed") },
  diskImage: { icon: "drive", label: N_("Disk images") },
  other: { icon: "file", label: N_("Other") },
};
const MONTH = 30 * 86_400_000;
const suggested = (f: Download) => f.kind !== "other" && Date.now() - f.modified > MONTH;

export function DownloadsTab() {
  const [busy, setBusy] = useState(!found.downloads);
  const [filter, setFilter] = useState<DownloadKind | "all">("all");
  const [result, setResult] = useState<Removed | null>(null);
  const choice = useChoice(found.downloads?.files.filter(suggested).map((f) => f.id) ?? []);

  const load = async () => {
    setBusy(true);
    found.downloads = await findDownloads();
    choice.set(found.downloads.files.filter(suggested).map((f) => f.id));
    setBusy(false);
  };
  useEffect(() => {
    if (!found.downloads) void load();
  }, []);

  const data = found.downloads;
  if (busy || !data) return <Working text={t("Looking at your Downloads…")} />;

  const list = data.files.filter((f) => filter === "all" || f.kind === filter);
  const picked = data.files.filter((f) => choice.has(f.id));
  const size = picked.reduce((s, f) => s + f.bytes, 0);
  const total = data.files.reduce((s, f) => s + f.bytes, 0);

  const trash = async () => {
    setBusy(true);
    const r = await removeDownloads([...choice.chosen]);
    const gone = new Set([...choice.chosen].filter((id) => !r.kept.includes(id)));
    data.files = data.files.filter((f) => !gone.has(f.id));
    choice.set([]);
    setResult(r);
    setBusy(false);
    Sound.play(r.files > 0 ? "finish" : "error");
  };

  return (
    <>
      <section class="card tool-head">
        <div>
          <h2 class="section-title">{t("Your Downloads")}</h2>
          <p class="hint">
            {tn("{n} file · {size}", "{n} files · {size}", data.files.length, { size: bytes(total) })} · {data.folder}
          </p>
          <p class="hint">{t("Installers, compressed files and disk images over a month old come chosen: once used, they're rarely needed again.")}</p>
        </div>
        <button class="btn tonal" onClick={load}>
          <Icon name="refresh" size={20} />
          {t("Look again")}
        </button>
      </section>
      {result && <Outcome freed={result.freed} files={result.files} kept={result.kept.length} verb="trash" />}
      <div class="filters" role="radiogroup" aria-label={t("Show")}>
        {(["all", "installer", "archive", "diskImage", "other"] as const).map((k) => (
          <button key={k} role="radio" aria-checked={filter === k} onClick={() => setFilter(k)}>
            {k === "all" ? t("All") : t(KIND[k].label)}
          </button>
        ))}
      </div>
      <section class="card list-card">
        {list.length === 0 ? (
          <p class="hint">{t("Nothing here.")}</p>
        ) : (
          <ul class="files">
            {list.map((f) => (
              <li key={f.id} class="file">
                <Check on={choice.has(f.id)} onChange={() => choice.toggle(f.id)} label={f.name} />
                <span class="file-icon">
                  <Icon name={KIND[f.kind].icon} size={20} />
                </span>
                <span class="file-text">
                  <span class="file-name">{f.name}</span>
                  <span class="file-where">{t(KIND[f.kind].label)}</span>
                </span>
                <span class="file-age">{age(f.modified)}</span>
                <span class="file-size">{bytes(f.bytes)}</span>
                <button class="icon-btn" title={t("Show in folder")} aria-label={t("Show in folder")} onClick={() => void revealFound(f.id)}>
                  <Icon name="folderOpen" size={20} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Dock
        text={picked.length ? tn("{n} file chosen · {size}", "{n} files chosen · {size}", picked.length, { size: bytes(size) }) : t("Choose what you no longer need")}
        action={t("Send to the Recycle Bin")}
        icon="trash"
        disabled={picked.length === 0}
        onClick={trash}
      />
    </>
  );
}
