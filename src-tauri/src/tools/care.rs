// Maintenance: registry entries that point at programs no longer on the PC
// (each backed up to a .reg file before it's removed, and restorable), what
// Healthy PC has done (the activity), and scheduled cleans. Following Kudu
// (MIT, Advent Development): its registry cleaner's idea of an orphan and its
// backups before every change; ours looks at fewer places, on purpose.

#![cfg_attr(not(windows), allow(dead_code))]

use serde::{Deserialize, Serialize};
use std::path::Path;

// ── Registry ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Orphan {
    pub id: u64,
    /// "appPath", "uninstall" or "startup".
    pub kind: &'static str,
    pub name: String,
    /// The missing program.
    pub target: String,
    /// "HKCU\..." (a key, or a value's key).
    pub key: String,
}

/// What the app keeps to back up and remove an orphan.
#[derive(Debug, Clone, PartialEq)]
pub struct OrphanKey {
    pub machine: bool,
    /// The key under the hive.
    pub key: String,
    /// A value in it, or None for the whole key.
    pub value: Option<String>,
}

impl OrphanKey {
    pub fn full(&self) -> String {
        format!("{}\\{}", if self.machine { "HKLM" } else { "HKCU" }, self.key)
    }
}

/// The program a command or path names, with %VARIABLES% expanded. None if it can't tell.
pub fn program_of(command: &str, env: &dyn Fn(&str) -> Option<String>) -> Option<String> {
    let raw = command.trim();
    if raw.is_empty() {
        return None;
    }
    let (program, _) = super::software::split_command(raw, false);
    let program = crate::rules::expand(program.trim_matches('"'), env)?;
    // Only full paths can be checked; "rundll32.exe x" and friends are found on PATH.
    let p = Path::new(&program);
    (p.is_absolute() && program.to_lowercase().ends_with(".exe")).then_some(program)
}

/// An orphan points at a program that's gone, on a drive that's here (not an
/// unplugged USB drive or a network one).
pub fn is_orphan(program: &str) -> bool {
    let p = Path::new(program);
    let drive_here = p.components().next().map(|c| Path::new(c.as_os_str()).join("\\").exists() || c.as_os_str() == "/").unwrap_or(false);
    drive_here && !program.starts_with("\\\\") && !p.exists()
}

#[cfg(windows)]
pub fn find_orphans(keep: &mut dyn FnMut(OrphanKey) -> u64) -> Vec<Orphan> {
    use winreg::enums::*;
    use winreg::RegKey;
    let env = crate::rules::system_env;
    let mut out = Vec::new();
    let roots = [(false, HKEY_CURRENT_USER), (true, HKEY_LOCAL_MACHINE)];
    for (machine, hive) in roots {
        let root = RegKey::predef(hive);
        // App Paths: "run" shortcuts to a program.
        let ap = r"Software\Microsoft\Windows\CurrentVersion\App Paths";
        if let Ok(k) = root.open_subkey(ap) {
            for sub in k.enum_keys().flatten() {
                let Ok(s) = k.open_subkey(&sub) else { continue };
                let target: String = s.get_value("").unwrap_or_default();
                if let Some(p) = program_of(&target, &env).filter(|p| is_orphan(p)) {
                    let key = format!(r"{ap}\{sub}");
                    let id = keep(OrphanKey { machine, key: key.clone(), value: None });
                    out.push(Orphan { id, kind: "appPath", name: sub, target: p, key: format!("{}\\{}", if machine { "HKLM" } else { "HKCU" }, key) });
                }
            }
        }
        // Uninstall entries whose uninstaller and folder are both gone.
        for un in [r"Software\Microsoft\Windows\CurrentVersion\Uninstall", r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"] {
            let Ok(k) = root.open_subkey(un) else { continue };
            for sub in k.enum_keys().flatten() {
                let Ok(s) = k.open_subkey(&sub) else { continue };
                let name: String = s.get_value("DisplayName").unwrap_or_default();
                let command: String = s.get_value("UninstallString").unwrap_or_default();
                let location: String = s.get_value("InstallLocation").unwrap_or_default();
                if name.is_empty() || command.to_lowercase().contains("msiexec") {
                    continue;
                }
                let gone_folder = location.trim().is_empty() || !Path::new(location.trim()).exists();
                if let Some(p) = program_of(&command, &env).filter(|p| is_orphan(p) && gone_folder) {
                    let key = format!(r"{un}\{sub}");
                    let id = keep(OrphanKey { machine, key: key.clone(), value: None });
                    out.push(Orphan { id, kind: "uninstall", name, target: p, key: format!("{}\\{}", if machine { "HKLM" } else { "HKCU" }, key) });
                }
            }
        }
        // Startup entries for programs that are gone.
        let run = r"Software\Microsoft\Windows\CurrentVersion\Run";
        if let Ok(k) = root.open_subkey(run) {
            for (name, _) in k.enum_values().flatten() {
                let command: String = k.get_value(&name).unwrap_or_default();
                if let Some(p) = program_of(&command, &env).filter(|p| is_orphan(p)) {
                    let id = keep(OrphanKey { machine, key: run.to_string(), value: Some(name.clone()) });
                    out.push(Orphan { id, kind: "startup", name, target: p, key: format!("{}\\{}", if machine { "HKLM" } else { "HKCU" }, run) });
                }
            }
        }
    }
    out
}

#[cfg(not(windows))]
pub fn find_orphans(_keep: &mut dyn FnMut(OrphanKey) -> u64) -> Vec<Orphan> {
    Vec::new()
}

/// Removes one orphan after saving it to `backup` (a .reg file `reg import` can restore).
#[cfg(windows)]
pub fn remove_orphan(o: &OrphanKey, backup: &Path) -> Result<(), String> {
    use winreg::enums::*;
    let ok = crate::platform::run_hidden("reg.exe", &["export", &o.full(), &backup.display().to_string(), "/y"]).is_some_and(|(ok, _)| ok);
    if !ok {
        return Err("backup".into());
    }
    let root = winreg::RegKey::predef(if o.machine { HKEY_LOCAL_MACHINE } else { HKEY_CURRENT_USER });
    match &o.value {
        Some(v) => root.open_subkey_with_flags(&o.key, KEY_ALL_ACCESS).and_then(|k| k.delete_value(v)).map_err(|e| e.to_string()),
        None => root.delete_subkey_all(&o.key).map_err(|e| e.to_string()),
    }
}

#[cfg(not(windows))]
pub fn remove_orphan(_o: &OrphanKey, _backup: &Path) -> Result<(), String> {
    Err("windows".into())
}

/// A backup made before removing registry entries.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Backup {
    pub at: u64,
    pub file: String,
    pub entries: u32,
}

// ── Activity ──────────────────────────────────────────────────────────────

/// One thing Healthy PC did. The page writes it in your language from `kind`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Done {
    pub at: u64,
    /// "clean", "trash", "shred", "empty", "uninstall", "apps", "service",
    /// "registry", "privacy", "traces", "firewall", "scan", "repair", "restorePoint", "routine".
    pub kind: String,
    pub detail: String,
    pub bytes: u64,
    pub count: u64,
}

pub const ACTIVITY_FILE: &str = "actividad.json";
pub const ACTIVITY_MAX: usize = 300;

pub fn log(data: &Path, now: u64, kind: &str, detail: &str, bytes: u64, count: u64) {
    let mut list: Vec<Done> = crate::store::load_json(data, ACTIVITY_FILE);
    list.push(Done { at: now, kind: kind.into(), detail: detail.into(), bytes, count });
    if list.len() > ACTIVITY_MAX {
        list.drain(..list.len() - ACTIVITY_MAX);
    }
    crate::store::save_json(data, ACTIVITY_FILE, &list);
}

// ── Scheduled cleans ──────────────────────────────────────────────────────

pub const TASK: &str = r"Tokkip Healthy PC\Limpieza";
pub const DAYS: [&str; 7] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/// The routine, as the page sees it.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Routine {
    pub on: bool,
    /// 0 = Monday … 6 = Sunday.
    pub day: u8,
    /// 0–23.
    pub hour: u8,
}

/// schtasks /Create arguments for the routine (it runs this exe with --limpiar).
pub fn task_args(r: &Routine, exe: &str) -> Vec<String> {
    vec![
        "/Create".into(),
        "/SC".into(),
        "WEEKLY".into(),
        "/D".into(),
        DAYS[(r.day as usize).min(6)].into(),
        "/ST".into(),
        format!("{:02}:00", r.hour.min(23)),
        "/TN".into(),
        TASK.into(),
        "/TR".into(),
        format!("\"{exe}\" --limpiar"),
        "/F".into(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_what_program_an_entry_names() {
        let env = |n: &str| (n == "ProgramFiles").then(|| "/opt".to_string());
        assert_eq!(program_of(r#""%ProgramFiles%/App/app.exe" --x"#, &env).as_deref(), Some("/opt/App/app.exe"));
        assert_eq!(program_of("rundll32.exe shell32.dll", &env), None, "not a full path");
        assert_eq!(program_of("", &env), None);
        assert_eq!(program_of("%NOPE%/x.exe", &env), None);
    }

    #[test]
    fn an_orphan_is_a_missing_program_on_a_present_drive() {
        let dir = crate::fsx::scratch();
        let here = dir.path().join("here.exe");
        std::fs::write(&here, "x").unwrap();
        assert!(!is_orphan(&here.display().to_string()));
        assert!(is_orphan(&dir.path().join("gone.exe").display().to_string()));
        assert!(!is_orphan(r"\\server\share\x.exe"));
    }

    #[test]
    fn keeps_a_bounded_activity() {
        let dir = crate::fsx::scratch();
        for i in 0..(ACTIVITY_MAX + 5) {
            log(dir.path(), i as u64, "clean", "", 10, 1);
        }
        let list: Vec<Done> = crate::store::load_json(dir.path(), ACTIVITY_FILE);
        assert_eq!(list.len(), ACTIVITY_MAX);
        assert_eq!(list.last().unwrap().at, (ACTIVITY_MAX + 4) as u64);
    }

    #[test]
    fn builds_the_task() {
        let a = task_args(&Routine { on: true, day: 6, hour: 9 }, r"C:\App\h.exe");
        assert!(a.windows(2).any(|w| w[0] == "/D" && w[1] == "SUN"));
        assert!(a.contains(&"09:00".to_string()));
        assert!(a.contains(&r#""C:\App\h.exe" --limpiar"#.to_string()));
    }
}
