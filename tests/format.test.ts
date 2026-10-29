import { describe, expect, it } from "vitest";
import { ago, bytes } from "../src/core/format";
import { moodState } from "../src/core/mood";
import { setLanguage } from "../src/i18n/i18n";

setLanguage("es");

describe("format", () => {
  it("says sizes the short way", () => {
    expect(bytes(0)).toBe("0 B");
    expect(bytes(812 * 1024 ** 2)).toBe("812 MB");
    expect(bytes(1.45 * 1024 ** 3)).toMatch(/^1[.,]4 GB$|^1[.,]5 GB$/);
    expect(bytes(476 * 1024 ** 3)).toBe("476 GB");
  });

  it("says when", () => {
    const now = Date.UTC(2026, 9, 29, 12);
    expect(ago(0, now)).toBe("nunca");
    expect(ago(now - 3_600_000, now)).toBe("hoy");
    expect(ago(now - 86_400_000, now)).toBe("ayer");
    expect(ago(now - 5 * 86_400_000, now)).toBe("hace 5 días");
  });

  it("gives each mood a Tokkip state", () => {
    expect(moodState("happy")).toBe("idle");
    expect(moodState("tired")).toBe("ratelimit");
    expect(moodState("dizzy")).toBe("dizzy");
  });
});
