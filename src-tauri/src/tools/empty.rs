// Empty folders: folders with no files anywhere inside. Hidden folders,
// protected ones (Windows', programs', your profile's own) and the folder you
// chose are never listed. Deleting checks again that the folder is still a
// real, empty folder, and removes only that (deepest first). Kudu's empty
// folder cleaner (MIT, Advent Development) set these rules.

use crate::fsx;
use crate::tools::Progress;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EmptyFolder {
    pub id: u64,
    pub path: String,
    pub depth: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub folders: Vec<EmptyFolder>,
    pub scanned: u64,
    pub cancelled: bool,
}

const MAX_DEPTH: usize = 40;

/// Whether `dir` holds nothing but empty folders; records the empty ones.
fn visit(dir: &Path, depth: usize, root: &Path, home: &Path, out: &mut Vec<(PathBuf, usize)>, scanned: &mut u64, progress: &Progress) -> bool {
    if progress.cancelled() || depth > MAX_DEPTH || fsx::in_protected_tree(dir, home) {
        return false;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return false };
    *scanned += 1;
    progress.tick(*scanned, 0, dir);
    let mut empty = true;
    for e in entries {
        let Ok(e) = e else {
            empty = false;
            continue;
        };
        let Ok(ft) = e.file_type() else {
            empty = false;
            continue;
        };
        let name = e.file_name();
        // Links, files and anything else are content; hidden folders are left alone.
        if !ft.is_dir() || ft.is_symlink() || name.to_string_lossy().starts_with('.') {
            empty = false;
            continue;
        }
        if !visit(&e.path(), depth + 1, root, home, out, scanned, progress) {
            empty = false;
        }
    }
    if empty && dir != root && !fsx::is_protected(dir, home) {
        out.push((dir.to_path_buf(), depth));
    }
    empty
}

pub fn find(root: &Path, home: &Path, progress: &Progress, keep: &mut dyn FnMut(PathBuf) -> u64) -> Found {
    let mut found = Vec::new();
    let mut scanned = 0;
    visit(root, 0, root, home, &mut found, &mut scanned, progress);
    found.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let folders = found
        .into_iter()
        .map(|(p, depth)| EmptyFolder { path: p.display().to_string(), depth, id: keep(p) })
        .collect();
    Found { folders, scanned, cancelled: progress.cancelled() }
}

/// Removes these folders if they are still real and empty. Returns (removed, kept ids).
pub fn remove(chosen: &[(u64, PathBuf)], home: &Path) -> (u64, Vec<u64>) {
    let mut list = chosen.to_vec();
    // Deepest first, so a parent is empty by the time its turn comes.
    list.sort_by_key(|(_, p)| std::cmp::Reverse(p.components().count()));
    let mut removed = 0;
    let mut kept = Vec::new();
    for (id, p) in list {
        let real_dir = std::fs::symlink_metadata(&p).map(|m| m.is_dir() && !m.file_type().is_symlink()).unwrap_or(false);
        let empty = std::fs::read_dir(&p).map(|mut d| d.next().is_none()).unwrap_or(false);
        // remove_dir itself refuses a folder that isn't empty.
        if real_dir && empty && !fsx::is_protected(&p, home) && std::fs::remove_dir(&p).is_ok() {
            removed += 1;
        } else {
            kept.push(id);
        }
    }
    (removed, kept)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn finds_only_truly_empty_folders() {
        let dir = crate::fsx::scratch();
        let r = dir.path();
        for d in ["a/b/c", "a/d", "keep/sub", ".hidden/x", "proj/node_modules/x"] {
            fs::create_dir_all(r.join(d)).unwrap();
        }
        fs::write(r.join("keep/file.txt"), "hi").unwrap();
        let home = Path::new("/nowhere");
        let mut ids = 0;
        let found = find(r, home, &Progress::quiet(), &mut |_| {
            ids += 1;
            ids
        });
        let mut paths: Vec<String> = found.folders.iter().map(|f| f.path.trim_start_matches(&r.display().to_string()).to_string()).collect();
        paths.sort();
        let want: Vec<String> = ["/a", "/a/b", "/a/b/c", "/a/d", "/keep/sub"].iter().map(|s| s.replace('/', std::path::MAIN_SEPARATOR_STR)).collect();
        assert_eq!(paths, want, "not the root, not hidden or protected ones, not one with a file");
        assert_eq!(found.folders[0].depth, 3, "deepest first");
    }

    #[test]
    fn removes_only_what_is_still_empty() {
        let dir = crate::fsx::scratch();
        let r = dir.path();
        fs::create_dir_all(r.join("p/q/a")).unwrap();
        fs::create_dir_all(r.join("p/q/b")).unwrap();
        fs::create_dir_all(r.join("p/q/c")).unwrap();
        fs::create_dir_all(r.join("p/r")).unwrap();
        let chosen = vec![(1, r.join("p/q")), (2, r.join("p/q/a")), (3, r.join("p/q/b")), (4, r.join("p/r"))];
        fs::write(r.join("p/r/new.txt"), "since the scan").unwrap();
        let (removed, kept) = remove(&chosen, Path::new("/nowhere"));
        assert_eq!(removed, 2);
        assert!(kept.contains(&1), "q still holds c, which wasn't chosen");
        assert!(kept.contains(&4));
        assert!(r.join("p/r/new.txt").exists());
    }
}
