// The biggest files the map found, to send to the Recycle Bin.

import { useState } from "preact/hooks";
import { removeBig, revealFound, type Removed } from "../../core/api";
import { bytes } from "../../core/format";
import { t, tn } from "../../i18n/i18n";
import { Icon } from "../../ui/Icon";
import { Sound } from "../../core/sound";
import { age, Check, Dock, KINDS, Outcome, useChoice } from "./common";
import { AnalyzeFirst, useAnalysis } from "./MapTab";

export function BigTab({ root }: { root: string }) {
  const choice = useChoice();
  const [result, setResult] = useState<Removed | null>(null);
  const [working, setWorking] = useState(false);
  const { a, busy, run } = useAnalysis(root);
  if (busy || !a) return <AnalyzeFirst root={root} busy={busy} run={run} />;

  const list = a.big;
  const picked = list.filter((f) => choice.has(f.id));
  const size = picked.reduce((s, f) => s + f.bytes, 0);

  const trash = async () => {
    setWorking(true);
    const r = await removeBig([...choice.chosen]);
    const gone = new Set([...choice.chosen].filter((id) => !r.kept.includes(id)));
    a.big = a.big.filter((f) => !gone.has(f.id));
    choice.set([]);
    setResult(r);
    setWorking(false);
    Sound.play(r.files > 0 ? "finish" : "error");
  };

  return (
    <>
      {result && <Outcome freed={result.freed} files={result.files} kept={result.kept.length} verb="trash" />}
      <section class="card list-card">
        <header class="list-head">
          <h2 class="section-title">{tn("The {n} biggest file on {drive}", "The {n} biggest files on {drive}", list.length, { drive: root.replace(/\\$/, "") })}</h2>
          <p class="hint">{t("Over 10 MB. Look before you choose: some may be yours to keep.")}</p>
        </header>
        <ul class="files">
          {list.map((f) => (
            <li key={f.id} class="file">
              <Check on={choice.has(f.id)} onChange={() => choice.toggle(f.id)} label={f.name} />
              <span class="file-icon">
                <Icon name={KINDS[f.kind].icon} size={20} />
              </span>
              <span class="file-text">
                <span class="file-name">{f.name}</span>
                <span class="file-where">{f.folder}</span>
              </span>
              <span class="file-age">{age(f.modified)}</span>
              <span class="file-size">{bytes(f.bytes)}</span>
              <button class="icon-btn" title={t("Show in folder")} aria-label={t("Show in folder")} onClick={() => void revealFound(f.id)}>
                <Icon name="folderOpen" size={20} />
              </button>
            </li>
          ))}
        </ul>
      </section>
      <Dock
        text={picked.length ? tn("{n} file chosen · {size}", "{n} files chosen · {size}", picked.length, { size: bytes(size) }) : t("Choose the files you no longer need")}
        action={t("Send to the Recycle Bin")}
        icon="trash"
        disabled={picked.length === 0 || working}
        onClick={trash}
      />
    </>
  );
}
