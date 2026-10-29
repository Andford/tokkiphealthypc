// The window: the sections down the side, the page on the right.

import { useEffect, useState } from "preact/hooks";
import { Icon } from "./ui/Icon";
import type { IconName } from "./ui/icons";
import { N_, onLanguageChange, t } from "./i18n/i18n";
import { Home } from "./pages/Home";
import { Clean } from "./pages/Clean";
import { Settings } from "./pages/Settings";
import { Storage } from "./pages/storage/Storage";
import { Software } from "./pages/Software";
import { Performance } from "./pages/Performance";
import { Protection } from "./pages/Protection";
import { Care } from "./pages/Care";
import { Sound } from "./core/sound";

export type Page = "home" | "clean" | "storage" | "software" | "speed" | "protect" | "care" | "settings";

const NAV: readonly { id: Page; icon: IconName; label: string; soon?: boolean }[] = [
  { id: "home", icon: "home", label: N_("Home") },
  { id: "clean", icon: "clean", label: N_("Clean") },
  { id: "storage", icon: "storage", label: N_("Storage") },
  { id: "software", icon: "software", label: N_("Software") },
  { id: "speed", icon: "speed", label: N_("Performance") },
  { id: "protect", icon: "shield", label: N_("Protection") },
  { id: "care", icon: "build", label: N_("Maintenance") },
];

export function App() {
  const [page, setPage] = useState<Page>("home");
  const [, relabel] = useState(0);
  useEffect(() => onLanguageChange(() => relabel((n) => n + 1)), []);

  const go = (p: Page) => {
    if (p !== page) Sound.play("blip");
    setPage(p);
  };

  const item = (n: { id: Page; icon: IconName; label: string; soon?: boolean }) => (
    <button class="nav-item" aria-current={page === n.id ? "page" : undefined} onClick={() => go(n.id)}>
      <span class="nav-icon">
        <Icon name={n.icon} />
      </span>
      <span class="nav-label">{t(n.label)}</span>
      {n.soon && <span class="nav-soon">{t("Soon")}</span>}
    </button>
  );

  return (
    <div class="shell">
      <nav class="rail" aria-label={t("Sections")}>
        <div class="brand">
          <span class="brand-mark">
            <Icon name="heart" size={20} />
          </span>
          <span class="brand-name">
            Healthy <b>PC</b>
          </span>
        </div>
        {NAV.map(item)}
        <span class="rail-gap" />
        {item({ id: "settings", icon: "settings", label: N_("Settings") })}
      </nav>
      <main class="page" key={page}>
        {page === "home" && <Home go={go} />}
        {page === "clean" && <Clean />}
        {page === "storage" && <Storage />}
        {page === "software" && <Software />}
        {page === "speed" && <Performance />}
        {page === "settings" && <Settings />}
        {page === "protect" && <Protection />}
        {page === "care" && <Care />}
      </main>
    </div>
  );
}
