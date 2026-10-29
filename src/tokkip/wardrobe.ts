// Copied from Andford/tokkip (windows/src) by scripts/sync-tokkip.mjs — change it there.
// What Tokkip wears: the wardrobe's list, the calendar that dresses him for the
// season ("auto"), and the stored choice (`tokkipOutfit` in the preferences).
// The clothes themselves are drawn in ./ropa.ts.

import { N_, labels, t } from "../i18n/i18n";

/** Every choice, in the wardrobe's order: "auto" (the season's) and "none" first. */
export const OUTFIT_SELECTIONS = [
  "auto", "none",
  "partyHat", "crown", "beanie", "hearts", "flowerCrown", "sunglasses", "strawHat", "tricolor",
  "witchHat", "marigolds", "scarf", "antlers", "santaHat",
  "roundGlasses", "bow", "headphones",
] as const;

/** What can be stored. Keep the values: they are saved in the preferences. */
export type OutfitSelection = (typeof OUTFIT_SELECTIONS)[number];

/** What Tokkip actually wears: a choice with "auto" resolved. */
export type Outfit = Exclude<OutfitSelection, "auto">;

export const DEFAULT_OUTFIT: OutfitSelection = "auto";

// ── Names ─────────────────────────────────────────────────────────────────────

/** The English names, the keys of their translations (src/i18n). */
export const OUTFIT_KEYS: Record<OutfitSelection, string> = {
  auto: N_("Auto (seasons)"),
  none: N_("None"),
  partyHat: N_("Party hat"),
  crown: N_("Crown"),
  beanie: N_("Beanie"),
  hearts: N_("Hearts headband"),
  flowerCrown: N_("Flower crown"),
  sunglasses: N_("Sunglasses"),
  strawHat: N_("Straw hat"),
  tricolor: N_("Tricolour rosette"),
  witchHat: N_("Witch hat"),
  marigolds: N_("Marigold crown"),
  scarf: N_("Scarf"),
  antlers: N_("Antlers"),
  santaHat: N_("Santa hat"),
  roundGlasses: N_("Round glasses"),
  bow: N_("Bow"),
  headphones: N_("Headphones"),
};

/** In the current language: every read goes through `t()`. */
export const OUTFIT_LABELS: Record<OutfitSelection, string> = labels(OUTFIT_KEYS);

export const WARDROBE_STRINGS = {
  get title() { return t("Wardrobe"); },
  get autoBadge() { return t("AUTO"); },
  autoNow: (current: string) => t("Auto · {outfit}", { outfit: current }),
  autoHover: (current: string) => t("Auto · follows the seasons (now: {outfit})", { outfit: current }),
};

// ── The stored choice ─────────────────────────────────────────────────────────

const SELECTION_SET: ReadonlySet<string> = new Set(OUTFIT_SELECTIONS);

/**
 * A stored preference → a choice. Anything unknown (an outfit that no longer
 * exists, such as the first version's "pumpkin" or "bunnyEars", or garbage)
 * means "auto".
 */
export function parseOutfit(raw: unknown): OutfitSelection {
  return typeof raw === "string" && SELECTION_SET.has(raw) ? (raw as OutfitSelection) : DEFAULT_OUTFIT;
}

// ── The seasons ───────────────────────────────────────────────────────────────

/** [month 1–12, first day, last day, outfit], checked in order. */
const SEASONS: readonly (readonly [number, number, number, Outfit])[] = [
  [1, 1, 2, "partyHat"], // Año Nuevo
  [1, 3, 6, "crown"], // Día de Reyes
  [1, 7, 31, "beanie"], // the cold
  [2, 1, 9, "beanie"],
  [2, 10, 14, "hearts"], // San Valentín
  [3, 20, 31, "flowerCrown"], // spring
  [4, 1, 30, "flowerCrown"],
  [6, 21, 30, "sunglasses"], // summer
  [7, 1, 31, "sunglasses"],
  [8, 1, 31, "sunglasses"],
  [9, 1, 16, "tricolor"], // fiestas patrias
  [10, 15, 31, "witchHat"],
  [11, 1, 2, "marigolds"], // Día de Muertos
  [11, 3, 30, "scarf"],
  [12, 1, 15, "antlers"],
  [12, 16, 30, "santaHat"],
  [12, 31, 31, "partyHat"],
];

/** The season's outfit for `date`, in the user's own calendar. */
export function seasonalOutfit(date: Date): Outfit {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  for (const [m, from, to, outfit] of SEASONS) {
    if (m === month && day >= from && day <= to) return outfit;
  }
  return "none";
}

/** "auto" → the season's outfit; anything else is worn as chosen. */
export function resolveOutfit(selection: OutfitSelection, date: Date): Outfit {
  return selection === "auto" ? seasonalOutfit(date) : selection;
}

/**
 * The grey text at the right of the wardrobe's title: the outfit under the
 * pointer, otherwise the one chosen.
 */
export function wardrobeHeader(hovered: OutfitSelection | null, selection: OutfitSelection, date: Date): string {
  const season = OUTFIT_LABELS[seasonalOutfit(date)];
  if (hovered) return hovered === "auto" ? WARDROBE_STRINGS.autoHover(season) : OUTFIT_LABELS[hovered];
  return selection === "auto" ? WARDROBE_STRINGS.autoNow(season) : OUTFIT_LABELS[selection];
}

/** resolveOutfit, worked out once a day: it is asked every frame. */
export class SeasonCache {
  private day = "";
  private value: Outfit = "none";

  get(selection: OutfitSelection, date = new Date()): Outfit {
    if (selection !== "auto") return selection;
    const day = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    if (day !== this.day) {
      this.day = day;
      this.value = seasonalOutfit(date);
    }
    return this.value;
  }
}
