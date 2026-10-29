// Lists every text the page translates: t("…"), tn("…", "…"), N_("…").
// Used by tests/i18n.test.ts to make sure es.json has them all.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export function keysIn(dir) {
  const out = new Set();
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      for (const k of keysIn(p)) out.add(k);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    const src = readFileSync(p, "utf8");
    for (const m of src.matchAll(/\b(?:t|N_)\(\s*"((?:[^"\\]|\\.)*)"/g)) out.add(JSON.parse(`"${m[1]}"`));
    for (const m of src.matchAll(/\btn\(\s*"((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)"/g)) {
      out.add(JSON.parse(`"${m[1]}"`));
      out.add(JSON.parse(`"${m[2]}"`));
    }
  }
  return out;
}

if (process.argv[1]?.endsWith("keys.mjs")) {
  for (const k of [...keysIn(new URL("../src", import.meta.url).pathname)].sort()) console.log(k);
}
