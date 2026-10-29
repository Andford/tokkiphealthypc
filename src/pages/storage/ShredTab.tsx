// The shredder: writes over files before deleting them, so recovery programs
// can't bring them back. It can't be undone, and it says so before.

import { useState } from "preact/hooks";
import { describeShred, pickPaths, shred, type ShredChoice, type Shredded } from "../../core/api";
import { bytes, count } from "../../core/format";
import { t, tn } from "../../i18n/i18n";
import { Icon } from "../../ui/Icon";
import { Sound } from "../../core/sound";
import { Busy } from "./common";

export function ShredTab() {
  const [list, setList] = useState<ShredChoice[]>([]);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Shredded | null>(null);

  const add = async (directory: boolean) => {
    const paths = await pickPaths({ directory, multiple: true, title: directory ? t("Choose folders to shred") : t("Choose files to shred") });
    if (paths.length === 0) return;
    const more = await describeShred(paths.filter((p) => !list.some((l) => l.path === p)));
    setList([...list, ...more]);
    setResult(null);
    setSure(false);
  };

  const go = async () => {
    setBusy(true);
    const r = await shred(list.filter((l) => !l.protected).map((l) => l.path));
    setResult(r);
    setList([]);
    setSure(false);
    setBusy(false);
    Sound.play(r.files > 0 ? "finish" : "error");
  };

  if (busy) return <Busy title={t("Shredding…")} note={t("Writing over each file twice.")} />;

  const ok = list.filter((l) => !l.protected);
  const size = ok.reduce((s, l) => s + l.bytes, 0);
  const files = ok.reduce((s, l) => s + l.files, 0);

  return (
    <>
      <section class="card warn-card">
        <Icon name="warning" size={28} />
        <div>
          <h2 class="section-title">{t("Shred files for good")}</h2>
          <p>{t("Shredding writes over a file before deleting it, so no recovery program can bring it back. It doesn't go to the Recycle Bin and can't be undone.")}</p>
          <p class="hint">{t("On SSDs and USB drives, the drive itself may keep old copies out of reach. For those, Windows' encryption (BitLocker) protects better.")}</p>
        </div>
      </section>

      {result && (
        <div class="outcome" role="status">
          <Icon name={result.files > 0 ? "check" : "info"} />
          <p>
            {tn("{n} file shredded ({size}).", "{n} files shredded ({size}).", result.files, { n: count(result.files), size: bytes(result.bytes) })}{" "}
            {result.failed > 0 && tn("{n} couldn't be: it's in use, changed, or is protected.", "{n} couldn't be: they're in use, changed, or are protected.", result.failed)}
            {result.cancelled && t("You stopped it: the file it was on was not deleted.")}
          </p>
        </div>
      )}

      <section class="card">
        <div class="actions tight">
          <button class="btn tonal" onClick={() => add(false)}>
            <Icon name="file" size={20} />
            {t("Choose files")}
          </button>
          <button class="btn tonal" onClick={() => add(true)}>
            <Icon name="folder" size={20} />
            {t("Choose folders")}
          </button>
        </div>
        {list.length > 0 && (
          <ul class="files">
            {list.map((l) => (
              <li key={l.path} class={`file ${l.protected ? "locked" : ""}`}>
                <span class="file-icon">
                  <Icon name={l.protected ? "lock" : l.folder ? "folder" : "file"} size={20} />
                </span>
                <span class="file-text">
                  <span class="file-name">{l.name}</span>
                  <span class="file-where">{l.protected ? t("Protected: Windows' or a program's own, or one of your main folders") : l.path}</span>
                </span>
                {!l.protected && <span class="file-age">{l.folder ? tn("{n} file", "{n} files", l.files, { n: count(l.files) }) : ""}</span>}
                <span class="file-size">{l.protected ? "" : bytes(l.bytes)}</span>
                <button class="icon-btn" title={t("Take off the list")} aria-label={t("Take off the list")} onClick={() => setList(list.filter((x) => x !== l))}>
                  <Icon name="close" size={20} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {ok.length > 0 && (
        <div class="dock danger-dock">
          <label class="sure">
            <input type="checkbox" class="check" checked={sure} onChange={() => setSure(!sure)} />
            <span>{tn("I understand {n} file ({size}) will be gone for good", "I understand {n} files ({size}) will be gone for good", files, { n: count(files), size: bytes(size) })}</span>
          </label>
          <button class="btn danger" disabled={!sure} onClick={go}>
            <Icon name="shred" size={20} />
            {t("Shred")}
          </button>
        </div>
      )}
    </>
  );
}
