// Preferencias: look (theme, colour), Tokkip, language, sounds, and about.

import { useState } from "preact/hooks";
import { loadTheme, saveTheme, SEEDS, type ThemeMode } from "../core/theme";
import { loadLook, saveLook, type Species } from "../tokkip/tokkip";
import { LANGUAGES, language, N_, setLanguage, t } from "../i18n/i18n";
import { Sound } from "../core/sound";
import { Icon } from "../ui/Icon";

const MODES: readonly { id: ThemeMode; label: string }[] = [
  { id: "system", label: N_("Like Windows") },
  { id: "light", label: N_("Light") },
  { id: "dark", label: N_("Dark") },
];

const SPECIES: readonly { id: Species; label: string }[] = [
  { id: "conejo", label: N_("Bunny") },
  { id: "gato", label: N_("Kitten") },
  { id: "perro", label: N_("Puppy") },
  { id: "robot", label: N_("Robot") },
  { id: "mapache", label: N_("Raccoon") },
];

declare const __APP_VERSION__: string;

export function Settings() {
  const [theme, setTheme] = useState(loadTheme());
  const [look, setLook] = useState(loadLook());
  const [sound, setSound] = useState(Sound.enabled);
  const [lang, setLang] = useState(language());

  const pickTheme = (next: typeof theme) => {
    setTheme(next);
    saveTheme(next);
    Sound.play("tick");
  };

  return (
    <>
      <h1 class="display page-title">{t("Settings")}</h1>

      <section class="card setting">
        <h2>
          <Icon name="palette" /> {t("Look")}
        </h2>
        <div class="segmented" role="radiogroup" aria-label={t("Theme")}>
          {MODES.map((m) => (
            <button key={m.id} role="radio" aria-checked={theme.mode === m.id} onClick={() => pickTheme({ ...theme, mode: m.id })}>
              {theme.mode === m.id && <Icon name="check" size={18} />}
              {t(m.label)}
            </button>
          ))}
        </div>
        <p class="hint">{t("Colour")}</p>
        <div class="swatches" role="radiogroup" aria-label={t("Colour")}>
          {SEEDS.map((s) => (
            <button
              key={s || "tokkip"}
              role="radio"
              aria-checked={theme.seed === s}
              aria-label={s ? s : t("Tokkip's colour")}
              class={`swatch ${s ? "" : "auto"}`}
              style={s ? { background: s } : undefined}
              onClick={() => pickTheme({ ...theme, seed: s })}
            >
              {theme.seed === s && <Icon name="check" size={18} />}
            </button>
          ))}
        </div>
      </section>

      <section class="card setting">
        <h2>
          <Icon name="pets" /> Tokkip
        </h2>
        <div class="segmented" role="radiogroup" aria-label={t("Tokkip is a…")}>
          {SPECIES.map((s) => (
            <button
              key={s.id}
              role="radio"
              aria-checked={look.species === s.id}
              onClick={() => {
                const next = { ...look, species: s.id };
                setLook(next);
                saveLook(next);
                Sound.play("pop");
              }}
            >
              {look.species === s.id && <Icon name="check" size={18} />}
              {t(s.label)}
            </button>
          ))}
        </div>
        <label class="switch-row">
          <span>{t("Tokkip's sounds")}</span>
          <input
            type="checkbox"
            class="switch"
            checked={sound}
            onChange={(e) => {
              const on = (e.target as HTMLInputElement).checked;
              setSound(on);
              Sound.setEnabled(on);
              if (on) Sound.play("pop");
            }}
          />
        </label>
      </section>

      <section class="card setting">
        <h2>
          <Icon name="language" /> {t("Language")}
        </h2>
        <div class="segmented" role="radiogroup" aria-label={t("Language")}>
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              role="radio"
              aria-checked={lang === l.code}
              lang={l.code}
              onClick={() => {
                setLang(l.code);
                setLanguage(l.code);
              }}
            >
              {lang === l.code && <Icon name="check" size={18} />}
              {l.name}
            </button>
          ))}
        </div>
      </section>

      <section class="card setting about">
        <h2>
          <Icon name="info" /> {t("About")}
        </h2>
        <p>
          <b>Tokkip Healthy PC</b> {__APP_VERSION__}
        </p>
        <p>{t("Made by Andy (LoperStack). Everything stays on your PC: no account, no cloud, no telemetry.")}</p>
        <p class="hint">{t("MIT License. Icons: Material Symbols (Apache 2.0). Fonts: Roboto Flex and Fredoka (SIL OFL).")}</p>
      </section>
    </>
  );
}
