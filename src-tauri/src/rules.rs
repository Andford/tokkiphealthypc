// Cleaning rules: what can be cleaned, where it lives and how old it must be.
// Ours, written by hand in rules/*.json and built into the app. A target's
// path takes %VARIABLES% and `*` for a whole folder name (a browser profile);
// its `files` are patterns for the file names (`*`, `*.dmp`, `thumbcache_*.db`).

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub id: String,
    /// "system", "browsers" or "apps".
    pub group: String,
    pub name: String,
    pub name_en: String,
    pub about: String,
    pub about_en: String,
    /// Deleting needs an elevated app.
    #[serde(default)]
    pub admin: bool,
    /// The program that keeps these files open while it runs ("chrome.exe").
    #[serde(default)]
    pub process: Option<String>,
    /// "files" (the default) or "recycleBin".
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub targets: Vec<Target>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub path: String,
    pub files: Vec<String>,
    /// Into subfolders too.
    #[serde(default)]
    pub recursive: bool,
    /// Only files untouched for this long.
    #[serde(default)]
    pub min_age_hours: u64,
}

impl Rule {
    pub fn is_recycle_bin(&self) -> bool {
        self.kind.as_deref() == Some("recycleBin")
    }
}

/// Every rule built into the app.
pub fn all() -> Vec<Rule> {
    let mut out = Vec::new();
    for src in [
        include_str!("../../rules/system.json"),
        include_str!("../../rules/browsers.json"),
        include_str!("../../rules/apps.json"),
    ] {
        out.extend(serde_json::from_str::<Vec<Rule>>(src).expect("a rules file is malformed"));
    }
    out
}

/// `%NAME%` replaced from `env`; None when a variable is unknown (that target is skipped).
pub fn expand(path: &str, env: &dyn Fn(&str) -> Option<String>) -> Option<String> {
    let mut out = String::new();
    let mut rest = path;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let end = after.find('%')?;
        let value = env(&after[..end])?;
        if value.is_empty() {
            return None;
        }
        out.push_str(&value);
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Some(out)
}

/// The folders a path names: `*` segments stand for every subfolder there.
pub fn folders(path: &str) -> Vec<PathBuf> {
    let parts: Vec<&str> = path.split(['\\', '/']).filter(|p| !p.is_empty()).collect();
    let root = if path.starts_with('/') { PathBuf::from("/") } else { PathBuf::new() };
    let mut current = vec![root];
    for part in parts {
        let mut next = Vec::new();
        for base in &current {
            if part == "*" {
                if let Ok(entries) = std::fs::read_dir(base) {
                    for e in entries.flatten() {
                        // Real folders only: never through a link.
                        if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                            next.push(e.path());
                        }
                    }
                }
            } else {
                let mut p = base.clone();
                // "C:" needs its separator back to stay a drive root.
                if p.as_os_str().is_empty() && part.ends_with(':') {
                    p.push(format!("{part}\\"));
                } else {
                    p.push(part);
                }
                next.push(p);
            }
        }
        current = next;
    }
    current.into_iter().filter(|p| p.is_dir()).collect()
}

/// `*` matches any run of characters; case doesn't matter (Windows names).
pub fn matches(pattern: &str, name: &str) -> bool {
    let p: Vec<char> = pattern.to_lowercase().chars().collect();
    let n: Vec<char> = name.to_lowercase().chars().collect();
    let (mut pi, mut ni) = (0, 0);
    let (mut star, mut mark) = (None, 0);
    while ni < n.len() {
        if pi < p.len() && (p[pi] == n[ni] || p[pi] == '?') {
            pi += 1;
            ni += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            mark = ni;
            pi += 1;
        } else if let Some(s) = star {
            pi = s + 1;
            mark += 1;
            ni = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

/// The process environment, as rules read it.
pub fn system_env(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

pub fn is_inside(path: &Path, root: &Path) -> bool {
    path.starts_with(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_built_in_rule_reads_and_ids_are_unique() {
        let rules = all();
        assert!(rules.len() >= 20);
        let mut ids: Vec<&str> = rules.iter().map(|r| r.id.as_str()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), rules.len());
        for r in &rules {
            assert!(["system", "browsers", "apps"].contains(&r.group.as_str()), "{}", r.id);
            assert!(r.is_recycle_bin() || !r.targets.is_empty(), "{} has no targets", r.id);
            for t in &r.targets {
                assert!(t.path.starts_with('%'), "{}: {} must start at a known folder", r.id, t.path);
                assert!(!t.files.is_empty(), "{}", r.id);
            }
        }
    }

    #[test]
    fn variables_expand_and_unknown_ones_skip_the_target() {
        let env = |n: &str| match n {
            "LOCALAPPDATA" => Some("C:\\Users\\ana\\AppData\\Local".to_string()),
            "EMPTY" => Some(String::new()),
            _ => None,
        };
        assert_eq!(expand("%LOCALAPPDATA%\\CrashDumps", &env).as_deref(), Some("C:\\Users\\ana\\AppData\\Local\\CrashDumps"));
        assert_eq!(expand("%NOPE%\\x", &env), None);
        assert_eq!(expand("%EMPTY%\\x", &env), None);
        assert_eq!(expand("%BROKEN", &env), None);
        assert_eq!(expand("plain", &env).as_deref(), Some("plain"));
    }

    #[test]
    fn patterns_match_like_windows() {
        assert!(matches("*", "anything.tmp"));
        assert!(matches("*.dmp", "Chrome.exe.1234.DMP"));
        assert!(matches("thumbcache_*.db", "thumbcache_256.db"));
        assert!(!matches("thumbcache_*.db", "iconcache_256.db"));
        assert!(matches("MEMORY.DMP", "memory.dmp"));
        assert!(!matches("*.dmp", "notes.txt"));
    }

    #[test]
    fn star_segments_find_every_profile_folder() {
        let dir = tempfile::tempdir().unwrap();
        for p in ["Default/Cache", "Profile 1/Cache", "Profile 2/Other"] {
            std::fs::create_dir_all(dir.path().join(p)).unwrap();
        }
        let base = dir.path().to_string_lossy().to_string();
        let mut found = folders(&format!("{base}/*/Cache"));
        found.sort();
        assert_eq!(found, vec![dir.path().join("Default/Cache"), dir.path().join("Profile 1/Cache")]);
        assert!(folders(&format!("{base}/missing")).is_empty());
    }
}
