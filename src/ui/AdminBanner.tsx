import { relaunchAdmin } from "../core/api";
import { t } from "../i18n/i18n";
import { Icon } from "./Icon";

/** Asks to open the app again as administrator. */
export function AdminBanner({ text }: { text?: string }) {
  return (
    <div class="banner">
      <Icon name="admin" />
      <p>{text ?? t("This one needs administrator rights.")}</p>
      <button class="btn tonal" onClick={() => void relaunchAdmin()}>
        {t("Open as administrator")}
      </button>
    </div>
  );
}

export const needsAdmin = (e: unknown) => String(e).includes("admin");
