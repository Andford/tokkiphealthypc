// Game mode: what to pause or close while you play, chosen by you, and
// noticing on its own when a game starts. Following Kudu (MIT, Advent
// Development): its list of optimizations, its lists of browsers, chat apps
// and updaters to close, the games it recognizes, and how it silences
// notifications and Game Bar. Everything it changes is written down first
// (modojuego.json) and put back when game mode ends, even after a crash.

use serde::{Deserialize, Serialize};

/// Each thing game mode can do. The page lists them in this order.
pub const OPTIONS: &[&str] = &[
    "power", "awake", "notifications", "gamebar", "search", "update", "sysmain", "spooler", "telemetry", "browsers", "chat", "updaters",
];

/// Done when you first turn game mode on: what most gamers want, nothing that closes your things.
pub const DEFAULT_OPTIONS: &[&str] = &["power", "awake", "notifications", "gamebar", "search", "update", "updaters"];

/// Options that need the app open as administrator.
pub fn needs_admin(option: &str) -> bool {
    matches!(option, "search" | "update" | "sysmain" | "spooler" | "telemetry")
}

/// The service an option pauses.
pub fn service_of(option: &str) -> Option<&'static str> {
    match option {
        "search" => Some("WSearch"),
        "update" => Some("wuauserv"),
        "sysmain" => Some("SysMain"),
        "spooler" => Some("Spooler"),
        "telemetry" => Some("DiagTrack"),
        _ => None,
    }
}

pub const BROWSERS: &[&str] = &["chrome.exe", "firefox.exe", "msedge.exe", "opera.exe", "brave.exe", "vivaldi.exe"];
pub const CHAT: &[&str] = &["Discord.exe", "Slack.exe", "Teams.exe", "ms-teams.exe", "Telegram.exe", "WhatsApp.exe", "Signal.exe", "Skype.exe"];
pub const UPDATERS: &[&str] = &[
    "GoogleUpdate.exe", "MicrosoftEdgeUpdate.exe", "AdobeARM.exe", "jusched.exe", "BraveUpdate.exe", "OperaUpdate.exe", "CCUpdate.exe",
    "Dropbox.Update.exe", "ZoomUpdateAgent.exe",
];

/// The programs an option closes.
pub fn closes(option: &str) -> &'static [&'static str] {
    match option {
        "browsers" => BROWSERS,
        "chat" => CHAT,
        "updaters" => UPDATERS,
        _ => &[],
    }
}

/// Games recognized by name (from Kudu's list).
pub const KNOWN_GAMES: &[&str] = &[
    "cs2.exe", "csgo.exe", "dota2.exe", "tf_win64.exe", "left4dead2.exe", "portal2.exe", "hl2.exe", "rust.exe", "deadlock.exe",
    "valorant-win64-shipping.exe", "league of legends.exe", "overwatch.exe", "wow.exe", "wowclassic.exe", "diablo iv.exe",
    "hearthstone.exe", "starcraft ii.exe", "fortniteclient-win64-shipping.exe", "rocketleague.exe", "r5apex.exe", "apex_legends.exe",
    "bf2042.exe", "rainbowsix.exe", "acodyssey.exe", "acvalhalla.exe", "acmirage.exe", "gta5.exe", "gtav.exe", "rdr2.exe",
    "eldenring.exe", "darksoulsiii.exe", "sekiro.exe", "armoredcore6.exe", "cyberpunk2077.exe", "witcher3.exe", "bg3.exe",
    "bg3_dx11.exe", "destiny2.exe", "warframe.x64.exe", "pathofexile_x64.exe", "pathofexile_x64steam.exe", "escapefromtarkov.exe",
    "tslgame.exe", "cod.exe", "palworld-win64-shipping.exe", "helldivers2.exe", "hogwartslegacy.exe", "starfield.exe",
    "factorygame-win64-shipping.exe", "lethal company.exe", "hades2.exe", "minecraft.windows.exe", "javaw.exe",
];

/// Folders where game launchers install games.
pub const GAME_FOLDERS: &[&str] = &[
    "\\steamapps\\common\\", "\\epic games\\", "\\xboxgames\\", "\\riot games\\", "\\gog galaxy\\games\\", "\\ea games\\",
    "\\ubisoft game launcher\\games\\", "\\battle.net\\", "\\rockstar games\\", "\\windowsapps\\microsoft.minecraft",
];

/// Launchers and helpers that live in game folders but aren't games.
const NOT_GAMES: &[&str] = &[
    "steam.exe", "steamwebhelper.exe", "steamservice.exe", "epicgameslauncher.exe", "epicwebhelper.exe", "riotclientservices.exe",
    "riotclientux.exe", "battle.net.exe", "agent.exe", "galaxyclient.exe", "eadesktop.exe", "upc.exe", "launcher.exe",
    "crashreportclient.exe", "unitycrashhandler64.exe", "easyanticheat.exe", "beservice.exe", "vc_redist.x64.exe", "dxsetup.exe",
];

/// Whether a running program is a game: known by name, one you added, or run from a game library folder.
pub fn is_game(name: &str, exe_path: &str, custom: &[String]) -> bool {
    let n = name.to_lowercase();
    if NOT_GAMES.contains(&n.as_str()) {
        return false;
    }
    if (KNOWN_GAMES.contains(&n.as_str()) && n != "javaw.exe") || custom.iter().any(|c| c.eq_ignore_ascii_case(name)) {
        return true;
    }
    let p = exe_path.to_lowercase().replace('/', "\\");
    GAME_FOLDERS.iter().any(|f| p.contains(f))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GameConfig {
    pub options: Vec<String>,
    /// Turn on by itself when a game starts, and off when it closes.
    pub auto: bool,
    /// Your own games (program names) for the automatic mode.
    pub games: Vec<String>,
}

impl Default for GameConfig {
    fn default() -> Self {
        GameConfig { options: DEFAULT_OPTIONS.iter().map(|s| s.to_string()).collect(), auto: false, games: Vec::new() }
    }
}

/// What game mode changed, to put back.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GameSnapshot {
    pub on: bool,
    pub since: u64,
    /// The game that turned it on by itself, if it did.
    pub game: String,
    /// The power plan before (GUID).
    pub scheme: String,
    /// Services it stopped, to start again.
    pub stopped: Vec<String>,
    /// Programs it closed (they aren't reopened: you open them when you want).
    pub closed: Vec<String>,
    /// Notifications' setting before (None: wasn't set).
    pub toasts: Option<u32>,
    /// Game Bar capture settings before: (key, value, data or None).
    pub gamebar: Vec<(String, String, Option<u32>)>,
    pub silenced: bool,
    /// Options asked for but not done (needed administrator, or failed).
    pub skipped: Vec<String>,
}

/// The GUID in `powercfg /getactivescheme`'s line, in any language.
pub fn scheme_guid(out: &str) -> Option<String> {
    out.split(|c: char| c.is_whitespace() || c == '(' || c == ')')
        .find(|w| w.len() == 36 && w.chars().filter(|c| *c == '-').count() == 4 && w.chars().all(|c| c.is_ascii_hexdigit() || c == '-'))
        .map(|s| s.to_lowercase())
}

pub const TOASTS_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\PushNotifications";
pub const TOASTS_VALUE: &str = "ToastEnabled";
/// Game Bar's background capture, which costs frames.
pub const GAMEBAR: &[(&str, &str)] = &[(r"Software\Microsoft\Windows\CurrentVersion\GameDVR", "AppCaptureEnabled"), (r"System\GameConfigStore", "GameDVR_Enabled")];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_games() {
        assert!(is_game("cs2.exe", r"C:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe", &[]));
        assert!(is_game("SomeIndie.exe", r"D:\SteamLibrary\steamapps\common\Some Indie\SomeIndie.exe", &[]));
        assert!(is_game("Game.exe", r"C:\XboxGames\Forza\Content\Game.exe", &[]));
        assert!(!is_game("steamwebhelper.exe", r"C:\Program Files (x86)\Steam\steamapps\common\x\steamwebhelper.exe", &[]));
        assert!(!is_game("chrome.exe", r"C:\Program Files\Google\Chrome\chrome.exe", &[]));
        assert!(is_game("MiJuego.exe", r"C:\Juegos\MiJuego.exe", &["mijuego.exe".to_string()]));
        assert!(!is_game("javaw.exe", r"C:\Program Files\Java\bin\javaw.exe", &[]), "Java alone isn't a game");
    }

    #[test]
    fn options_are_consistent() {
        for o in DEFAULT_OPTIONS {
            assert!(OPTIONS.contains(o));
        }
        for o in OPTIONS {
            assert_eq!(needs_admin(o), service_of(o).is_some(), "{o}");
        }
        assert_eq!(closes("browsers").len(), BROWSERS.len());
        assert!(GameConfig::default().options.contains(&"power".to_string()));
    }

    #[test]
    fn reads_the_power_plan() {
        assert_eq!(scheme_guid("GUID del plan de energía: 381b4222-f694-41f0-9685-ff5bb260df2e  (Equilibrado)").as_deref(), Some("381b4222-f694-41f0-9685-ff5bb260df2e"));
        assert_eq!(scheme_guid("nothing"), None);
    }
}
