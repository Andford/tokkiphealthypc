// What the tools ask of the system. On Windows, the real thing; elsewhere
// (tests, development on Linux) a quiet stand-in.

use std::collections::HashSet;

/// Names of the running programs, lowercase ("chrome.exe").
pub fn running_processes() -> HashSet<String> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};
    let mut sys = System::new_with_specifics(RefreshKind::nothing().with_processes(ProcessRefreshKind::nothing()));
    sys.refresh_processes(ProcessesToUpdate::All, true);
    sys.processes().values().map(|p| p.name().to_string_lossy().to_lowercase()).collect()
}

/// The app runs as administrator.
#[cfg(windows)]
pub fn is_elevated() -> bool {
    unsafe { windows::Win32::UI::Shell::IsUserAnAdmin().as_bool() }
}

#[cfg(not(windows))]
pub fn is_elevated() -> bool {
    false
}

/// Opens this app again as administrator (Windows asks first). True if it started.
#[cfg(windows)]
pub fn relaunch_elevated() -> bool {
    use windows::core::{w, HSTRING, PCWSTR};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let Ok(exe) = std::env::current_exe() else { return false };
    let exe = HSTRING::from(exe.as_os_str());
    let r = unsafe { ShellExecuteW(None, w!("runas"), &exe, PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
    // Above 32 means it started.
    r.0 as isize > 32
}

#[cfg(not(windows))]
pub fn relaunch_elevated() -> bool {
    false
}

/// What the Recycle Bin holds, on every drive: (bytes, items).
#[cfg(windows)]
pub fn recycle_bin_size() -> (u64, u64) {
    use windows::Win32::UI::Shell::{SHQueryRecycleBinW, SHQUERYRBINFO};
    let mut info = SHQUERYRBINFO { cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32, ..Default::default() };
    match unsafe { SHQueryRecycleBinW(None, &mut info) } {
        Ok(()) => (info.i64Size.max(0) as u64, info.i64NumItems.max(0) as u64),
        Err(_) => (0, 0),
    }
}

#[cfg(not(windows))]
pub fn recycle_bin_size() -> (u64, u64) {
    (0, 0)
}

/// Empties it, without Windows' own dialog, progress or sound.
#[cfg(windows)]
pub fn empty_recycle_bin() -> bool {
    use windows::Win32::UI::Shell::{SHEmptyRecycleBinW, SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI, SHERB_NOSOUND};
    unsafe { SHEmptyRecycleBinW(None, None, SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND).is_ok() }
}

#[cfg(not(windows))]
pub fn empty_recycle_bin() -> bool {
    false
}

/// The system drive's space: (total, free) in bytes.
pub fn system_disk() -> (u64, u64) {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let system = std::env::var("SystemDrive").map(|d| format!("{d}\\")).unwrap_or_else(|_| "/".into());
    let pick = disks
        .list()
        .iter()
        .find(|d| d.mount_point().to_string_lossy().eq_ignore_ascii_case(&system))
        .or_else(|| disks.list().iter().max_by_key(|d| d.total_space()));
    pick.map(|d| (d.total_space(), d.available_space())).unwrap_or((0, 0))
}

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    /// Where it is mounted: "C:\\", "D:\\" (or "/" elsewhere).
    pub root: String,
    pub label: String,
    pub total: u64,
    pub free: u64,
    pub system: bool,
    pub removable: bool,
}

/// The drives you can analyze: fixed and removable, not network ones.
pub fn drives() -> Vec<Drive> {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let system = std::env::var("SystemDrive").map(|d| format!("{d}\\")).unwrap_or_else(|_| "/".into());
    let mut out: Vec<Drive> = disks
        .list()
        .iter()
        .filter(|d| d.total_space() > 0)
        .filter(|d| {
            let fs = d.file_system().to_string_lossy().to_lowercase();
            !["nfs", "cifs", "smb", "smbfs", "fuse.sshfs", "tmpfs", "overlay", "squashfs"].iter().any(|n| fs.starts_with(n))
        })
        .map(|d| {
            let root = d.mount_point().to_string_lossy().to_string();
            Drive {
                system: root.eq_ignore_ascii_case(&system),
                label: d.name().to_string_lossy().to_string(),
                root,
                total: d.total_space(),
                free: d.available_space(),
                removable: d.is_removable(),
            }
        })
        .collect();
    out.sort_by(|a, b| b.system.cmp(&a.system).then_with(|| a.root.cmp(&b.root)));
    out.dedup_by(|a, b| a.root == b.root);
    out
}
