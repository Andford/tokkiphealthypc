// Copies what Tokkip Healthy PC shares with Tokkip PC from a checkout of
// Andford/tokkip next to this one (../tokkip, or the path given): Tokkip's
// motion engine and figure, the Material 3 theme and tokens, and his sounds.
// The copies are committed, so this repo builds on its own; run this again
// when Tokkip PC changes them. Run: node scripts/sync-tokkip.mjs [../tokkip]

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tokkip = resolve(process.argv[2] ?? join(here, "..", "tokkip"));
const pc = join(tokkip, "windows", "src");

const FILES = [
  ["tokkip/motion.ts", "src/tokkip/motion.ts"],
  ["tokkip/figure.ts", "src/tokkip/figure.ts"],
  ["tokkip/ropa.ts", "src/tokkip/ropa.ts"],
  ["tokkip/tokkip.ts", "src/tokkip/tokkip.ts"],
  ["tokkip/wardrobe.ts", "src/tokkip/wardrobe.ts"],
  ["tokkip/shapes.ts", "src/tokkip/shapes.ts"],
  ["core/layout.ts", "src/core/layout.ts"],
  ["core/fonts.ts", "src/core/fonts.ts"],
  ["core/theme.ts", "src/core/theme.ts"],
  ["core/tokens.css", "src/core/tokens.css"],
];
const SOUNDS = ["finish", "pop", "blip", "greet", "love", "slap", "annoyed", "dizzy", "proud", "level_up", "error", "open", "close", "tick"];

const NOTE = "// Copied from Andford/tokkip (windows/src) by scripts/sync-tokkip.mjs — change it there.\n";
for (const [from, to] of FILES) {
  const dest = join(here, to);
  mkdirSync(dirname(dest), { recursive: true });
  const text = readFileSync(join(pc, from), "utf8");
  writeFileSync(dest, to.endsWith(".css") ? text.replace(/^/, "/* Copied from Andford/tokkip (windows/src) by scripts/sync-tokkip.mjs — change it there. */\n") : NOTE + text);
}
mkdirSync(join(here, "public", "sounds"), { recursive: true });
for (const s of SOUNDS) {
  copyFileSync(join(tokkip, "android", "shared", "src", "main", "res", "raw", `${s}.wav`), join(here, "public", "sounds", `${s}.wav`));
}
console.log(`copied ${FILES.length} files and ${SOUNDS.length} sounds from ${tokkip}`);
