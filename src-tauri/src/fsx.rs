// What every tool that touches your files shares: telling whether a file is
// still the one we found, the folders never to touch, the Recycle Bin, and
// "show in folder". The protected names and the identity checks before
// deleting follow Kudu's (MIT, Advent Development): see THIRD-PARTY-NOTICES.md.

use std::fs::Metadata;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

/// What a file was when a scan found it. A file that changed (or was swapped
/// for another, or for a link) since then is never deleted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Identity {
    pub len: u64,
    pub modified: u128,
    pub created: u128,
}

fn nanos(t: std::io::Result<std::time::SystemTime>) -> u128 {
    t.ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_nanos()).unwrap_or(0)
}

impl Identity {
    pub fn of(m: &Metadata) -> Identity {
        Identity { len: m.len(), modified: nanos(m.modified()), created: nanos(m.created()) }
    }
}

/// A regular file's identity; None for links, folders and what isn't there.
pub fn identity(path: &Path) -> Option<Identity> {
    let m = std::fs::symlink_metadata(path).ok()?;
    (m.file_type().is_file() && !m.file_type().is_symlink()).then(|| Identity::of(&m))
}

/// Milliseconds since 1970 that a file was last changed.
pub fn modified_ms(m: &Metadata) -> u64 {
    (nanos(m.modified()) / 1_000_000) as u64
}

/// Folders that are Windows' or a program's own: never scanned for deletion,
/// never deleted, whatever is chosen.
const PROTECTED_WINDOWS: &[&str] = &[
    "windows", "system32", "syswow64", "winsxs", "program files", "program files (x86)", "programdata",
    "recovery", "boot", "$recycle.bin", "system volume information", "perflogs", "msocache", "config.msi",
    "drivers", "inf", "$windows.~bt", "$windows.~ws", "$winreagent", "windowsapps",
];
const PROTECTED_ANYWHERE: &[&str] = &[
    ".git", ".svn", ".hg", "node_modules", ".npm", ".cache", ".local", "__pycache__", ".venv", ".ssh",
    ".gnupg", ".config", "appdata", ".android", ".gradle", ".cargo", ".rustup",
];
const PROTECTED_UNIX: &[&str] = &[
    "bin", "sbin", "usr", "etc", "var", "lib", "lib64", "opt", "boot", "dev", "proc", "sys", "run", "snap", "root",
    "lost+found",
];
/// The folders of your profile itself (not what's inside them).
const PROFILE_FOLDERS: &[&str] = &["desktop", "documents", "downloads", "pictures", "videos", "music", "onedrive"];

fn names(path: &Path) -> Vec<String> {
    path.components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().to_lowercase()),
            _ => None,
        })
        .collect()
}

/// Inside a protected folder (anywhere along the path).
pub fn in_protected_tree(path: &Path, home: &Path) -> bool {
    let inside_home = path.strip_prefix(home).ok();
    let checked: Vec<String> = match inside_home {
        // The home itself may sit under a protected name (/var/home/ana); only what's below counts.
        Some(rest) => names(rest),
        None => names(path),
    };
    checked.iter().any(|n| {
        PROTECTED_ANYWHERE.contains(&n.as_str())
            || (inside_home.is_none() && (PROTECTED_WINDOWS.contains(&n.as_str()) || (cfg!(unix) && PROTECTED_UNIX.contains(&n.as_str()))))
    })
}

/// Never deleted as a whole: a drive or its top folders, a protected folder,
/// your profile folder, or Desktop, Documents, Downloads… themselves.
pub fn is_protected(path: &Path, home: &Path) -> bool {
    let depth = names(path).len();
    if depth <= 1 {
        return true;
    }
    if path == home || in_protected_tree(path, home) {
        return true;
    }
    if let Ok(rest) = path.strip_prefix(home) {
        let rest = names(rest);
        if rest.len() == 1 && PROFILE_FOLDERS.contains(&rest[0].as_str()) {
            return true;
        }
    }
    // Profiles of other people (C:\Users\someone) stay too.
    path.parent().map(|p| p == home.parent().unwrap_or(home)).unwrap_or(false)
}

/// Your profile folder (%USERPROFILE%, $HOME).
pub fn home() -> PathBuf {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

/// To the Recycle Bin, where it can be put back.
pub fn to_trash(path: &Path) -> Result<(), String> {
    trash::delete(path).map_err(|e| e.to_string())
}

/// Opens the file's folder with the file selected.
#[cfg(windows)]
pub fn reveal(path: &Path) {
    use std::os::windows::process::CommandExt;
    // Explorer wants `/select,"path"` as one argument, quoted its own way.
    let _ = std::process::Command::new("explorer.exe").raw_arg(format!("/select,\"{}\"", path.display())).spawn();
}

#[cfg(not(windows))]
pub fn reveal(path: &Path) {
    let dir = path.parent().unwrap_or(path);
    let _ = std::process::Command::new("xdg-open").arg(dir).spawn();
}

/// A scratch folder for tests, under target/ rather than the system's temp
/// folder: on Windows that one is inside AppData, which the tools protect.
#[cfg(test)]
pub fn scratch() -> tempfile::TempDir {
    let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("target").join("scratch");
    let _ = std::fs::create_dir_all(&base);
    tempfile::Builder::new().prefix("t").tempdir_in(base).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> PathBuf {
        PathBuf::from(s)
    }

    #[test]
    fn protects_what_must_stay() {
        let home = p("/home/ana");
        assert!(is_protected(&p("/"), &home));
        assert!(is_protected(&p("/data"), &home), "top-level folders");
        assert!(is_protected(&home, &home));
        assert!(is_protected(&p("/home/ana/Documents"), &home));
        assert!(is_protected(&p("/home/ana/projects/app/node_modules"), &home));
        assert!(is_protected(&p("/home/ana/projects/.git/objects"), &home));
        assert!(is_protected(&p("/home/beto"), &home), "another person's profile");
        assert!(!is_protected(&p("/home/ana/Documents/old"), &home));
        assert!(!is_protected(&p("/home/ana/Downloads/setup.exe"), &home));
        assert!(!is_protected(&p("/data/photos/2019"), &home));
    }

    #[test]
    fn windows_folders_are_protected_by_name() {
        let home = p("/Users/ana");
        assert!(in_protected_tree(&p("/Windows/System32/x"), &home));
        assert!(in_protected_tree(&p("/Program Files/App/cache"), &home));
        assert!(in_protected_tree(&p("/Users/ana/AppData/Local/Temp"), &home));
        assert!(!in_protected_tree(&p("/Users/ana/Videos/clip.mp4"), &home));
    }

    #[test]
    fn identity_tells_a_changed_file() {
        let dir = crate::fsx::scratch();
        let f = dir.path().join("a.bin");
        std::fs::write(&f, b"hello").unwrap();
        let before = identity(&f).unwrap();
        assert_eq!(identity(&f), Some(before));
        std::fs::write(&f, b"hello, world").unwrap();
        assert_ne!(identity(&f), Some(before));
        assert_eq!(identity(dir.path()), None, "folders have none");
    }
}
