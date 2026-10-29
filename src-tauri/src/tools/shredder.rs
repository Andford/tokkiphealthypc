// File shredder: writes over a file twice (random data, then zeros) before
// deleting it, so it can't be brought back with recovery programs. There is no
// undo, and the page says so. On SSDs and some drives the disk itself may keep
// old copies the overwrite can't reach; the page says that too. Never on a
// protected folder, never through a link, and only the file that was there when
// you chose it: one that changed or was swapped is left alone. Kudu's shredder
// (MIT, Advent Development) worked these out.

use crate::fsx::{self, Identity};
use crate::tools::Progress;
use serde::Serialize;
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Chosen {
    pub path: String,
    pub name: String,
    pub bytes: u64,
    pub files: u64,
    pub folder: bool,
    /// A folder or file that can't be shredded (Windows', a program's, your profile's own).
    pub protected: bool,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Shredded {
    pub files: u64,
    pub bytes: u64,
    pub failed: u64,
    pub cancelled: bool,
}

const CHUNK: usize = 1024 * 1024;

/// The regular files a choice holds, with what they are now.
fn files_in(path: &Path, home: &Path) -> Vec<(PathBuf, Identity)> {
    let Ok(m) = std::fs::symlink_metadata(path) else { return Vec::new() };
    if m.file_type().is_symlink() {
        return Vec::new();
    }
    if m.is_file() {
        return vec![(path.to_path_buf(), Identity::of(&m))];
    }
    WalkDir::new(path)
        .follow_links(false)
        .same_file_system(true)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !(e.file_type().is_dir() && fsx::is_protected(e.path(), home)))
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file() && !e.file_type().is_symlink())
        .filter_map(|e| e.metadata().ok().map(|m| (e.into_path(), Identity::of(&m))))
        .collect()
}

pub fn describe(path: &Path, home: &Path) -> Chosen {
    let folder = std::fs::symlink_metadata(path).map(|m| m.is_dir()).unwrap_or(false);
    let protected = fsx::is_protected(path, home) || (!folder && path.parent().is_some_and(|p| fsx::in_protected_tree(p, home)));
    let files = if protected { Vec::new() } else { files_in(path, home) };
    Chosen {
        path: path.display().to_string(),
        name: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.display().to_string()),
        bytes: files.iter().map(|f| f.1.len).sum(),
        files: files.len() as u64,
        folder,
        protected,
    }
}

/// A small fast generator: the overwrite needs noise, not secrecy.
struct Noise(u64);
impl Noise {
    fn fill(&mut self, buf: &mut [u8]) {
        for chunk in buf.chunks_mut(8) {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            let b = self.0.to_le_bytes();
            chunk.copy_from_slice(&b[..chunk.len()]);
        }
    }
}

/// Overwrites one file in place. False if cancelled halfway (it is then not deleted).
fn overwrite(path: &Path, expected: Identity, progress: &Progress) -> std::io::Result<bool> {
    let mut f = std::fs::OpenOptions::new().write(true).open(path)?;
    // The file opened must still be the one found, at the same size.
    if Identity::of(&f.metadata()?).len != expected.len || fsx::identity(path) != Some(expected) {
        return Err(std::io::Error::other("changed"));
    }
    let seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(1) | 1;
    let mut noise = Noise(seed);
    let mut buf = vec![0u8; CHUNK];
    for pass in 0..2 {
        f.seek(SeekFrom::Start(0))?;
        let mut left = expected.len;
        while left > 0 {
            if progress.cancelled() {
                return Ok(false);
            }
            let n = left.min(CHUNK as u64) as usize;
            if pass == 0 {
                noise.fill(&mut buf[..n]);
            } else {
                buf[..n].fill(0);
            }
            f.write_all(&buf[..n])?;
            left -= n as u64;
        }
        f.sync_all()?;
    }
    Ok(true)
}

pub fn shred(paths: &[PathBuf], home: &Path, progress: &Progress) -> Shredded {
    let mut out = Shredded::default();
    let mut folders = Vec::new();
    let mut all: Vec<(PathBuf, Identity)> = Vec::new();
    for p in paths {
        if describe(p, home).protected {
            out.failed += 1;
            continue;
        }
        if std::fs::symlink_metadata(p).map(|m| m.is_dir()).unwrap_or(false) {
            folders.push(p.clone());
        }
        for f in files_in(p, home) {
            if !all.iter().any(|a| a.0 == f.0) {
                all.push(f);
            }
        }
    }
    for (path, id) in all {
        progress.tick(out.files, out.bytes, &path);
        match overwrite(&path, id, progress) {
            Ok(true) => match std::fs::remove_file(&path) {
                Ok(()) => {
                    out.files += 1;
                    out.bytes += id.len;
                }
                Err(_) => out.failed += 1,
            },
            Ok(false) => {
                out.cancelled = true;
                break;
            }
            Err(_) => out.failed += 1,
        }
    }
    if !out.cancelled {
        // Then the folders left empty, deepest first; one still holding something stays.
        for f in folders {
            let mut dirs: Vec<PathBuf> = WalkDir::new(&f)
                .follow_links(false)
                .into_iter()
                .filter_map(Result::ok)
                .filter(|e| e.file_type().is_dir() && !e.file_type().is_symlink())
                .map(|e| e.into_path())
                .collect();
            dirs.sort_by_key(|d| std::cmp::Reverse(d.components().count()));
            for d in dirs {
                let _ = std::fs::remove_dir(d);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn shreds_files_and_the_emptied_folders() {
        let dir = crate::fsx::scratch();
        let r = dir.path().join("secret");
        fs::create_dir_all(r.join("inner")).unwrap();
        fs::write(r.join("a.txt"), vec![b'a'; 3 * CHUNK + 5]).unwrap();
        fs::write(r.join("inner/b.txt"), "b").unwrap();
        fs::write(dir.path().join("c.txt"), "c").unwrap();
        let home = Path::new("/nowhere");
        let d = describe(&r, home);
        assert_eq!((d.files, d.bytes, d.folder, d.protected), (2, 3 * CHUNK as u64 + 6, true, false));
        let out = shred(&[r.clone(), dir.path().join("c.txt")], home, &Progress::quiet());
        assert_eq!((out.files, out.failed), (3, 0));
        assert!(!r.exists());
        assert!(!dir.path().join("c.txt").exists());
    }

    #[test]
    fn overwrites_before_deleting() {
        let dir = crate::fsx::scratch();
        let f = dir.path().join("x.bin");
        fs::write(&f, vec![b'S'; 5000]).unwrap();
        let id = fsx::identity(&f).unwrap();
        assert!(overwrite(&f, id, &Progress::quiet()).unwrap());
        assert_eq!(fs::read(&f).unwrap(), vec![0u8; 5000], "the last pass leaves zeros");
    }

    #[test]
    fn refuses_protected_places_and_changed_files() {
        let home = Path::new("/home/ana");
        assert!(describe(Path::new("/home/ana/Documents"), home).protected);
        assert!(describe(Path::new("/"), home).protected);
        let dir = crate::fsx::scratch();
        let f = dir.path().join("y.bin");
        fs::write(&f, "one").unwrap();
        let id = fsx::identity(&f).unwrap();
        fs::write(&f, "two!").unwrap();
        assert!(overwrite(&f, id, &Progress::quiet()).is_err());
        assert_eq!(fs::read_to_string(&f).unwrap(), "two!");
    }
}
