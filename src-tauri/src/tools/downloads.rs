// Downloads review: the files sitting in your Downloads folder (not its
// subfolders), what they are and how old, so the installers and archives you
// already used can go to the Recycle Bin. Downloads still in progress, links
// and hidden files are left out. Like Kudu's (MIT, Advent Development).

use crate::fsx::{self, Identity};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Download {
    pub id: u64,
    pub name: String,
    pub bytes: u64,
    pub modified: u64,
    /// "installer", "archive", "diskImage" or "other".
    pub kind: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub folder: String,
    pub files: Vec<Download>,
}

pub fn kind_of(name: &str) -> &'static str {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "exe" | "msi" | "msix" | "msixbundle" | "appx" | "appxbundle" => "installer",
        "zip" | "7z" | "rar" | "tar" | "gz" | "bz2" | "xz" | "tgz" => "archive",
        "iso" | "img" | "vhd" | "vhdx" => "diskImage",
        _ => "other",
    }
}

/// Still downloading, or hidden.
pub fn incomplete(name: &str) -> bool {
    let lower = name.to_lowercase();
    name.starts_with('.') || [".crdownload", ".part", ".partial", ".download", ".tmp", ".temp", ".opdownload"].iter().any(|e| lower.ends_with(e))
}

/// Your Downloads folder, wherever Windows has it.
#[cfg(windows)]
pub fn folder() -> PathBuf {
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{FOLDERID_Downloads, SHGetKnownFolderPath, KF_FLAG_DEFAULT};
    unsafe {
        if let Ok(p) = SHGetKnownFolderPath(&FOLDERID_Downloads, KF_FLAG_DEFAULT, None) {
            let s = p.to_string().unwrap_or_default();
            CoTaskMemFree(Some(p.0 as *const _));
            if !s.is_empty() {
                return PathBuf::from(s);
            }
        }
    }
    fsx::home().join("Downloads")
}

#[cfg(not(windows))]
pub fn folder() -> PathBuf {
    fsx::home().join("Downloads")
}

pub fn find(dir: &Path, keep: &mut dyn FnMut(PathBuf, Identity) -> u64) -> Found {
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for e in entries.flatten().take(20_000) {
            let name = e.file_name().to_string_lossy().to_string();
            if incomplete(&name) {
                continue;
            }
            let Ok(m) = std::fs::symlink_metadata(e.path()) else { continue };
            if !m.file_type().is_file() || m.file_type().is_symlink() {
                continue;
            }
            let id = keep(e.path(), Identity::of(&m));
            files.push(Download { id, kind: kind_of(&name), name, bytes: m.len(), modified: fsx::modified_ms(&m) });
        }
    }
    files.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    Found { folder: dir.display().to_string(), files }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn lists_finished_files_only() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        fs::write(d.join("setup.exe"), vec![0; 300]).unwrap();
        fs::write(d.join("photos.zip"), vec![0; 200]).unwrap();
        fs::write(d.join("movie.mp4.crdownload"), vec![0; 900]).unwrap();
        fs::write(d.join(".hidden"), "x").unwrap();
        fs::create_dir(d.join("folder")).unwrap();
        fs::write(d.join("folder/inner.exe"), "x").unwrap();
        let found = find(d, &mut |_, id| id.len);
        let names: Vec<_> = found.files.iter().map(|f| (f.name.as_str(), f.kind)).collect();
        assert_eq!(names, vec![("setup.exe", "installer"), ("photos.zip", "archive")]);
        assert_eq!(found.files[0].id, 300);
    }

    #[test]
    fn knows_unfinished_downloads() {
        assert!(incomplete("a.iso.part"));
        assert!(incomplete("Unconfirmed 1234.crdownload"));
        assert!(!incomplete("report.pdf"));
        assert_eq!(kind_of("Win11.ISO"), "diskImage");
    }
}
