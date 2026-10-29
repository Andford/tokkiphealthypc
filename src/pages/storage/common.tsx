// What the storage tools share: kinds of files, the "working on it" card with
// its Cancel, the dock that applies a choice, and a choice of ids.

import { useEffect, useState } from "preact/hooks";
import { cancel, onProgress, type FileKind, type Report } from "../../core/api";
import { bytes, count } from "../../core/format";
import { N_, t, tn } from "../../i18n/i18n";
import { Icon } from "../../ui/Icon";
import type { IconName } from "../../ui/icons";
import { Sound } from "../../core/sound";
import { Tokkip } from "../../ui/Tokkip";

export const KINDS: Record<FileKind, { icon: IconName; label: string }> = {
  video: { icon: "video", label: N_("Videos") },
  image: { icon: "image", label: N_("Pictures") },
  music: { icon: "music", label: N_("Music") },
  document: { icon: "document", label: N_("Documents") },
  archive: { icon: "archive", label: N_("Compressed") },
  installer: { icon: "installer", label: N_("Installers and disk images") },
  app: { icon: "app", label: N_("Apps and games") },
  other: { icon: "file", label: N_("Other") },
};

/** Days since `ms`, said simply. */
export function age(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days < 1) return t("today");
  if (days < 60) return tn("{n} day ago", "{n} days ago", days);
  if (days < 730) return tn("{n} month ago", "{n} months ago", Math.floor(days / 30));
  return tn("{n} year ago", "{n} years ago", Math.floor(days / 365));
}

/** The working card: what's been looked at so far, and a way to stop. */
export function Busy({ title, note }: { title: string; note?: string }) {
  const [r, setR] = useState<Report | null>(null);
  useEffect(() => {
    let stop: (() => void) | null = null;
    let gone = false;
    void onProgress(setR).then((s) => (gone ? s() : (stop = s)));
    return () => {
      gone = true;
      stop?.();
    };
  }, []);
  return (
    <section class="card busy-card" aria-live="polite">
      <div class="busy-head">
        <Tokkip size={72} state="searching" label={title} />
        <div>
          <h2>{title}</h2>
          <p class="busy-count">
            {r ? (r.bytes > 0 ? t("{files} files · {size}", { files: count(r.files), size: bytes(r.bytes) }) : tn("{n} looked at", "{n} looked at", r.files, { n: count(r.files) })) : note ?? "…"}
          </p>
        </div>
        <button class="btn tonal" onClick={() => void cancel()}>
          <Icon name="stop" size={20} />
          {t("Stop")}
        </button>
      </div>
      <div class="bar busy plain" />
      {r && <p class="busy-path">{r.path}</p>}
    </section>
  );
}

/** A choice of ids. */
export function useChoice(initial: number[] = []) {
  const [chosen, setChosen] = useState<Set<number>>(new Set(initial));
  return {
    chosen,
    has: (id: number) => chosen.has(id),
    toggle(id: number) {
      const next = new Set(chosen);
      next.has(id) ? next.delete(id) : next.add(id);
      setChosen(next);
      Sound.play("tick");
    },
    set(ids: Iterable<number>) {
      setChosen(new Set(ids));
    },
  };
}

/** The bar at the bottom: what's chosen, and the button that applies it. */
export function Dock({ text, action, icon, onClick, danger, disabled }: { text: string; action: string; icon: IconName; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <div class="dock">
      <p>{text}</p>
      <button class={`btn ${danger ? "danger" : "filled"}`} disabled={disabled} onClick={onClick}>
        <Icon name={icon} size={20} />
        {action}
      </button>
    </div>
  );
}

/** What happened, with the files that stayed (and why they might have). */
export function Outcome({ freed, files, kept, verb }: { freed: number; files: number; kept: number; verb: "trash" | "remove" }) {
  return (
    <div class="outcome" role="status">
      <Icon name={files > 0 ? "check" : "info"} />
      <p>
        {files > 0
          ? verb === "trash"
            ? tn("{n} file to the Recycle Bin ({size}). You can put it back from there.", "{n} files to the Recycle Bin ({size}). You can put them back from there.", files, { size: bytes(freed) })
            : tn("{n} folder removed.", "{n} folders removed.", files)
          : t("Nothing changed.")}{" "}
        {kept > 0 && tn("{n} stayed because it changed since the scan or Windows said no.", "{n} stayed because they changed since the scan or Windows said no.", kept)}
      </p>
    </div>
  );
}

export function Check({ on, onChange, label, disabled }: { on: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return <input type="checkbox" class="check" checked={on} disabled={disabled} aria-label={label} onChange={onChange} />;
}
