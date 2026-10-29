// Limpiar: review → choose → clean. Nothing is deleted while reviewing; what
// is open is skipped and counted; admin rules wait for an elevated app.

import { useEffect, useMemo, useState } from "preact/hooks";
import { clean, health, relaunchAdmin, scan, tokkipNotice, type CleanReport, type Group, type RuleScan } from "../core/api";
import { bytes, count } from "../core/format";
import { N_, language, t, tn } from "../i18n/i18n";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/icons";
import { Tokkip } from "../ui/Tokkip";
import { Sound } from "../core/sound";

type Step = "start" | "scanning" | "review" | "cleaning" | "done";

const GROUPS: readonly { id: Group; icon: IconName; label: string }[] = [
  { id: "system", icon: "system", label: N_("Windows") },
  { id: "browsers", icon: "web", label: N_("Browsers") },
  { id: "apps", icon: "apps", label: N_("Apps and games") },
];

/** Picked by default: what has something and can be undone or remade. */
const pickedByDefault = (r: RuleScan, elevated: boolean) => r.bytes > 0 && r.id !== "recycle-bin" && (!r.admin || elevated);

export function Clean() {
  const [step, setStep] = useState<Step>("start");
  const [rules, setRules] = useState<RuleScan[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [elevated, setElevated] = useState(false);
  const [report, setReport] = useState<CleanReport | null>(null);
  const [adminRefused, setAdminRefused] = useState(false);

  useEffect(() => {
    void health().then((h) => setElevated(h.elevated));
  }, []);

  const review = async () => {
    setStep("scanning");
    Sound.play("open");
    const found = await scan();
    setRules(found);
    setPicked(new Set(found.filter((r) => pickedByDefault(r, elevated)).map((r) => r.id)));
    setStep("review");
    Sound.play("pop");
  };

  const go = async () => {
    setStep("cleaning");
    const r = await clean([...picked]);
    setReport(r);
    setStep("done");
    if (r.freed > 0) {
      Sound.play("level_up");
      const h = await health();
      void tokkipNotice({
        score: h.score,
        mood: "party",
        kind: "clean",
        message: t("I freed {size} on your PC!", { size: bytes(r.freed) }),
        bytes: r.freed,
      });
    } else {
      Sound.play("finish");
    }
  };

  const selected = useMemo(() => rules.filter((r) => picked.has(r.id)), [rules, picked]);
  const selectedBytes = selected.reduce((s, r) => s + r.bytes, 0);
  const total = rules.reduce((s, r) => s + r.bytes, 0);

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
    Sound.play("tick");
  };

  const toggleGroup = (g: Group, on: boolean) => {
    const next = new Set(picked);
    for (const r of rules) if (r.group === g && r.bytes > 0 && (!r.admin || elevated)) on ? next.add(r.id) : next.delete(r.id);
    setPicked(next);
    Sound.play("tick");
  };

  const admin = async () => {
    const ok = await relaunchAdmin();
    if (!ok) setAdminRefused(true);
  };

  const tokkipState = step === "scanning" ? "searching" : step === "cleaning" ? "working" : step === "done" ? "finished" : "idle";

  return (
    <>
      <section class="hero card compact">
        <Tokkip size={110} state={tokkipState} dancing={step === "done" && (report?.freed ?? 0) > 0} label="Tokkip" />
        <div class="hero-text">
          {step === "start" && (
            <>
              <h1 class="display">{t("Clean your PC")}</h1>
              <p class="lead">{t("I'll look for what your PC no longer needs. Nothing is deleted until you say so.")}</p>
              <div class="actions">
                <button class="btn filled" onClick={review}>
                  <Icon name="play" size={20} />
                  {t("Review")}
                </button>
              </div>
            </>
          )}
          {step === "scanning" && (
            <>
              <h1 class="display">{t("Looking…")}</h1>
              <p class="lead">{t("Temporary files, caches and leftovers. This takes a moment.")}</p>
              <div class="bar busy" />
            </>
          )}
          {step === "review" && (
            <>
              <h1 class="display">{t("I found {size}", { size: bytes(total) })}</h1>
              <p class="lead">{t("Choose what goes. Programs that are open keep their files in use; close them to free everything.")}</p>
            </>
          )}
          {step === "cleaning" && (
            <>
              <h1 class="display">{t("Cleaning…")}</h1>
              <p class="lead">{t("Files in use are skipped, never forced.")}</p>
              <div class="bar busy" />
            </>
          )}
          {step === "done" && report && <Done report={report} again={review} />}
        </div>
      </section>

      {!elevated && step === "review" && rules.some((r) => r.admin && r.bytes > 0) && (
        <div class="banner">
          <Icon name="admin" />
          <p>{adminRefused ? t("Windows didn't open it as administrator. You can try again.") : t("Some cleans need administrator rights.")}</p>
          <button class="btn tonal" onClick={admin}>
            {t("Open as administrator")}
          </button>
        </div>
      )}

      {step === "done" && report && report.needsAdmin.length > 0 && !elevated && (
        <div class="banner">
          <Icon name="admin" />
          <p>{tn("{n} clean waited for administrator rights.", "{n} cleans waited for administrator rights.", report.needsAdmin.length)}</p>
          <button class="btn tonal" onClick={admin}>
            {t("Open as administrator")}
          </button>
        </div>
      )}

      {step === "review" && (
        <>
          {GROUPS.map((g) => {
            const list = rules.filter((r) => r.group === g.id);
            if (list.length === 0) return null;
            const pickable = list.filter((r) => r.bytes > 0 && (!r.admin || elevated));
            const all = pickable.length > 0 && pickable.every((r) => picked.has(r.id));
            const size = list.reduce((s, r) => s + r.bytes, 0);
            return (
              <section class="card group" key={g.id}>
                <header class="group-head">
                  <span class="group-icon">
                    <Icon name={g.icon} />
                  </span>
                  <h2>{t(g.label)}</h2>
                  <span class="group-size">{bytes(size)}</span>
                  <button class="btn text small" disabled={pickable.length === 0} onClick={() => toggleGroup(g.id, !all)}>
                    {all ? t("None") : t("All")}
                  </button>
                </header>
                <ul class="rules">
                  {list.map((r) => (
                    <RuleRow key={r.id} r={r} on={picked.has(r.id)} locked={r.bytes === 0 || (r.admin && !elevated)} toggle={() => toggle(r.id)} />
                  ))}
                </ul>
              </section>
            );
          })}
          <div class="dock">
            <p>
              {selected.length === 0
                ? t("Nothing chosen")
                : tn("{n} chosen · {size}", "{n} chosen · {size}", selected.length, { size: bytes(selectedBytes) })}
            </p>
            <button class="btn filled" disabled={selected.length === 0} onClick={go}>
              <Icon name="sweep" size={20} />
              {t("Clean")}
            </button>
          </div>
        </>
      )}
    </>
  );
}

function RuleRow({ r, on, locked, toggle }: { r: RuleScan; on: boolean; locked: boolean; toggle: () => void }) {
  const es = language() === "es";
  const id = `rule-${r.id}`;
  return (
    <li class={`rule ${locked ? "locked" : ""}`}>
      <input type="checkbox" id={id} class="check" checked={on && !locked} disabled={locked} onChange={toggle} />
      <label for={id}>
        <span class="rule-name">
          {es ? r.name : r.nameEn}
          {r.running && <span class="chip warn">{t("Open now")}</span>}
          {r.admin && <span class="chip">{t("Administrator")}</span>}
          {r.id === "recycle-bin" && r.bytes > 0 && <span class="chip warn">{t("Can't be undone")}</span>}
        </span>
        <span class="rule-about">{es ? r.about : r.aboutEn}</span>
      </label>
      <span class="rule-size">{r.bytes > 0 ? bytes(r.bytes) : t("Clean")}</span>
      {r.files > 0 && <span class="rule-files">{tn("{n} file", "{n} files", r.files, { n: count(r.files) })}</span>}
    </li>
  );
}

function Done({ report, again }: { report: CleanReport; again: () => void }) {
  return (
    <>
      <h1 class="display">{report.freed > 0 ? t("You freed {size}!", { size: bytes(report.freed) }) : t("All clean already")}</h1>
      <p class="lead">
        {report.freed > 0 ? tn("{n} file gone.", "{n} files gone.", report.files, { n: count(report.files) }) : t("There was nothing to free right now.")}{" "}
        {report.skipped > 0 && tn("{n} was in use and stayed.", "{n} were in use and stayed.", report.skipped, { n: count(report.skipped) })}
      </p>
      <div class="actions">
        <button class="btn tonal" onClick={again}>
          <Icon name="refresh" size={20} />
          {t("Review again")}
        </button>
      </div>
    </>
  );
}
