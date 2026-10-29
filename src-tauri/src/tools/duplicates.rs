// Duplicate files: the same content saved more than once. Found by size, then
// by the first 16 KB, then by the whole file (BLAKE3). Two names for the same
// file (hard links) are one file. In each group the copy with the shortest
// path is the one to keep. Deleting goes to the Recycle Bin and only after
// checking again, right then, that the file is unchanged and that another
// intact copy stays: the last copy is never deleted. Kudu's duplicate finder
// (MIT, Advent Development) worked out these checks; see THIRD-PARTY-NOTICES.md.

use crate::fsx::{self, Identity};
use crate::tools::Progress;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub const MIN_SIZE: u64 = 1024 * 1024;
const HEAD: usize = 16 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Copy {
    pub id: u64,
    pub path: String,
    pub modified: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub bytes: u64,
    pub kind: &'static str,
    /// The first is the one to keep.
    pub copies: Vec<Copy>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub groups: Vec<Group>,
    pub files: u64,
    pub cancelled: bool,
}

/// What the app keeps of a found copy, to check it before deleting.
#[derive(Debug, Clone)]
pub struct Kept {
    pub path: PathBuf,
    pub identity: Identity,
    pub hash: [u8; 32],
    /// The other copies of its group.
    pub group: Vec<u64>,
}

fn head_hash(path: &Path) -> Option<[u8; 32]> {
    let mut f = std::fs::File::open(path).ok()?;
    let mut buf = vec![0; HEAD];
    let mut n = 0;
    while n < HEAD {
        match f.read(&mut buf[n..]) {
            Ok(0) => break,
            Ok(k) => n += k,
            Err(_) => return None,
        }
    }
    Some(*blake3::hash(&buf[..n]).as_bytes())
}

pub fn full_hash(path: &Path, progress: &Progress) -> Option<[u8; 32]> {
    let mut f = std::fs::File::open(path).ok()?;
    let mut h = blake3::Hasher::new();
    let mut buf = vec![0; 256 * 1024];
    loop {
        if progress.cancelled() {
            return None;
        }
        match f.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                h.update(&buf[..n]);
            }
            Err(_) => return None,
        }
    }
    Some(*h.finalize().as_bytes())
}

/// Splits `items` by `key`, keeping only what has company.
fn split<K: std::hash::Hash + Eq>(items: Vec<(PathBuf, Identity)>, mut key: impl FnMut(&Path) -> Option<K>) -> Vec<Vec<(PathBuf, Identity)>> {
    let mut by: HashMap<K, Vec<(PathBuf, Identity)>> = HashMap::new();
    for it in items {
        if let Some(k) = key(&it.0) {
            by.entry(k).or_default().push(it);
        }
    }
    by.into_values().filter(|g| g.len() > 1).collect()
}

/// Finds the duplicates under `root`. `keep` stores each copy and returns its id.
pub fn find(root: &Path, home: &Path, min: u64, progress: &Progress, keep: &mut dyn FnMut(Kept) -> u64) -> Found {
    // 1. Every file big enough, by size.
    let mut by_size: HashMap<u64, Vec<(PathBuf, Identity)>> = HashMap::new();
    let mut files = 0u64;
    let walk = WalkDir::new(root).follow_links(false).same_file_system(true).into_iter().filter_entry(|e| {
        // Windows' and programs' own folders aren't yours to tidy.
        e.depth() == 0 || !(e.file_type().is_dir() && fsx::in_protected_tree(e.path(), home))
    });
    for e in walk.filter_map(Result::ok) {
        if progress.cancelled() {
            return Found { groups: Vec::new(), files, cancelled: true };
        }
        if !e.file_type().is_file() || e.file_type().is_symlink() {
            continue;
        }
        let Ok(m) = e.metadata() else { continue };
        files += 1;
        if m.len() >= min {
            by_size.entry(m.len()).or_default().push((e.path().to_path_buf(), Identity::of(&m)));
        }
        progress.tick(files, 0, e.path());
    }

    // 2. Same size, same start, same everything.
    let mut groups = Vec::new();
    for same_size in by_size.into_values().filter(|g| g.len() > 1) {
        for same_head in split(same_size, head_hash) {
            let mut hashes = HashMap::new();
            let same_all = split(same_head, |p| {
                progress.tick(files, 0, p);
                let h = full_hash(p, progress)?;
                hashes.insert(p.to_path_buf(), h);
                Some(h)
            });
            for mut g in same_all {
                // Two names of one file (a hard link) free nothing: keep one name.
                let mut distinct: Vec<(PathBuf, Identity)> = Vec::new();
                for it in g.drain(..) {
                    let same_file = distinct.iter().any(|d| same_file::is_same_file(&d.0, &it.0).unwrap_or(false));
                    if !same_file {
                        distinct.push(it);
                    }
                }
                if distinct.len() < 2 {
                    continue;
                }
                distinct.sort_by(|a, b| a.0.as_os_str().len().cmp(&b.0.as_os_str().len()).then_with(|| a.0.cmp(&b.0)));
                groups.push((distinct, hashes.clone()));
            }
        }
        if progress.cancelled() {
            return Found { groups: Vec::new(), files, cancelled: true };
        }
    }

    // 3. Kept by the app with ids; the page gets the ids.
    let mut out = Vec::new();
    for (members, hashes) in groups {
        let bytes = members[0].1.len;
        let ids: Vec<u64> = members
            .iter()
            .map(|(path, identity)| {
                keep(Kept { path: path.clone(), identity: *identity, hash: hashes[path], group: Vec::new() })
            })
            .collect();
        let copies = members
            .iter()
            .zip(&ids)
            .map(|((path, _), id)| Copy {
                id: *id,
                path: path.display().to_string(),
                modified: std::fs::symlink_metadata(path).map(|m| fsx::modified_ms(&m)).unwrap_or(0),
            })
            .collect();
        let name = members[0].0.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        out.push((Group { bytes, kind: super::storage::kind_of(&name), copies }, ids));
    }
    out.sort_by(|a, b| (b.0.bytes * (b.0.copies.len() as u64 - 1)).cmp(&(a.0.bytes * (a.0.copies.len() as u64 - 1))));
    Found { groups: out.into_iter().map(|(g, _)| g).collect(), files, cancelled: false }
}

/// Whether `k` is still the file found, with the same content.
fn intact(k: &Kept, progress: &Progress) -> bool {
    fsx::identity(&k.path) == Some(k.identity) && full_hash(&k.path, progress) == Some(k.hash) && fsx::identity(&k.path) == Some(k.identity)
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Removed {
    pub freed: u64,
    pub files: u64,
    /// Ids not deleted: changed since, the last copy, or Windows said no.
    pub kept: Vec<u64>,
}

/// Sends the chosen copies to the Recycle Bin (`del` does the deleting).
pub fn remove(ids: &[u64], found: &HashMap<u64, Kept>, progress: &Progress, del: &dyn Fn(&Path) -> Result<(), String>) -> Removed {
    let mut r = Removed::default();
    // Every copy of a group chosen: its first (the one to keep) stays.
    let mut chosen: Vec<u64> = Vec::new();
    for &id in ids {
        if chosen.contains(&id) {
            continue;
        }
        let keep_first = found.get(&id).is_some_and(|k| k.group.first() == Some(&id) && k.group.iter().all(|o| ids.contains(o)));
        if keep_first {
            r.kept.push(id);
        } else {
            chosen.push(id);
        }
    }
    let mut gone: Vec<u64> = Vec::new();
    for &id in &chosen {
        let Some(k) = found.get(&id) else {
            r.kept.push(id);
            continue;
        };
        // Another copy of the group, not chosen and not gone, checked again now.
        let survivor = k
            .group
            .iter()
            .filter(|o| **o != id && !chosen.contains(o) && !gone.contains(o))
            .filter_map(|o| found.get(o))
            .any(|o| intact(o, progress) && !same_file::is_same_file(&o.path, &k.path).unwrap_or(true));
        if !survivor || !intact(k, progress) {
            r.kept.push(id);
            continue;
        }
        match del(&k.path) {
            Ok(()) => {
                r.freed += k.identity.len;
                r.files += 1;
                gone.push(id);
            }
            Err(_) => r.kept.push(id),
        }
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(p: &Path, content: &[u8]) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, content).unwrap();
    }

    fn scan(root: &Path) -> (Found, HashMap<u64, Kept>) {
        let mut kept: HashMap<u64, Kept> = HashMap::new();
        let mut next = 0;
        let found = find(root, Path::new("/nowhere"), 1, &Progress::quiet(), &mut |k| {
            next += 1;
            kept.insert(next, k);
            next
        });
        // As lib.rs does: each copy knows its group.
        for g in &found.groups {
            let ids: Vec<u64> = g.copies.iter().map(|c| c.id).collect();
            for id in &ids {
                kept.get_mut(id).unwrap().group = ids.clone();
            }
        }
        (found, kept)
    }

    fn trash_for_tests(p: &Path) -> Result<(), String> {
        fs::remove_file(p).map_err(|e| e.to_string())
    }

    #[test]
    fn finds_same_content_not_same_size() {
        let dir = crate::fsx::scratch();
        let r = dir.path();
        let a = vec![7u8; 40_000];
        let mut b = a.clone();
        b[39_999] = 8; // same size, same start, different end
        write(&r.join("x/photo.jpg"), &a);
        write(&r.join("y/longer/photo copy.jpg"), &a);
        write(&r.join("z.jpg"), &b);
        let (found, _) = scan(r);
        assert_eq!(found.groups.len(), 1);
        let g = &found.groups[0];
        assert_eq!(g.bytes, 40_000);
        assert_eq!(g.copies.len(), 2);
        assert!(g.copies[0].path.ends_with("photo.jpg"), "the shortest path is the one to keep");
        assert_eq!(g.kind, "image");
    }

    #[test]
    fn deletes_a_copy_but_never_the_last() {
        let dir = crate::fsx::scratch();
        let r = dir.path();
        for p in ["a.bin", "b/a.bin", "c/d/a.bin"] {
            write(&r.join(p), b"same content here");
        }
        let (found, kept) = scan(r);
        let ids: Vec<u64> = found.groups[0].copies.iter().map(|c| c.id).collect();
        // All three chosen: two go, one stays.
        let out = remove(&ids, &kept, &Progress::quiet(), &trash_for_tests);
        assert_eq!(out.files, 2);
        assert_eq!(out.kept.len(), 1);
        let left: Vec<_> = ["a.bin", "b/a.bin", "c/d/a.bin"].iter().filter(|p| r.join(p).exists()).collect();
        assert_eq!(left.len(), 1);
    }

    #[test]
    fn a_changed_file_is_not_deleted() {
        let dir = crate::fsx::scratch();
        let r = dir.path();
        write(&r.join("a.txt"), b"twins!");
        write(&r.join("bb/a.txt"), b"twins!");
        let (found, kept) = scan(r);
        let second = found.groups[0].copies[1].id;
        write(&r.join("bb/a.txt"), b"TWINS!");
        let out = remove(&[second], &kept, &Progress::quiet(), &trash_for_tests);
        assert_eq!(out.files, 0);
        assert!(r.join("bb/a.txt").exists());
        // Nor when the copy that should stay changed.
        write(&r.join("bb/a.txt"), b"twins!");
        let (found, kept) = scan(r);
        write(&r.join("a.txt"), b"other!");
        let out = remove(&[found.groups[0].copies[1].id], &kept, &Progress::quiet(), &trash_for_tests);
        assert_eq!(out.files, 0, "no intact copy would remain");
    }

    #[cfg(unix)]
    #[test]
    fn hard_links_are_one_file() {
        let dir = crate::fsx::scratch();
        write(&dir.path().join("a.dat"), b"linked");
        fs::hard_link(dir.path().join("a.dat"), dir.path().join("b.dat")).unwrap();
        let (found, _) = scan(dir.path());
        assert!(found.groups.is_empty());
    }
}
