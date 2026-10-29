// Software: the programs that start with Windows, and the installed programs
// with their own uninstallers. Following Kudu (MIT, Advent Development): the
// registry places it reads, which entries are hidden (system components and
// updates), and how an uninstall command is taken apart. Unlike Kudu,
// turning a startup program off is done the way Task Manager does it (the
// StartupApproved mark), so nothing is deleted and turning it on is exact.

// The pure helpers are used only by the Windows half; Linux runs their tests.
#![cfg_attr(not(windows), allow(dead_code))]

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StartupItem {
    pub id: u64,
    pub name: String,
    pub command: String,
    /// "user", "machine", "machine32", "userFolder" or "machineFolder".
    pub source: &'static str,
    pub enabled: bool,
    /// Changing it needs administrator rights (it's for everyone on the PC).
    pub admin: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Program {
    pub id: u64,
    pub name: String,
    pub publisher: String,
    pub version: String,
    /// YYYYMMDD as the installer wrote it, or empty.
    pub installed: String,
    pub bytes: u64,
    pub location: String,
    /// Only for you (not everyone on the PC).
    pub user: bool,
}

/// What the app keeps to act on a startup item later.
#[derive(Debug, Clone, PartialEq)]
pub struct StartupKey {
    pub source: &'static str,
    /// The value's name in StartupApproved (the Run value, or the file name).
    pub value: String,
}

/// What the app keeps to uninstall a program later.
#[derive(Debug, Clone, PartialEq)]
pub struct Uninstall {
    pub key: String,
    pub user: bool,
    pub command: String,
    pub msi: bool,
}

/// Whether a StartupApproved mark says "off". Task Manager writes 02 for on
/// and 03 for off in the first byte; Kudu also treats 06 as off.
pub fn approved_off(mark: &[u8]) -> bool {
    matches!(mark.first(), Some(0x03) | Some(0x06))
}

/// The mark Task Manager writes: on, or off since now (a FILETIME).
pub fn approved_mark(on: bool, filetime: u64) -> Vec<u8> {
    let mut v = vec![if on { 0x02 } else { 0x03 }, 0, 0, 0];
    v.extend_from_slice(&(if on { 0 } else { filetime }).to_le_bytes());
    v
}

/// An uninstall command split into program and arguments.
pub fn split_command(raw: &str, msi: bool) -> (String, Vec<String>) {
    let raw = raw.trim();
    if msi || raw.to_lowercase().contains("msiexec") {
        if let (Some(a), Some(b)) = (raw.find('{'), raw.find('}')) {
            if b > a {
                return ("msiexec.exe".into(), vec!["/x".into(), raw[a..=b].to_string()]);
            }
        }
    }
    if let Some(rest) = raw.strip_prefix('"') {
        if let Some(end) = rest.find('"') {
            return (rest[..end].to_string(), args(&rest[end + 1..]));
        }
    }
    let lower = raw.to_lowercase();
    if let Some(i) = lower.find(".exe") {
        return (raw[..i + 4].to_string(), args(&raw[i + 4..]));
    }
    (raw.to_string(), Vec::new())
}

fn args(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    for c in s.trim().chars() {
        match c {
            '"' => quoted = !quoted,
            ' ' if !quoted => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
            _ => cur.push(c),
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// Entries that aren't programs you installed: Windows' parts and updates.
pub fn hidden_entry(system_component: u32, parent_key: &str, release_type: &str) -> bool {
    system_component == 1 || !parent_key.is_empty() || ["update", "hotfix", "security update", "service pack"].contains(&release_type.to_lowercase().as_str())
}

#[cfg(windows)]
mod win {
    use super::*;
    use winreg::enums::*;
    use winreg::RegKey;

    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const RUN32: &str = r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run";
    const APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved";

    fn approved_key(source: &str) -> (RegKey, &'static str) {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        match source {
            "user" => (hkcu, "Run"),
            "machine" => (hklm, "Run"),
            "machine32" => (hklm, "Run32"),
            "userFolder" => (hkcu, "StartupFolder"),
            _ => (hklm, "StartupFolder"),
        }
    }

    fn is_off(source: &str, value: &str) -> bool {
        let (root, sub) = approved_key(source);
        root.open_subkey(format!(r"{APPROVED}\{sub}"))
            .and_then(|k| k.get_raw_value(value))
            .map(|v| approved_off(&v.bytes))
            .unwrap_or(false)
    }

    pub fn startup(keep: &mut dyn FnMut(StartupKey) -> u64) -> Vec<StartupItem> {
        let mut out = Vec::new();
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        for (root, path, source) in [(&hkcu, RUN, "user"), (&hklm, RUN, "machine"), (&hklm, RUN32, "machine32")] {
            let Ok(k) = root.open_subkey(path) else { continue };
            for (name, _) in k.enum_values().flatten() {
                let command: String = k.get_value(&name).unwrap_or_default();
                if name.is_empty() {
                    continue;
                }
                let enabled = !is_off(source, &name);
                let id = keep(StartupKey { source, value: name.clone() });
                out.push(StartupItem { id, name, command, source, enabled, admin: source != "user" });
            }
        }
        let folders = [
            (std::env::var("APPDATA").ok().map(|a| format!(r"{a}\Microsoft\Windows\Start Menu\Programs\Startup")), "userFolder"),
            (std::env::var("ProgramData").ok().map(|a| format!(r"{a}\Microsoft\Windows\Start Menu\Programs\StartUp")), "machineFolder"),
        ];
        for (dir, source) in folders {
            let Some(dir) = dir else { continue };
            for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
                let file = e.file_name().to_string_lossy().to_string();
                if file.eq_ignore_ascii_case("desktop.ini") || !e.path().is_file() {
                    continue;
                }
                let name = file.rsplit_once('.').map(|(n, _)| n.to_string()).unwrap_or(file.clone());
                let enabled = !is_off(source, &file);
                let id = keep(StartupKey { source, value: file });
                out.push(StartupItem { id, name, command: e.path().display().to_string(), source, enabled, admin: source == "machineFolder" });
            }
        }
        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        out
    }

    pub fn set_startup(k: &StartupKey, on: bool) -> Result<(), String> {
        let (root, sub) = approved_key(k.source);
        let (key, _) = root.create_subkey(format!(r"{APPROVED}\{sub}")).map_err(|e| e.to_string())?;
        let ft = {
            // FILETIME: 100 ns steps since 1601.
            let unix = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() / 100).unwrap_or(0) as u64;
            unix + 116_444_736_000_000_000
        };
        let value = winreg::RegValue { vtype: REG_BINARY, bytes: approved_mark(on, ft) };
        key.set_raw_value(&k.value, &value).map_err(|e| e.to_string())
    }

    pub fn programs(keep: &mut dyn FnMut(Uninstall) -> u64) -> Vec<Program> {
        let mut out: Vec<Program> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let roots = [
            (HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\Uninstall", false),
            (HKEY_LOCAL_MACHINE, r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall", false),
            (HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Uninstall", true),
        ];
        for (hive, path, user) in roots {
            let Ok(list) = RegKey::predef(hive).open_subkey(path) else { continue };
            for sub in list.enum_keys().flatten() {
                let Ok(k) = list.open_subkey(&sub) else { continue };
                let s = |n: &str| k.get_value::<String, _>(n).unwrap_or_default();
                let d = |n: &str| k.get_value::<u32, _>(n).unwrap_or(0);
                let name = s("DisplayName");
                let command = s("UninstallString");
                if name.trim().is_empty() || command.trim().is_empty() || hidden_entry(d("SystemComponent"), &s("ParentKeyName"), &s("ReleaseType")) {
                    continue;
                }
                let publisher = s("Publisher");
                if !seen.insert(format!("{}|{}", name.to_lowercase(), publisher.to_lowercase())) {
                    continue;
                }
                let id = keep(Uninstall { key: format!(r"{path}\{sub}"), user, command, msi: d("WindowsInstaller") == 1 });
                out.push(Program {
                    id,
                    name: name.trim().to_string(),
                    publisher,
                    version: s("DisplayVersion"),
                    installed: s("InstallDate"),
                    bytes: d("EstimatedSize") as u64 * 1024,
                    location: s("InstallLocation").trim_end_matches('\\').to_string(),
                    user,
                });
            }
        }
        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        out
    }

    /// Whether the program's entry is still there.
    pub fn still_installed(u: &Uninstall) -> bool {
        RegKey::predef(if u.user { HKEY_CURRENT_USER } else { HKEY_LOCAL_MACHINE }).open_subkey(&u.key).is_ok()
    }

    /// Opens the program's own uninstaller (Windows asks for permission if it
    /// needs it) and waits for it to finish, up to 30 minutes.
    pub fn run_uninstaller(u: &Uninstall) -> Result<(), String> {
        use windows::core::{w, HSTRING, PCWSTR};
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Threading::WaitForSingleObject;
        use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let (program, args) = split_command(&u.command, u.msi);
        let params = args.iter().map(|a| if a.contains(' ') { format!("\"{a}\"") } else { a.clone() }).collect::<Vec<_>>().join(" ");
        let file = HSTRING::from(program);
        let params = HSTRING::from(params);
        let mut info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_NOCLOSEPROCESS,
            lpVerb: w!("open"),
            lpFile: PCWSTR(file.as_ptr()),
            lpParameters: PCWSTR(params.as_ptr()),
            nShow: SW_SHOWNORMAL.0,
            ..Default::default()
        };
        unsafe {
            ShellExecuteExW(&mut info).map_err(|e| e.to_string())?;
            if !info.hProcess.is_invalid() {
                WaitForSingleObject(info.hProcess, 30 * 60 * 1000);
                let _ = CloseHandle(info.hProcess);
            }
        }
        Ok(())
    }
}

#[cfg(windows)]
pub use win::{programs, run_uninstaller, set_startup, startup, still_installed};

#[cfg(not(windows))]
pub fn startup(_keep: &mut dyn FnMut(StartupKey) -> u64) -> Vec<StartupItem> {
    Vec::new()
}
#[cfg(not(windows))]
pub fn set_startup(_k: &StartupKey, _on: bool) -> Result<(), String> {
    Err("windows".into())
}
#[cfg(not(windows))]
pub fn programs(_keep: &mut dyn FnMut(Uninstall) -> u64) -> Vec<Program> {
    Vec::new()
}
#[cfg(not(windows))]
pub fn still_installed(_u: &Uninstall) -> bool {
    true
}
#[cfg(not(windows))]
pub fn run_uninstaller(_u: &Uninstall) -> Result<(), String> {
    Err("windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_and_writes_task_managers_marks() {
        assert!(!approved_off(&[0x02, 0, 0, 0]));
        assert!(approved_off(&[0x03, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8]));
        assert!(!approved_off(&[]));
        let off = approved_mark(false, 0x0102030405060708);
        assert_eq!(off.len(), 12);
        assert!(approved_off(&off));
        assert_eq!(&off[4..], &0x0102030405060708u64.to_le_bytes());
        assert_eq!(approved_mark(true, 99), vec![2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    }

    #[test]
    fn takes_uninstall_commands_apart() {
        assert_eq!(
            split_command(r#""C:\Program Files\App\unins000.exe" /SILENT"#, false),
            (r"C:\Program Files\App\unins000.exe".to_string(), vec!["/SILENT".to_string()])
        );
        assert_eq!(
            split_command("MsiExec.exe /I{12345678-ABCD-1234-ABCD-1234567890AB}", false),
            ("msiexec.exe".to_string(), vec!["/x".to_string(), "{12345678-ABCD-1234-ABCD-1234567890AB}".to_string()])
        );
        assert_eq!(
            split_command(r#"C:\Apps\x\uninstall.exe --mode "a b""#, false),
            (r"C:\Apps\x\uninstall.exe".to_string(), vec!["--mode".to_string(), "a b".to_string()])
        );
        assert_eq!(split_command("weird", false), ("weird".to_string(), vec![]));
    }

    #[test]
    fn hides_windows_parts_and_updates() {
        assert!(hidden_entry(1, "", ""));
        assert!(hidden_entry(0, "Office16", ""));
        assert!(hidden_entry(0, "", "Security Update"));
        assert!(!hidden_entry(0, "", ""));
    }
}
