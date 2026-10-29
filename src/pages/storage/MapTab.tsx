// The map: what fills a drive, as boxes sized by what they hold. Click a box
// to go inside; the path on top takes you back. Below, what kind of files.

import { useState } from "preact/hooks";
import { analyze, type MapNode } from "../../core/api";
import { bytes, count } from "../../core/format";
import { t, tn } from "../../i18n/i18n";
import { Icon } from "../../ui/Icon";
import { Sound } from "../../core/sound";
import { Busy, KINDS } from "./common";
import { found } from "./state";
import { squarify } from "./treemap";

const TONES = ["primary", "secondary", "tertiary"] as const;

/** The drive's analysis, shared by the map and the big files, and how to (re)measure it. */
export function useAnalysis(root: string) {
  const [busy, setBusy] = useState(false);
  const [, redraw] = useState(0);
  const run = async () => {
    setBusy(true);
    Sound.play("open");
    try {
      found.analysis = await analyze(root);
      found.analyzed = root;
      Sound.play("pop");
    } finally {
      setBusy(false);
      redraw((n) => n + 1);
    }
  };
  return { a: found.analyzed === root ? found.analysis : null, busy, run };
}

/** Before there is an analysis: what it does, and the button. Or the working card. */
export function AnalyzeFirst({ root, busy, run }: { root: string; busy: boolean; run: () => void }) {
  if (busy) return <Busy title={t("Measuring {drive}…", { drive: root.replace(/\\$/, "") })} note={t("A whole drive can take a few minutes.")} />;
  return (
    <section class="card empty-state">
      <Icon name="map" size={40} />
      <h2>{t("See what fills {drive}", { drive: root.replace(/\\$/, "") })}</h2>
      <p>{t("I'll measure every folder and file, and show you the biggest. Nothing is deleted.")}</p>
      <button class="btn filled" onClick={run} disabled={!root}>
        <Icon name="play" size={20} />
        {t("Analyze")}
      </button>
    </section>
  );
}

export function MapTab({ root, goBig }: { root: string; goBig: () => void }) {
  const { a, busy, run } = useAnalysis(root);
  const [trail, setTrail] = useState<MapNode[]>([]);
  if (busy || !a) return <AnalyzeFirst root={root} busy={busy} run={() => { setTrail([]); void run(); }} />;

  const here = trail.length ? trail[trail.length - 1] : a.root;
  const total = a.kinds.reduce((s, k) => s + k.bytes, 0) || 1;

  return (
    <>
      <section class="card">
        <header class="map-head">
          <nav class="crumbs" aria-label={t("Where you are")}>
            <button onClick={() => setTrail([])} aria-current={trail.length === 0 ? "location" : undefined}>
              {a.root.name}
            </button>
            {trail.map((n, i) => (
              <span key={n.path}>
                <Icon name="chevronRight" size={18} />
                <button onClick={() => setTrail(trail.slice(0, i + 1))} aria-current={i === trail.length - 1 ? "location" : undefined}>
                  {n.name}
                </button>
              </span>
            ))}
          </nav>
          <span class="map-total">
            {bytes(here.bytes)} · {tn("{n} file", "{n} files", here.files, { n: count(here.files) })}
          </span>
          <button class="btn text small" onClick={run}>
            <Icon name="refresh" size={18} />
            {t("Measure again")}
          </button>
        </header>
        <Treemap node={here} open={(n) => {
          Sound.play("blip");
          setTrail([...trail, n]);
        }} />
        {a.unreadable > 0 && (
          <p class="hint">{tn("{n} place couldn't be read (it needs administrator rights or is in use).", "{n} places couldn't be read (they need administrator rights or are in use).", a.unreadable, { n: count(a.unreadable) })}</p>
        )}
        {a.cancelled && <p class="hint">{t("You stopped it halfway: these numbers are what was measured until then.")}</p>}
      </section>

      <section class="card">
        <h2 class="section-title">{t("By kind of file")}</h2>
        <div class="kinds-bar" role="img" aria-label={t("By kind of file")}>
          {a.kinds.map((k, i) => (
            <span key={k.kind} class={`kind-${i % 8}`} style={{ flexGrow: k.bytes / total }} title={`${t(KINDS[k.kind].label)} · ${bytes(k.bytes)}`} />
          ))}
        </div>
        <ul class="kinds">
          {a.kinds.map((k, i) => (
            <li key={k.kind}>
              <span class={`kind-dot kind-${i % 8}`}>
                <Icon name={KINDS[k.kind].icon} size={18} />
              </span>
              <span class="kind-name">{t(KINDS[k.kind].label)}</span>
              <span class="kind-size">{bytes(k.bytes)}</span>
            </li>
          ))}
        </ul>
        {a.big.length > 0 && (
          <button class="btn tonal" onClick={goBig}>
            {tn("See the {n} biggest file", "See the {n} biggest files", a.big.length)}
            <Icon name="chevronRight" size={18} />
          </button>
        )}
      </section>
    </>
  );
}

function Treemap({ node, open }: { node: MapNode; open: (n: MapNode) => void }) {
  const kids = node.children.filter((c) => c.bytes > 0);
  if (kids.length === 0) return <p class="hint">{t("Only files here, no folders to show.")}</p>;
  // Laid out on a 1000 × 560 grid, then placed in percentages so it follows the window.
  const rects = squarify(kids.map((k) => k.bytes), { x: 0, y: 0, w: 1000, h: 560 });
  return (
    <div class="treemap">
      {kids.map((k, i) => {
        const r = rects[i];
        if (r.w * r.h < 1) return null;
        const rest = !k.path;
        const canOpen = !rest && k.children.length > 0;
        const small = r.w < 110 || r.h < 56;
        const label = rest ? t("Loose files and small folders") : k.name;
        return (
          <button
            key={k.path || "rest"}
            class={`tile ${rest ? "rest" : TONES[i % TONES.length]} ${small ? "small" : ""}`}
            style={{ left: `${r.x / 10}%`, top: `${(r.y / 560) * 100}%`, width: `${r.w / 10}%`, height: `${(r.h / 560) * 100}%` }}
            title={`${label} · ${bytes(k.bytes)}`}
            disabled={!canOpen}
            onClick={() => canOpen && open(k)}
          >
            {!small && (
              <>
                <span class="tile-name">{label}</span>
                <span class="tile-size">{bytes(k.bytes)}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
