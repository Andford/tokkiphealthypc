// Duplicates: the same file saved more than once. In each group one copy
// stays (the one with the shortest path, marked); you choose which others go.

import { useState } from "preact/hooks";
import { findDuplicates, removeDuplicates, revealFound, type Removed } from "../../core/api";
import { bytes, count } from "../../core/format";
import { t, tn } from "../../i18n/i18n";
import { Icon } from "../../ui/Icon";
import { Sound } from "../../core/sound";
import { age, Busy, Check, Dock, KINDS, Outcome, useChoice } from "./common";
import { FolderPick, useFolder } from "./FolderPick";
import { found } from "./state";

export function DupTab() {
  const [folder, setFolder] = useFolder(found.dupsRoot);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Removed | null>(null);
  const choice = useChoice(defaults());
  const [, redraw] = useState(0);
  const data = found.dups;

  function defaults(): number[] {
    return found.dups?.groups.flatMap((g) => g.copies.slice(1).map((c) => c.id)) ?? [];
  }

  const run = async () => {
    setBusy(true);
    setResult(null);
    Sound.play("open");
    found.dups = await findDuplicates(folder);
    found.dupsRoot = folder;
    choice.set(defaults());
    setBusy(false);
    Sound.play("pop");
  };

  const trash = async () => {
    setBusy(true);
    const r = await removeDuplicates([...choice.chosen]);
    const gone = new Set([...choice.chosen].filter((id) => !r.kept.includes(id)));
    if (found.dups) {
      found.dups.groups = found.dups.groups
        .map((g) => ({ ...g, copies: g.copies.filter((c) => !gone.has(c.id)) }))
        .filter((g) => g.copies.length > 1);
    }
    choice.set([]);
    setResult(r);
    setBusy(false);
    redraw((n) => n + 1);
    Sound.play(r.files > 0 ? "finish" : "error");
  };

  if (busy && !data) return <Busy title={t("Looking for duplicates…")} note={t("First by size, then by content. Big folders take a while.")} />;

  const picked = data?.groups.flatMap((g) => g.copies.filter((c) => choice.has(c.id)).map(() => g.bytes)) ?? [];
  const size = picked.reduce((s, b) => s + b, 0);

  return (
    <>
      <section class="card tool-head">
        <div>
          <h2 class="section-title">{t("Duplicate files")}</h2>
          <p class="hint">{t("Files over 1 MB with exactly the same content. Windows' and programs' folders are left out.")}</p>
          <FolderPick folder={folder} set={setFolder} />
        </div>
        <button class="btn filled" onClick={run} disabled={!folder || busy}>
          <Icon name={data ? "refresh" : "play"} size={20} />
          {data ? t("Look again") : t("Look for duplicates")}
        </button>
      </section>
      {busy && data && <Busy title={t("Working…")} />}
      {result && <Outcome freed={result.freed} files={result.files} kept={result.kept.length} verb="trash" />}
      {data && !busy && data.groups.length === 0 && (
        <section class="card empty-state">
          <Icon name="check" size={40} />
          <h2>{t("No duplicates here")}</h2>
          <p>{tn("I compared {n} file.", "I compared {n} files.", data.files, { n: count(data.files) })}</p>
        </section>
      )}
      {data &&
        !busy &&
        data.groups.map((g, gi) => (
          <section class="card dup" key={g.copies[0].id + "-" + gi}>
            <header class="dup-head">
              <span class="file-icon">
                <Icon name={KINDS[g.kind].icon} size={20} />
              </span>
              <h3>{g.copies[0].path.split(/[\\/]/).pop()}</h3>
              <span class="dup-meta">{tn("{n} copy of {size}", "{n} copies of {size}", g.copies.length, { size: bytes(g.bytes) })}</span>
            </header>
            <ul class="files">
              {g.copies.map((c, i) => (
                <li key={c.id} class="file">
                  <Check on={choice.has(c.id)} onChange={() => choice.toggle(c.id)} label={c.path} />
                  <span class="file-text">
                    <span class="file-where strong">{c.path}</span>
                  </span>
                  {i === 0 && <span class="chip ok">{t("Stays")}</span>}
                  <span class="file-age">{age(c.modified)}</span>
                  <button class="icon-btn" title={t("Show in folder")} aria-label={t("Show in folder")} onClick={() => void revealFound(c.id)}>
                    <Icon name="folderOpen" size={20} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      {data && data.groups.length > 0 && (
        <Dock
          text={picked.length ? tn("{n} copy chosen · frees {size}", "{n} copies chosen · frees {size}", picked.length, { size: bytes(size) }) : t("Choose the copies to remove")}
          action={t("Send to the Recycle Bin")}
          icon="trash"
          disabled={picked.length === 0 || busy}
          onClick={trash}
        />
      )}
    </>
  );
}
