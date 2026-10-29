// The cleaner: what each rule would free (scan), and freeing it (clean).
// A clean walks the rule's folders again, so it only deletes what is there
// and still matches now. Links are never followed or deleted, a target folder
// itself always stays, and a file that can't be deleted (in use, no rights)
// is skipped and counted.

use crate::platform;
use crate::rules::{self, Rule, Target};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuleScan {
    pub id: String,
    pub group: String,
    pub name: String,
    pub name_en: String,
    pub about: String,
    pub about_en: String,
    pub admin: bool,
    /// Its program is open: some files will be skipped until it closes.
    pub running: bool,
    pub bytes: u64,
    pub files: u64,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CleanReport {
    pub freed: u64,
    pub files: u64,
    /// In use or not ours to delete.
    pub skipped: u64,
    /// Rules not run because they need administrator rights.
    pub needs_admin: Vec<String>,
}

/// The files a target would clean, with their sizes.
pub fn target_files(t: &Target, env: &dyn Fn(&str) -> Option<String>, now: SystemTime) -> Vec<(PathBuf, u64)> {
    let Some(path) = rules::expand(&t.path, env) else { return Vec::new() };
    let mut out = Vec::new();
    for root in rules::folders(&path) {
        let walk = WalkDir::new(&root).follow_links(false).min_depth(1).max_depth(if t.recursive { usize::MAX } else { 1 });
        for entry in walk.into_iter().filter_map(Result::ok) {
            let ft = entry.file_type();
            if !ft.is_file() || ft.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy();
            if !t.files.iter().any(|p| rules::matches(p, &name)) {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            if t.min_age_hours > 0 {
                let old_enough = meta
                    .modified()
                    .ok()
                    .and_then(|m| now.duration_since(m).ok())
                    .map(|age| age >= Duration::from_secs(t.min_age_hours * 3600))
                    .unwrap_or(false);
                if !old_enough {
                    continue;
                }
            }
            out.push((entry.into_path(), meta.len()));
        }
    }
    out
}

pub fn scan_rule(rule: &Rule, env: &dyn Fn(&str) -> Option<String>, running: &dyn Fn(&str) -> bool, now: SystemTime) -> RuleScan {
    let (bytes, files) = if rule.is_recycle_bin() {
        platform::recycle_bin_size()
    } else {
        let mut seen = std::collections::HashSet::new();
        let mut bytes = 0;
        let mut files = 0;
        for t in &rule.targets {
            for (p, size) in target_files(t, env, now) {
                // Two targets may reach the same file (a profile folder named twice).
                if seen.insert(p) {
                    bytes += size;
                    files += 1;
                }
            }
        }
        (bytes, files)
    };
    RuleScan {
        id: rule.id.clone(),
        group: rule.group.clone(),
        name: rule.name.clone(),
        name_en: rule.name_en.clone(),
        about: rule.about.clone(),
        about_en: rule.about_en.clone(),
        admin: rule.admin,
        running: rule.process.as_deref().map(running).unwrap_or(false),
        bytes,
        files,
    }
}

/// Deletes what a rule matches now. Returns (freed, files, skipped).
pub fn clean_rule(rule: &Rule, env: &dyn Fn(&str) -> Option<String>, now: SystemTime) -> (u64, u64, u64) {
    if rule.is_recycle_bin() {
        let (bytes, files) = platform::recycle_bin_size();
        return if platform::empty_recycle_bin() { (bytes, files, 0) } else { (0, 0, files) };
    }
    let (mut freed, mut done, mut skipped) = (0, 0, 0);
    for t in &rule.targets {
        let files = target_files(t, env, now);
        for (p, size) in &files {
            match std::fs::remove_file(p) {
                Ok(()) => {
                    freed += size;
                    done += 1;
                }
                Err(_) => skipped += 1,
            }
        }
        if t.recursive {
            if let Some(path) = rules::expand(&t.path, env) {
                for root in rules::folders(&path) {
                    remove_empty_dirs(&root);
                }
            }
        }
    }
    (freed, done, skipped)
}

/// Removes the folders under `root` left empty, deepest first; `root` itself stays.
fn remove_empty_dirs(root: &Path) {
    let mut dirs: Vec<PathBuf> = WalkDir::new(root)
        .follow_links(false)
        .min_depth(1)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_dir() && !e.file_type().is_symlink())
        .map(|e| e.into_path())
        .collect();
    dirs.sort_by_key(|d| std::cmp::Reverse(d.components().count()));
    for d in dirs {
        // Only succeeds when empty.
        let _ = std::fs::remove_dir(&d);
    }
}

/// Scans every rule (the recycle bin and processes come from the system).
pub fn scan_all() -> Vec<RuleScan> {
    let running = platform::running_processes();
    let is_running = |name: &str| running.contains(&name.to_lowercase());
    let now = SystemTime::now();
    rules::all().iter().map(|r| scan_rule(r, &rules::system_env, &is_running, now)).collect()
}

/// Cleans the rules with these ids. Admin rules are left out when the app isn't elevated.
pub fn clean(ids: &[String]) -> CleanReport {
    let elevated = platform::is_elevated();
    let now = SystemTime::now();
    let mut report = CleanReport::default();
    for rule in rules::all().iter().filter(|r| ids.contains(&r.id)) {
        if rule.admin && !elevated {
            report.needs_admin.push(rule.id.clone());
            continue;
        }
        let (freed, files, skipped) = clean_rule(rule, &rules::system_env, now);
        report.freed += freed;
        report.files += files;
        report.skipped += skipped;
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn rule(targets: Vec<Target>) -> Rule {
        Rule {
            id: "t".into(), group: "system".into(), name: "t".into(), name_en: "t".into(), about: String::new(),
            about_en: String::new(), admin: false, process: Some("thing.exe".into()), kind: None, targets,
        }
    }

    fn target(path: &str, files: &[&str], recursive: bool, min_age_hours: u64) -> Target {
        Target { path: path.into(), files: files.iter().map(|s| s.to_string()).collect(), recursive, min_age_hours }
    }

    fn write(p: &Path, bytes: usize) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, vec![b'x'; bytes]).unwrap();
    }

    #[test]
    fn scans_and_cleans_only_what_matches_and_keeps_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().to_string_lossy().to_string();
        let env = move |n: &str| (n == "BASE").then(|| base.clone());
        write(&dir.path().join("Dumps/a.dmp"), 100);
        write(&dir.path().join("Dumps/b.dmp"), 50);
        write(&dir.path().join("Dumps/keep.txt"), 10);
        write(&dir.path().join("Dumps/sub/c.dmp"), 5);
        let r = rule(vec![target("%BASE%/Dumps", &["*.dmp"], false, 0)]);
        let now = SystemTime::now();

        let s = scan_rule(&r, &env, &|_| false, now);
        assert_eq!((s.bytes, s.files), (150, 2), "not into subfolders unless recursive");
        assert!(!s.running);
        assert!(scan_rule(&r, &env, &|p| p == "thing.exe", now).running);

        assert_eq!(clean_rule(&r, &env, now), (150, 2, 0));
        assert!(dir.path().join("Dumps").is_dir());
        assert!(dir.path().join("Dumps/keep.txt").exists());
        assert!(dir.path().join("Dumps/sub/c.dmp").exists());
    }

    #[test]
    fn recursive_targets_empty_their_subfolders_and_respect_age() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().to_string_lossy().to_string();
        let env = move |n: &str| (n == "BASE").then(|| base.clone());
        write(&dir.path().join("Temp/x/y/old.tmp"), 40);
        write(&dir.path().join("Temp/new.tmp"), 7);
        let r = rule(vec![target("%BASE%/Temp", &["*"], true, 24)]);
        // Two days from now everything is old; now nothing is.
        let later = SystemTime::now() + Duration::from_secs(48 * 3600);
        assert_eq!(scan_rule(&r, &env, &|_| false, SystemTime::now()).files, 0);
        assert_eq!(scan_rule(&r, &env, &|_| false, later).files, 2);
        assert_eq!(clean_rule(&r, &env, later), (47, 2, 0));
        assert!(dir.path().join("Temp").is_dir(), "the target folder stays");
        assert!(!dir.path().join("Temp/x").exists(), "emptied subfolders go");
    }

    #[cfg(unix)]
    #[test]
    fn never_through_a_link() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        write(&outside.path().join("precious.doc"), 9);
        fs::create_dir_all(dir.path().join("Cache")).unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("Cache/link")).unwrap();
        let base = dir.path().to_string_lossy().to_string();
        let env = move |n: &str| (n == "BASE").then(|| base.clone());
        let r = rule(vec![target("%BASE%/Cache", &["*"], true, 0)]);
        assert_eq!(clean_rule(&r, &env, SystemTime::now()), (0, 0, 0));
        assert!(outside.path().join("precious.doc").exists());
    }

    #[test]
    fn a_missing_folder_or_variable_finds_nothing() {
        let r = rule(vec![target("%NOPE%/x", &["*"], true, 0), target("%BASE%/missing", &["*"], true, 0)]);
        let env = |n: &str| (n == "BASE").then(|| "/definitely/not/here".to_string());
        assert_eq!(scan_rule(&r, &env, &|_| false, SystemTime::now()).files, 0);
    }
}
