// Inicio: how your PC feels, why, and what to do about it.

import { useEffect, useState } from "preact/hooks";
import { health, type Health, type Reason } from "../core/api";
import { ago, bytes } from "../core/format";
import { moodState, moodTitle } from "../core/mood";
import { t } from "../i18n/i18n";
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
    </>
  );
}

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
