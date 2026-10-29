// How the PC feels, as Tokkip shows it and says it. The moods are the ones
// Tokkip PC reads from healthy-pc.json (src-tauri/src/notice.rs).

import type { BotStateName } from "./layout";
import type { Mood } from "./api";
import { N_, t } from "../i18n/i18n";

export function moodState(m: Mood): BotStateName {
  return m === "tired" ? "ratelimit" : m === "dizzy" ? "dizzy" : "idle";
}

const TITLES: Record<Mood, string> = {
  happy: N_("Your PC feels great"),
  calm: N_("Your PC is doing fine"),
  tired: N_("Your PC is getting tired"),
  dizzy: N_("Your PC feels dizzy"),
};

export function moodTitle(m: Mood): string {
  return t(TITLES[m]);
}
