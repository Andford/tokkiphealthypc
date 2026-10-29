// The rest of Software: the apps that came with Windows or the PC, program
// updates through winget, and the folders a program leaves behind when it's
// uninstalled. Following Kudu (MIT, Advent Development): its list of
// preinstalled apps and of folder names never to offer (rules/), how it reads
// winget's table, and which updates it skips. Unlike Kudu, a removed app is
// only removed for you (not from Windows' image), so the Microsoft Store can
// bring it back, and leftovers are looked for right after an uninstall, for
// that program only, and go to the Recycle Bin.

use crate::fsx;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

// ── Preinstalled apps ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownApp {
    pub name: String,
    pub package: String,
    pub publisher: String,
    pub group: String,
    pub about_en: String,
}

#[derive(Deserialize)]
struct KnownList {
    apps: Vec<KnownApp>,
}

pub fn known_apps() -> Vec<KnownApp> {
    serde_json::from_str::<KnownList>(include_str!("../../../rules/preinstalled.json")).map(|l| l.apps).unwrap_or_default()
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Preinstalled {
    /// The installed package's name ("Microsoft.BingNews").
    pub package: String,
    pub name: String,
    pub publisher: String,
    /// "microsoft", "oem", "communication", "gaming", "media" or "utility".
    pub group: String,
    pub about_en: String,
    pub bytes: u64,
}

/// An installed package is a known one, or the known one with a publisher's suffix.
pub fn matches_known(installed: &str, known: &str) -> bool {
    installed == known || installed.strip_prefix(known).is_some_and(|rest| rest.starts_with('.'))
}

/// Only plain package names ever reach PowerShell.
pub fn safe_package(name: &str) -> bool {
    !name.is_empty() && name.len() < 128 && name.chars().next().is_some_and(|c| c.is_ascii_alphanumeric()) && name.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
}

/// Which installed packages (name, folder) are known preinstalled apps.
pub fn pick_preinstalled(installed: &[(String, String)], known: &[KnownApp]) -> Vec<Preinstalled> {
    let mut out = Vec::new();
    for k in known {
        if let Some((name, folder)) = installed.iter().find(|(n, _)| matches_known(n, &k.package)) {
            if out.iter().any(|p: &Preinstalled| &p.package == name) {
                continue;
            }
            out.push(Preinstalled {
                package: name.clone(),
                name: k.name.clone(),
                publisher: k.publisher.clone(),
                group: k.group.clone(),
                about_en: k.about_en.clone(),
                bytes: folder_size(Path::new(folder)),
            });
        }
    }
    out
}

pub fn folder_size(p: &Path) -> u64 {
    if p.as_os_str().is_empty() {
        return 0;
    }
    walkdir::WalkDir::new(p)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| e.metadata().ok().map(|m| m.len()))
        .sum()
}

// ── Updates (winget) ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    pub id: String,
    pub name: String,
    pub version: String,
    pub available: String,
}

/// Reads `winget upgrade`'s table, in any language: the header line is the one
/// right above the dashes, and each column starts where its title does.
pub fn parse_upgrades(out: &str) -> Vec<Update> {
    // Progress spinners rewrite the line with \r: only what's after the last one shows.
    let lines: Vec<&str> = out.lines().map(|l| l.rsplit('\r').next().unwrap_or(l)).collect();
    let Some(dash) = lines.iter().position(|l| l.trim().len() > 10 && l.trim().chars().all(|c| c == '-')) else { return Vec::new() };
    if dash == 0 {
        return Vec::new();
    }
    let header: Vec<char> = lines[dash - 1].chars().collect();
    let mut starts = Vec::new();
    for (i, c) in header.iter().enumerate() {
        if !c.is_whitespace() && (i == 0 || header[i - 1].is_whitespace()) {
            starts.push(i);
        }
    }
    if starts.len() < 4 {
        return Vec::new();
    }
    let cell = |row: &[char], col: usize| -> String {
        let a = starts[col];
        let b = if col + 1 < starts.len() { starts[col + 1] } else { row.len() };
        if a >= row.len() {
            return String::new();
        }
        row[a..b.min(row.len())].iter().collect::<String>().trim().to_string()
    };
    let mut out = Vec::new();
    for line in &lines[dash + 1..] {
        let row: Vec<char> = line.chars().collect();
        if line.trim().is_empty() {
            break;
        }
        let (name, id, version, available) = (cell(&row, 0), cell(&row, 1), cell(&row, 2), cell(&row, 3));
        let version = version.trim_start_matches("< ").trim_start_matches("> ").to_string();
        // A cut id (…) or one with spaces is not one winget can be given back.
        if id.is_empty() || id.contains(char::is_whitespace) || id.contains('…') || !safe_id(&id) || version.is_empty() || available.is_empty() || version == available {
            continue;
        }
        out.push(Update { name: if name.is_empty() { id.clone() } else { name }, id, version, available });
    }
    out
}

pub fn safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() < 128 && id.chars().next().is_some_and(|c| c.is_ascii_alphanumeric()) && id.chars().all(|c| c.is_ascii_alphanumeric() || "._+-".contains(c))
}

// ── Leftovers ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct KeepList {
    names: Vec<String>,
    prefixes: Vec<String>,
}

fn keep_list() -> KeepList {
    serde_json::from_str(include_str!("../../../rules/keep-folders.json")).unwrap_or(KeepList { names: Vec::new(), prefixes: Vec::new() })
}

/// Lowercase letters and digits only: "Notepad++ 8.6" → "notepad86".
pub fn norm(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_lowercase()).collect()
}

/// The name without its version or bitness: "WinRAR 6.24 (64-bit)" → "winrar".
pub fn base_name(name: &str) -> String {
    let words: Vec<&str> = name.split_whitespace().collect();
    let cut = words
        .iter()
        .enumerate()
        .skip(1)
        .find(|(_, w)| {
            let w = w.trim_start_matches('(');
            w.starts_with(|c: char| c.is_ascii_digit())
                || (w.len() > 1 && (w.starts_with('v') || w.starts_with('V')) && w[1..].starts_with(|c: char| c.is_ascii_digit()))
                || w.starts_with("x64")
                || w.starts_with("x86")
        })
        .map(|(i, _)| i)
        .unwrap_or(words.len());
    norm(&words[..cut].join(" "))
}

#[derive(Debug, Clone, PartialEq)]
pub struct Gone {
    pub name: String,
    pub publisher: String,
    pub location: String,
}

/// A program still installed, so folders it uses are never offered.
#[derive(Debug, Clone, PartialEq)]
pub struct Present {
    pub name: String,
    pub location: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Leftover {
    pub id: u64,
    pub path: String,
    pub bytes: u64,
}

/// The folders `gone` left in `bases` (AppData, ProgramData, Program Files…),
/// matched by its exact name (or its name under its publisher's folder).
pub fn find_leftovers(gone: &Gone, bases: &[PathBuf], present: &[Present], home: &Path) -> Vec<(PathBuf, u64)> {
    let keep = keep_list();
    let names: Vec<String> = [norm(&gone.name), base_name(&gone.name)].into_iter().filter(|n| n.len() >= 3).collect();
    let publisher = norm(&gone.publisher);
    let kept_name = |dir: &Path| {
        let n = dir.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
        keep.names.contains(&n) || keep.prefixes.iter().any(|p| n.starts_with(p.as_str()))
    };
    let matches = |dir: &Path| dir.file_name().map(|n| names.contains(&norm(&n.to_string_lossy()))).unwrap_or(false);
    let mut found: Vec<PathBuf> = Vec::new();
    if !gone.location.trim().is_empty() {
        let p = PathBuf::from(gone.location.trim());
        if p.is_dir() {
            found.push(p);
        }
    }
    for base in bases {
        for e in std::fs::read_dir(base).into_iter().flatten().flatten() {
            let Ok(ft) = e.file_type() else { continue };
            if !ft.is_dir() || ft.is_symlink() {
                continue;
            }
            let dir = e.path();
            if matches(&dir) {
                found.push(dir);
            } else if publisher.len() >= 3 && norm(&e.file_name().to_string_lossy()) == publisher {
                // Publisher\Program.
                for inner in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
                    if inner.file_type().map(|t| t.is_dir() && !t.is_symlink()).unwrap_or(false) && matches(&inner.path()) {
                        found.push(inner.path());
                    }
                }
            }
        }
    }
    found.sort();
    found.dedup();
    found
        .into_iter()
        .filter(|d| !kept_name(d) && safe_leftover(d, home))
        // Never what a program still installed lives in or is named like.
        .filter(|d| {
            !present.iter().any(|p| {
                let loc = PathBuf::from(p.location.trim());
                (!p.location.trim().is_empty() && (loc.starts_with(d) || d.starts_with(&loc)))
                    || d.file_name().is_some_and(|n| {
                        let n = norm(&n.to_string_lossy());
                        n == norm(&p.name) || n == base_name(&p.name)
                    })
            })
        })
        .map(|d| {
            let size = folder_size(&d);
            (d, size)
        })
        .collect()
}

/// A program's own folder can sit in Program Files or AppData, which other
/// tools protect as a whole; here only the folder itself must not be one of
/// Windows', a shared one, a drive's top folder, or your profile.
pub fn safe_leftover(d: &Path, home: &Path) -> bool {
    let names: Vec<String> = d.components().filter_map(|c| match c {
        std::path::Component::Normal(s) => Some(s.to_string_lossy().to_lowercase()),
        _ => None,
    }).collect();
    let inside_windows = names.iter().any(|n| ["windows", "winsxs", "system32", "syswow64", "$recycle.bin", "system volume information"].contains(&n.as_str()));
    names.len() >= 2
        && !inside_windows
        && d != home
        && !home.starts_with(d)
        && !d.file_name().is_some_and(|n| {
            let n = n.to_string_lossy();
            fsx::is_protected_name(&n) || ["roaming", "local", "locallow", "programs", "packages", "temp", "users"].contains(&n.to_lowercase().as_str())
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn knows_preinstalled_apps() {
        let known = known_apps();
        assert!(known.len() > 100);
        assert!(known.iter().all(|k| safe_package(&k.package)), "every package name is plain");
        assert!(matches_known("WildTangentGames.63435CFB65F55", "WildTangentGames"));
        assert!(!matches_known("Microsoft.BingNewsX", "Microsoft.BingNews"));
        let installed = vec![("Microsoft.BingNews".to_string(), String::new()), ("Microsoft.WindowsCalculator".to_string(), String::new())];
        let picked = pick_preinstalled(&installed, &known);
        assert_eq!(picked.len(), 1);
        assert_eq!(picked[0].package, "Microsoft.BingNews");
        assert!(!safe_package("x'; rm"));
    }

    #[test]
    fn reads_wingets_table_in_spanish_too() {
        let out = "   - \r   \\ \r\
Nombre                         Id                          Versión       Disponible    Origen\n\
------------------------------------------------------------------------------------------------\n\
Google Chrome                  Google.Chrome               129.0.6668.90 130.0.6723.70 winget\n\
7-Zip 23.01 (x64)              7zip.7zip                   23.01         24.08         winget\n\
Algo raro                      Raro.App…                   1.0           2.0           winget\n\
Ya al día                      Same.App                    < 3.0         3.0           winget\n\
\n\
4 actualizaciones disponibles.\n";
        let u = parse_upgrades(out);
        assert_eq!(u.len(), 2);
        assert_eq!(u[0], Update { id: "Google.Chrome".into(), name: "Google Chrome".into(), version: "129.0.6668.90".into(), available: "130.0.6723.70".into() });
        assert_eq!(u[1].id, "7zip.7zip");
        assert!(parse_upgrades("No se encontró ninguna actualización disponible.").is_empty());
    }

    #[test]
    fn names_without_versions() {
        assert_eq!(base_name("WinRAR 6.24 (64-bit)"), "winrar");
        assert_eq!(base_name("Notepad++ (64-bit x64)"), "notepad");
        assert_eq!(base_name("Discord"), "discord");
        assert_eq!(base_name("OBS Studio v30.1"), "obsstudio");
        assert_eq!(base_name("7-Zip 23.01 (x64)"), "7zip");
    }

    #[test]
    fn finds_only_that_programs_folders() {
        let dir = crate::fsx::scratch();
        let r = dir.path();
        let appdata = r.join("AppDataRoaming");
        let pf = r.join("Program Files");
        for d in ["AppDataRoaming/Tidy Notes", "AppDataRoaming/Tidy Notes Tools", "AppDataRoaming/Microsoft", "Program Files/Acme Soft/TidyNotes", "Program Files/Steam"] {
            fs::create_dir_all(r.join(d)).unwrap();
        }
        fs::write(r.join("AppDataRoaming/Tidy Notes/settings.ini"), "x".repeat(30)).unwrap();
        let gone = Gone { name: "Tidy Notes 6.24 (64-bit)".into(), publisher: "Acme Soft".into(), location: String::new() };
        let mut found = find_leftovers(&gone, &[appdata.clone(), pf.clone()], &[], Path::new("/nowhere"));
        found.sort();
        let paths: Vec<_> = found.iter().map(|(p, _)| p.clone()).collect();
        assert_eq!(paths, vec![appdata.join("Tidy Notes"), pf.join("Acme Soft").join("TidyNotes")]);
        assert_eq!(found[0].1, 30);
        // A program still installed keeps its folder.
        let present = [Present { name: "Tidy Notes".into(), location: String::new() }];
        assert!(find_leftovers(&gone, &[appdata], &present, Path::new("/nowhere")).is_empty());
        // Shared names are never offered.
        let ms = Gone { name: "Microsoft".into(), publisher: String::new(), location: String::new() };
        assert!(find_leftovers(&ms, &[r.join("AppDataRoaming")], &[], Path::new("/nowhere")).is_empty());
        let home = Path::new("/Users/ana");
        assert!(!safe_leftover(Path::new("/Program Files"), home));
        assert!(!safe_leftover(Path::new("/Users/ana/AppData/Roaming"), home));
        assert!(!safe_leftover(Path::new("/Windows/System32/x"), home));
        assert!(safe_leftover(Path::new("/Program Files/Tidy Notes"), home));
    }
}
