// Disk analysis: one walk of a drive or folder gives the map of what fills it
// (folders three levels down), what kind of files they are, and the biggest
// files. Links and other drives mounted inside are never followed. Nothing is
// deleted here; the big files can go to the Recycle Bin afterwards, by id,
// only if they are still exactly what was found.

use crate::fsx::{self, Identity};
use crate::tools::Progress;
use serde::Serialize;
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// The map keeps this many levels below the root.
pub const MAP_DEPTH: usize = 3;
/// Each folder shows this many children; the rest are summed as "others".
pub const MAP_CHILDREN: usize = 24;
pub const BIG_FILES: usize = 300;
pub const BIG_MIN: u64 = 10 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub name: String,
    /// Empty for the "others" bucket.
    pub path: String,
    pub bytes: u64,
    pub files: u64,
    pub children: Vec<Node>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Kind {
    pub kind: &'static str,
    pub bytes: u64,
    pub files: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BigFile {
    pub id: u64,
    pub name: String,
    pub folder: String,
    pub bytes: u64,
    pub modified: u64,
    pub kind: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub root: Node,
    pub kinds: Vec<Kind>,
    pub big: Vec<BigFile>,
    /// Folders that couldn't be read (no rights) or entries that vanished.
    pub unreadable: u64,
    pub cancelled: bool,
}

/// What kind of file a name is, by its extension.
pub fn kind_of(name: &str) -> &'static str {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "mp4" | "mkv" | "avi" | "mov" | "wmv" | "webm" | "m4v" | "flv" | "mpg" | "mpeg" | "3gp" | "ts" | "m2ts" => "video",
        "jpg" | "jpeg" | "png" | "gif" | "bmp" | "webp" | "heic" | "heif" | "raw" | "cr2" | "cr3" | "nef" | "arw" | "dng"
        | "psd" | "tif" | "tiff" | "svg" | "ico" | "avif" => "image",
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a" | "wma" | "opus" | "aiff" | "mid" => "music",
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "txt" | "odt" | "ods" | "odp" | "rtf" | "csv" | "md"
        | "epub" | "pages" | "key" | "numbers" => "document",
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" | "tgz" | "cab" | "zst" => "archive",
        "exe" | "msi" | "msix" | "msixbundle" | "appx" | "appxbundle" | "iso" | "img" | "vhd" | "vhdx" | "dmg" => "installer",
        "dll" | "sys" | "pak" | "vpk" | "bundle" | "assets" | "uasset" | "ucas" | "utoc" | "bin" | "dat" | "db" | "sqlite"
        | "cache" | "pdb" | "lib" | "so" | "jar" | "node" | "wasm" => "app",
        _ => "other",
    }
}

#[derive(Default)]
struct Tally {
    bytes: u64,
    files: u64,
}

/// Walks `root`. `keep` is told each big file found, and returns its id.
pub fn analyze(root: &Path, progress: &Progress, keep: &mut dyn FnMut(PathBuf, Identity) -> u64) -> Analysis {
    let mut folders: HashMap<PathBuf, Tally> = HashMap::new();
    let mut kinds: HashMap<&'static str, Tally> = HashMap::new();
    // The smallest of the biggest on top, so it's the one pushed out.
    let mut heap: BinaryHeap<Reverse<(u64, PathBuf, u128, u128, u64)>> = BinaryHeap::new();
    let mut unreadable = 0;
    let (mut total_bytes, mut total_files) = (0u64, 0u64);

    let walk = WalkDir::new(root).follow_links(false).same_file_system(true).into_iter();
    for entry in walk {
        if progress.cancelled() {
            break;
        }
        let entry = match entry {
            Ok(e) => e,
            Err(_) => {
                unreadable += 1;
                continue;
            }
        };
        let ft = entry.file_type();
        if !ft.is_file() || ft.is_symlink() {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            unreadable += 1;
            continue;
        };
        let size = meta.len();
        total_bytes += size;
        total_files += 1;
        let name = entry.file_name().to_string_lossy();
        let k = kinds.entry(kind_of(&name)).or_default();
        k.bytes += size;
        k.files += 1;

        // Its size counts in every mapped folder above it.
        if let Ok(rel) = entry.path().strip_prefix(root) {
            let parts: Vec<_> = rel.components().collect();
            let mut at = PathBuf::new();
            for c in parts.iter().take(parts.len().saturating_sub(1)).take(MAP_DEPTH) {
                at.push(c);
                let t = folders.entry(at.clone()).or_default();
                t.bytes += size;
                t.files += 1;
            }
        }

        if size >= BIG_MIN {
            let id = Identity::of(&meta);
            heap.push(Reverse((size, entry.path().to_path_buf(), id.modified, id.created, fsx::modified_ms(&meta))));
            if heap.len() > BIG_FILES {
                heap.pop();
            }
        }
        progress.tick(total_files, total_bytes, entry.path());
    }

    let mut big: Vec<_> = heap.into_iter().map(|Reverse(x)| x).collect();
    big.sort_by(|a, b| b.0.cmp(&a.0));
    let big = big
        .into_iter()
        .map(|(bytes, path, modified, created, ms)| {
            let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let folder = path.parent().map(|p| p.display().to_string()).unwrap_or_default();
            let kind = kind_of(&name);
            let id = keep(path, Identity { len: bytes, modified, created });
            BigFile { id, name, folder, bytes, modified: ms, kind }
        })
        .collect();

    let mut kinds: Vec<Kind> = kinds.into_iter().map(|(kind, t)| Kind { kind, bytes: t.bytes, files: t.files }).collect();
    kinds.sort_by(|a, b| b.bytes.cmp(&a.bytes));

    let root_name = root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| root.display().to_string());
    let node = Node {
        name: root_name,
        path: root.display().to_string(),
        bytes: total_bytes,
        files: total_files,
        children: children_of(root, Path::new(""), &folders, total_bytes, total_files),
    };
    Analysis { root: node, kinds, big, unreadable, cancelled: progress.cancelled() }
}

/// The mapped folders right under `rel`, biggest first, and the files beside them.
fn children_of(root: &Path, rel: &Path, folders: &HashMap<PathBuf, Tally>, bytes: u64, files: u64) -> Vec<Node> {
    let depth = rel.components().count();
    let mut kids: Vec<Node> = folders
        .iter()
        .filter(|(p, _)| p.parent() == Some(rel) && p.components().count() == depth + 1)
        .map(|(p, t)| Node {
            name: p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            path: root.join(p).display().to_string(),
            bytes: t.bytes,
            files: t.files,
            children: if depth + 1 < MAP_DEPTH { children_of(root, p, folders, t.bytes, t.files) } else { Vec::new() },
        })
        .collect();
    kids.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.name.cmp(&b.name)));
    let in_folders: u64 = kids.iter().map(|k| k.bytes).sum();
    let files_in_folders: u64 = kids.iter().map(|k| k.files).sum();
    let mut rest_bytes = bytes.saturating_sub(in_folders);
    let mut rest_files = files.saturating_sub(files_in_folders);
    if kids.len() > MAP_CHILDREN {
        for k in kids.drain(MAP_CHILDREN..) {
            rest_bytes += k.bytes;
            rest_files += k.files;
        }
    }
    if rest_bytes > 0 && !kids.is_empty() {
        kids.push(Node { name: String::new(), path: String::new(), bytes: rest_bytes, files: rest_files, children: Vec::new() });
    }
    kids
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(p: &Path, bytes: usize) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, vec![b'x'; bytes]).unwrap();
    }

    #[test]
    fn maps_folders_kinds_and_big_files() {
        let dir = crate::fsx::scratch();
        let r = dir.path();
        write(&r.join("Videos/trip/day1.mp4"), 3000);
        write(&r.join("Videos/trip/day2.mkv"), 2000);
        write(&r.join("Docs/a.pdf"), 500);
        write(&r.join("Docs/deep/er/still/b.txt"), 100);
        write(&r.join("loose.zip"), 50);
        let mut kept = Vec::new();
        let a = analyze(r, &Progress::quiet(), &mut |p, _| {
            kept.push(p);
            kept.len() as u64
        });
        assert_eq!(a.root.bytes, 5650);
        assert_eq!(a.root.files, 5);
        let names: Vec<_> = a.root.children.iter().map(|c| (c.name.as_str(), c.bytes)).collect();
        assert_eq!(names, vec![("Videos", 5000), ("Docs", 600), ("", 50)], "the loose file is the 'others' slice");
        let docs = &a.root.children[1];
        assert_eq!(docs.children[0].name, "deep");
        assert_eq!(docs.children[0].children[0].name, "er");
        assert!(docs.children[0].children[0].children.is_empty(), "three levels deep, no more");
        assert_eq!(docs.children[0].children[0].bytes, 100, "deeper files still count");
        assert_eq!(a.kinds[0].kind, "video");
        assert_eq!(a.kinds[0].bytes, 5000);
        assert!(a.big.is_empty(), "nothing over 10 MB here");
    }

    #[test]
    fn keeps_the_biggest_files() {
        let dir = crate::fsx::scratch();
        write(&dir.path().join("big.iso"), (BIG_MIN + 1) as usize);
        write(&dir.path().join("small.iso"), 10);
        let a = analyze(dir.path(), &Progress::quiet(), &mut |_, id| id.len);
        assert_eq!(a.big.len(), 1);
        assert_eq!(a.big[0].name, "big.iso");
        assert_eq!(a.big[0].kind, "installer");
        assert_eq!(a.big[0].id, BIG_MIN + 1);
    }

    #[cfg(unix)]
    #[test]
    fn never_through_a_link() {
        let dir = crate::fsx::scratch();
        let outside = crate::fsx::scratch();
        write(&outside.path().join("huge.bin"), 999);
        std::os::unix::fs::symlink(outside.path(), dir.path().join("link")).unwrap();
        let a = analyze(dir.path(), &Progress::quiet(), &mut |_, _| 0);
        assert_eq!(a.root.bytes, 0);
    }

    #[test]
    fn kinds_by_extension() {
        assert_eq!(kind_of("Clip.MP4"), "video");
        assert_eq!(kind_of("setup.exe"), "installer");
        assert_eq!(kind_of("noext"), "other");
        assert_eq!(kind_of("photo.heic"), "image");
    }
}
