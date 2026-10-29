import { render } from "preact";
import { App } from "./App";
import { watchTheme } from "./core/theme";
import { language } from "./i18n/i18n";
import { Sound } from "./core/sound";
import "./style.css";

document.documentElement.lang = language();
watchTheme();
void Sound.preload();
render(<App />, document.getElementById("app")!);
