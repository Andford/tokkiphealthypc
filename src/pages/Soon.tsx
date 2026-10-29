// The sections still on their way (docs/PLAN.md): what each will do.

import { N_, t } from "../i18n/i18n";
import { Tokkip } from "../ui/Tokkip";
import type { Page } from "../App";

const COMING: Partial<Record<Page, { title: string; items: string[] }>> = {
  software: {
    title: N_("Software"),
    items: [N_("Startup programs"), N_("Uninstaller that finds leftovers"), N_("Preinstalled apps you don't use"), N_("Program and driver updates")],
  },
  speed: {
    title: N_("Performance"),
    items: [N_("Live monitor: CPU, memory, disk and network"), N_("Windows services, explained"), N_("Game mode"), N_("Network fixes")],
  },
  protect: {
    title: N_("Protection"),
    items: [N_("Malware scan with Windows Defender"), N_("Privacy: traces and Windows telemetry"), N_("Firewall review"), N_("Recommended security settings")],
  },
  care: {
    title: N_("Maintenance"),
    items: [N_("Registry cleanup with backup"), N_("Windows repair (SFC and DISM)"), N_("Restore points and activity"), N_("Scheduled cleans")],
  },
};

export function Soon({ page }: { page: Page }) {
  const c = COMING[page];
  if (!c) return null;
  return (
    <section class="hero card soon">
      <Tokkip size={110} state="thinking" label="Tokkip" />
      <div class="hero-text">
        <p class="eyebrow">{t("On its way")}</p>
        <h1 class="display">{t(c.title)}</h1>
        <p class="lead">{t("I'm still learning this one. Here's what it will do:")}</p>
        <ul class="soon-list">
          {c.items.map((i) => (
            <li key={i}>{t(i)}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
