import { describe, expect, it } from "vitest";
import es from "../src/i18n/es.json";
import { resolveLanguage } from "../src/i18n/i18n";
import { fileURLToPath } from "node:url";
// @ts-expect-error plain ESM script
import { keysIn } from "../scripts/keys.mjs";

describe("i18n", () => {
  it("has Spanish for every text the page shows", () => {
    const keys = [...(keysIn(fileURLToPath(new URL("../src", import.meta.url))) as Set<string>)];
    const missing = keys.filter((k) => !(k in es));
    expect(missing).toEqual([]);
  });

  it("uses only the English text's {variables} in Spanish (a singular may leave {n} out)", () => {
    const vars = (s: string) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
    for (const [k, v] of Object.entries(es as Record<string, string>)) {
      const en = vars(k);
      const extra = [...vars(v)].filter((x) => !en.has(x));
      expect(extra, k).toEqual([]);
      const missing = [...en].filter((x) => !vars(v).has(x) && x !== "n");
      expect(missing, k).toEqual([]);
    }
  });

  it("speaks Spanish unless English is picked or the system's", () => {
    expect(resolveLanguage(null, ["fr-FR"])).toBe("es");
    expect(resolveLanguage(null, ["en-US", "es-MX"])).toBe("en");
    expect(resolveLanguage("es", ["en-US"])).toBe("es");
    expect(resolveLanguage("de", ["es-MX"])).toBe("es");
  });
});
