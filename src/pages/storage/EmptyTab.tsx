// Empty folders: they hold nothing, so removing them loses nothing.

import { useState } from "preact/hooks";
import { findEmpty, removeEmpty, revealFound } from "../../core/api";
import { count } from "../../core/format";
import { t, tn } from "../../i18n/i18n";
import { Icon } from "../../ui/Icon";
import { Sound } from "../../core/sound";
import { Busy, Check, Dock, Outcome, useChoice } from "./common";
import { FolderPick, useFolder } from "./FolderPick";
import { found } from "./state";

export function EmptyTab() {
  const [folder, setFolder] = useFolder(found.emptyRoot);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ removed: number; kept: number } | null>(null);
  const choice = useChoice(found.empty?.folders.map((f) => f.id) ?? []);
  const data = found.empty;

  const run = async () => {
    setBusy(true);
    setResult(null);
    found.empty = await findEmpty(folder);
    found.emptyRoot = folder;
    choice.set(found.empty.folders.map((f) => f.id));
    setBusy(false);
    Sound.play("pop");
  };

  const remove = async () => {
    setBusy(true);
    const r = await removeEmpty([...choice.chosen]);
    const gone = new Set([...choice.chosen].filter((id) => !r.kept.includes(id)));
    if (found.empty) found.empty.folders = found.empty.folders.filter((f) => !gone.has(f.id));
    choice.set([]);
    setResult({ removed: r.removed, kept: r.kept.length });
    setBusy(false);
    Sound.play(r.removed > 0 ? "finish" : "error");
  };

  if (busy) return <Busy title={t("Looking for empty folders…")} />;

  return (
    <>
      <section class="card tool-head">
        <div>
          <h2 class="section-title">{t("Empty folders")}</h2>
          <p class="hint">{t("Folders with nothing inside, not even in their subfolders. Hidden, Windows' and programs' folders are left alone.")}</p>
          <FolderPick folder={folder} set={setFolder} />
        </div>
        <button class="btn filled" onClick={run} disabled={!folder}>
          <Icon name={data ? "refresh" : "play"} size={20} />
          {data ? t("Look again") : t("Look for empty folders")}
        </button>
      </section>
      {result && <Outcome freed={0} files={result.removed} kept={result.kept} verb="remove" />}
      {data && data.folders.length === 0 && (
        <section class="card empty-state">
          <Icon name="check" size={40} />
          <h2>{t("No empty folders")}</h2>
          <p>{tn("I looked in {n} folder.", "I looked in {n} folders.", data.scanned, { n: count(data.scanned) })}</p>
        </section>
      )}
      {data && data.folders.length > 0 && (
        <>
          <section class="card list-card">
            <ul class="files">
              {data.folders.map((f) => (
                <li key={f.id} class="file">
                  <Check on={choice.has(f.id)} onChange={() => choice.toggle(f.id)} label={f.path} />
                  <span class="file-icon">
                    <Icon name="folderOff" size={20} />
                  </span>
                  <span class="file-text">
                    <span class="file-where strong">{f.path}</span>
                  </span>
                  <button class="icon-btn" title={t("Show in folder")} aria-label={t("Show in folder")} onClick={() => void revealFound(f.id)}>
                    <Icon name="folderOpen" size={20} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <Dock
            text={tn("{n} folder chosen", "{n} folders chosen", choice.chosen.size)}
            action={t("Remove")}
            icon="trash"
            disabled={choice.chosen.size === 0}
            onClick={remove}
          />
        </>
      )}
    </>
  );
}
