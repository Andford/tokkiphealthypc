// Protection: Windows Defender (status, quick scan, updates, what it found),
// privacy switches and traces, the firewall, and a few safer settings.
// Following Kudu (MIT, Advent Development): its Privacy Shield's registry
// switches (rules/privacy.json), its traces, and its firewall review. Unlike
// Kudu's, a switch puts back the exact value it had before, not Windows'
// default; the security switches are ours.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Privacy switches ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Switch {
    pub id: String,
    /// "telemetry", "ads", "search", "sync", "ai", "browsers" or "security".
    pub group: String,
    pub name: String,
    pub name_en: String,
    /// "HKCU\..." or "HKLM\...".
    pub key: String,
    pub value: String,
    pub private: u32,
    pub admin: bool,
}

#[derive(Deserialize)]
struct Switches {
    switches: Vec<Switch>,
}

pub fn switches() -> Vec<Switch> {
    serde_json::from_str::<Switches>(include_str!("../../../rules/privacy.json")).map(|s| s.switches).unwrap_or_default()
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SwitchState {
    #[serde(flatten)]
    pub switch: Switch,
    /// Already private (or safer).
    pub on: bool,
    /// Healthy PC changed it and can put it back.
    pub ours: bool,
}

/// "HKLM\SOFTWARE\x" → (machine?, "SOFTWARE\x").
pub fn split_key(key: &str) -> Option<(bool, &str)> {
    let (hive, rest) = key.split_once('\\')?;
    match hive {
        "HKLM" => Some((true, rest)),
        "HKCU" => Some((false, rest)),
        _ => None,
    }
}

/// What each switch had before Healthy PC changed it (None: the value didn't exist).
pub type Before = HashMap<String, Option<u32>>;

#[cfg(windows)]
pub mod reg {
    use winreg::enums::*;
    use winreg::RegKey;

    fn root(machine: bool) -> RegKey {
        RegKey::predef(if machine { HKEY_LOCAL_MACHINE } else { HKEY_CURRENT_USER })
    }
    pub fn get(machine: bool, key: &str, value: &str) -> Option<u32> {
        root(machine).open_subkey(key).ok()?.get_value::<u32, _>(value).ok()
    }
    pub fn set(machine: bool, key: &str, value: &str, data: Option<u32>) -> Result<(), String> {
        let (k, _) = root(machine).create_subkey(key).map_err(|e| e.to_string())?;
        match data {
            Some(d) => k.set_value(value, &d).map_err(|e| e.to_string()),
            None => match k.delete_value(value) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(e) => Err(e.to_string()),
            },
        }
    }
}

#[cfg(not(windows))]
pub mod reg {
    pub fn get(_m: bool, _k: &str, _v: &str) -> Option<u32> {
        None
    }
    pub fn set(_m: bool, _k: &str, _v: &str, _d: Option<u32>) -> Result<(), String> {
        Err("windows".into())
    }
}

pub fn switch_states(before: &Before) -> Vec<SwitchState> {
    switches()
        .into_iter()
        .filter_map(|s| {
            let (machine, key) = split_key(&s.key)?;
            let on = reg::get(machine, key, &s.value) == Some(s.private);
            let ours = before.contains_key(&s.id);
            Some(SwitchState { switch: s, on, ours })
        })
        .collect()
}

/// Turns a switch on (private) or back to what it was. Updates `before`.
pub fn set_switch(id: &str, on: bool, before: &mut Before) -> Result<(), String> {
    let s = switches().into_iter().find(|s| s.id == id).ok_or("unknown")?;
    let (machine, key) = split_key(&s.key).ok_or("key")?;
    if on {
        let had = reg::get(machine, key, &s.value);
        reg::set(machine, key, &s.value, Some(s.private))?;
        before.entry(s.id.clone()).or_insert(had);
    } else {
        // Back to what it had; if Healthy PC never changed it, to Windows' default (no value).
        let had = before.remove(&s.id).unwrap_or(None);
        reg::set(machine, key, &s.value, had)?;
    }
    Ok(())
}

// ── Traces ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Trace {
    /// "recent", "jumplists", "run" or "typed".
    pub id: &'static str,
    pub items: u64,
    pub bytes: u64,
}

fn recent_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("APPDATA").map(|a| std::path::PathBuf::from(a).join(r"Microsoft\Windows\Recent"))
}

fn files_in(dir: &std::path::Path) -> Vec<(std::path::PathBuf, u64)> {
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let m = std::fs::symlink_metadata(e.path()).ok()?;
            (m.is_file() && e.file_name() != "desktop.ini").then(|| (e.path(), m.len()))
        })
        .collect()
}

fn trace_files(id: &str) -> Vec<(std::path::PathBuf, u64)> {
    let Some(recent) = recent_dir() else { return Vec::new() };
    match id {
        "recent" => files_in(&recent),
        "jumplists" => [files_in(&recent.join("AutomaticDestinations")), files_in(&recent.join("CustomDestinations"))].concat(),
        _ => Vec::new(),
    }
}

const RUN_MRU: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\RunMRU";
const TYPED_PATHS: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\TypedPaths";

#[cfg(windows)]
fn reg_values(key: &str) -> u64 {
    winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER).open_subkey(key).map(|k| k.enum_values().count() as u64).unwrap_or(0)
}
#[cfg(windows)]
fn clear_values(key: &str) -> u64 {
    use winreg::enums::*;
    let Ok(k) = winreg::RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(key, KEY_ALL_ACCESS) else { return 0 };
    let names: Vec<String> = k.enum_values().flatten().map(|(n, _)| n).collect();
    names.iter().filter(|n| k.delete_value(n).is_ok()).count() as u64
}
#[cfg(not(windows))]
fn reg_values(_key: &str) -> u64 {
    0
}
#[cfg(not(windows))]
fn clear_values(_key: &str) -> u64 {
    0
}

pub fn traces() -> Vec<Trace> {
    let mut out: Vec<Trace> = ["recent", "jumplists"]
        .into_iter()
        .map(|id| {
            let f = trace_files(id);
            Trace { id, items: f.len() as u64, bytes: f.iter().map(|x| x.1).sum() }
        })
        .collect();
    out.push(Trace { id: "run", items: reg_values(RUN_MRU), bytes: 0 });
    out.push(Trace { id: "typed", items: reg_values(TYPED_PATHS), bytes: 0 });
    out
}

/// Clears these traces; returns how many items went.
pub fn clear_traces(ids: &[String]) -> u64 {
    let mut n = 0;
    for id in ids {
        match id.as_str() {
            "recent" | "jumplists" => {
                for (p, _) in trace_files(id) {
                    if std::fs::remove_file(p).is_ok() {
                        n += 1;
                    }
                }
            }
            "run" => n += clear_values(RUN_MRU),
            "typed" => n += clear_values(TYPED_PATHS),
            _ => {}
        }
    }
    n
}

// ── Defender ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Defender {
    /// Defender answers (it isn't replaced by another antivirus, or missing).
    pub available: bool,
    pub realtime: bool,
    pub antivirus: bool,
    /// ms since 1970; 0 = unknown.
    pub signatures: u64,
    pub quick_scan: u64,
    pub full_scan: u64,
    pub threats: Vec<Threat>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Threat {
    pub name: String,
    pub active: bool,
    pub severity: u32,
    pub files: Vec<String>,
}

/// Windows PowerShell 5 writes dates as "/Date(1700000000000)/".
pub fn ps_date(v: &serde_json::Value) -> u64 {
    let s = v.as_str().unwrap_or_default();
    s.split(['(', ')', '+', '-']).nth(1).and_then(|n| n.parse::<u64>().ok()).unwrap_or(0)
}

fn as_list(v: serde_json::Value) -> Vec<serde_json::Value> {
    match v {
        serde_json::Value::Array(a) => a,
        serde_json::Value::Null => Vec::new(),
        one => vec![one],
    }
}

pub fn parse_defender(status: &str, threats: &str) -> Defender {
    let Ok(s) = serde_json::from_str::<serde_json::Value>(status.trim()) else { return Defender::default() };
    let threats = as_list(serde_json::from_str(threats.trim()).unwrap_or(serde_json::Value::Null))
        .into_iter()
        .map(|t| Threat {
            name: t["ThreatName"].as_str().unwrap_or("?").to_string(),
            active: t["IsActive"].as_bool().unwrap_or(false),
            severity: t["SeverityID"].as_u64().unwrap_or(0) as u32,
            files: as_list(t["Resources"].clone()).iter().filter_map(|r| r.as_str().map(|s| s.trim_start_matches("file:_").to_string())).collect(),
        })
        .collect();
    Defender {
        available: s["AMServiceEnabled"].as_bool().unwrap_or(false),
        realtime: s["RealTimeProtectionEnabled"].as_bool().unwrap_or(false),
        antivirus: s["AntivirusEnabled"].as_bool().unwrap_or(false),
        signatures: ps_date(&s["AntivirusSignatureLastUpdated"]),
        quick_scan: ps_date(&s["QuickScanEndTime"]),
        full_scan: ps_date(&s["FullScanEndTime"]),
        threats,
    }
}

// ── Firewall ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Firewall {
    /// Profiles ("Domain", "Private", "Public") that are off.
    pub off: Vec<String>,
    /// Inbound rules that let in a program that's no longer on the PC.
    pub stale: Vec<StaleRule>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StaleRule {
    pub name: String,
    pub display: String,
    pub program: String,
}

pub fn parse_firewall(profiles: &str, rules: &str, exists: &dyn Fn(&str) -> bool) -> Firewall {
    let off = as_list(serde_json::from_str(profiles.trim()).unwrap_or(serde_json::Value::Null))
        .iter()
        // Enabled is 1/0 (GpoBoolean) or true/false.
        .filter(|p| !(p["Enabled"].as_bool().unwrap_or(false) || p["Enabled"].as_u64() == Some(1)))
        .filter_map(|p| p["Name"].as_str().map(String::from))
        .collect();
    let stale = as_list(serde_json::from_str(rules.trim()).unwrap_or(serde_json::Value::Null))
        .iter()
        .filter_map(|r| {
            let program = r["Program"].as_str()?.to_string();
            let p = program.to_lowercase();
            if p.is_empty() || p == "any" || p == "system" || exists(&program) {
                return None;
            }
            Some(StaleRule { name: r["Name"].as_str()?.to_string(), display: r["DisplayName"].as_str().unwrap_or_default().to_string(), program })
        })
        .collect();
    Firewall { off, stale }
}

/// Quoted for a PowerShell single-quoted string.
pub fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn switches_are_well_formed() {
        let all = switches();
        assert!(all.len() >= 40);
        for s in &all {
            let (machine, _) = split_key(&s.key).unwrap_or_else(|| panic!("{}", s.id));
            assert_eq!(machine, s.admin, "{}", s.id);
        }
        let mut ids: Vec<_> = all.iter().map(|s| &s.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), all.len());
    }

    #[test]
    fn reads_defender() {
        let status = r#"{"AMServiceEnabled":true,"AntivirusEnabled":true,"RealTimeProtectionEnabled":true,
            "AntivirusSignatureLastUpdated":"\/Date(1761700000000)\/","QuickScanEndTime":"\/Date(1761600000000)\/","FullScanEndTime":null}"#;
        let threats = r#"{"ThreatName":"Trojan:Win32/Wacatac","IsActive":false,"SeverityID":5,"Resources":["file:_C:\\x\\bad.exe"]}"#;
        let d = parse_defender(status, threats);
        assert!(d.available && d.realtime);
        assert_eq!((d.signatures, d.quick_scan, d.full_scan), (1761700000000, 1761600000000, 0));
        assert_eq!(d.threats[0].files, vec![r"C:\x\bad.exe".to_string()]);
        assert!(!parse_defender("", "").available);
    }

    #[test]
    fn finds_rules_for_missing_programs() {
        let profiles = r#"[{"Name":"Domain","Enabled":1},{"Name":"Private","Enabled":true},{"Name":"Public","Enabled":0}]"#;
        let rules = r#"[{"Name":"a","DisplayName":"Old game","Program":"C:\\Games\\old.exe"},
                       {"Name":"b","DisplayName":"Chrome","Program":"C:\\Chrome\\chrome.exe"},
                       {"Name":"c","DisplayName":"Core","Program":"System"}]"#;
        let f = parse_firewall(profiles, rules, &|p| p.contains("chrome"));
        assert_eq!(f.off, vec!["Public".to_string()]);
        assert_eq!(f.stale.len(), 1);
        assert_eq!(f.stale[0].display, "Old game");
        assert_eq!(ps_quote("it's"), "'it''s'");
    }
}
