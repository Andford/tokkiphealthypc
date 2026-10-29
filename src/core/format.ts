// Sizes and times the way people say them.

import { language, t } from "../i18n/i18n";

/** 1.4 GB, 812 MB, 12 KB. */
export function bytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = Math.max(0, n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i >= 3 && v < 100 ? 1 : 0;
  return `${v.toLocaleString(language() === "es" ? "es-MX" : "en-US", { maximumFractionDigits: digits })} ${units[i]}`;
}

/** "today", "yesterday", "3 days ago", or "never" for 0. */
export function ago(ms: number, now = Date.now()): string {
  if (!ms) return t("never");
  const days = Math.floor((now - ms) / 86_400_000);
  if (days <= 0) return t("today");
  if (days === 1) return t("yesterday");
  return t("{n} days ago", { n: days });
}

export function count(n: number): string {
  return n.toLocaleString(language() === "es" ? "es-MX" : "en-US");
}
