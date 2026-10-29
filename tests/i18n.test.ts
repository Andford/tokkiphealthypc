import { describe, expect, it } from "vitest";
import es from "../src/i18n/es.json";
import { resolveLanguage } from "../src/i18n/i18n";
// @ts-expect-error plain ESM script
import { keysIn } from "../scripts/keys.mjs";

describe("i18n", () => {
  it("has Spanish for every text the page shows", () => {
    const keys = [...(keysIn(new URL("../src", import.meta.url).pathname) as Set<string>)];
    const missing = keys.filter((k) => !(k in es));
    expect(missing).toEqual([]);
  });

  it("keeps the same {variables} in Spanish", () => {
    for (const [k, v] of Object.entries(es as Record<string, string>)) {
      const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(vars(v), k).toEqual(vars(k));
    }
  });

  it("speaks Spanish unless English is picked or the system's", () => {
    expect(resolveLanguage(null, ["fr-FR"])).toBe("es");
    expect(resolveLanguage(null, ["en-US", "es-MX"])).toBe("en");
    expect(resolveLanguage("es", ["en-US"])).toBe("es");
    expect(resolveLanguage("de", ["es-MX"])).toBe("es");
  });
});
