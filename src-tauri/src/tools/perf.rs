// Performance: how the PC is doing right now (CPU, memory, disk, network,
// temperatures and the programs using them), Windows services with a
// recommendation each, game mode, and network fixes. Following Kudu (MIT,
// Advent Development): its list of services and how safe each is to switch
// off (rules/services.json), what its game mode pauses, and its network
// fixes. Every change here can be undone: a service gets back the start type
// it had, and game mode puts back the power plan and the services it paused.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use sysinfo::{Components, Networks, ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};

// ── Now ───────────────────────────────────────────────────────────────────

/// Programs Windows can't run without: never offered to close.
pub const CRITICAL: &[&str] = &[
    "system", "registry", "smss.exe", "csrss.exe", "wininit.exe", "winlogon.exe", "services.exe", "lsass.exe", "lsaiso.exe",
    "svchost.exe", "dwm.exe", "explorer.exe", "fontdrvhost.exe", "memory compression", "secure system", "msmpeng.exe",
    "spoolsv.exe", "audiodg.exe", "sihost.exe", "ctfmon.exe", "searchhost.exe", "startmenuexperiencehost.exe",
    "runtimebroker.exe", "taskhostw.exe", "conhost.exe", "system idle process", "idle", "wudfhost.exe", "lsm.exe",
    "tokkip-healthy.exe",
];

pub fn is_critical(name: &str) -> bool {
    CRITICAL.contains(&name.to_lowercase().as_str())
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Proc {
    pub name: String,
    pub count: u32,
    /// Share of the whole CPU, 0–100.
    pub cpu: f32,
    pub memory: u64,
    pub critical: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    pub cpu: f32,
    pub cores: usize,
    pub cpu_name: String,
    pub memory_used: u64,
    pub memory_total: u64,
    /// Bytes per second.
    pub disk_read: u64,
    pub disk_write: u64,
    pub net_down: u64,
    pub net_up: u64,
    /// Hottest sensor in °C, when Windows shares one.
    pub temperature: Option<f32>,
    pub uptime: u64,
    pub procs: Vec<Proc>,
}

/// Keeps the system's counters between samples (CPU use needs two readings).
pub struct Monitor {
    sys: System,
    nets: Networks,
    last: std::time::Instant,
}

impl Default for Monitor {
    fn default() -> Self {
        Monitor::new()
    }
}

impl Monitor {
    pub fn new() -> Monitor {
        let mut sys = System::new_with_specifics(RefreshKind::everything());
        sys.refresh_all();
        Monitor { sys, nets: Networks::new_with_refreshed_list(), last: std::time::Instant::now() }
    }

    pub fn sample(&mut self) -> Sample {
        let secs = self.last.elapsed().as_secs_f64().max(0.2);
        self.last = std::time::Instant::now();
        self.sys.refresh_cpu_usage();
        self.sys.refresh_memory();
        self.sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::everything().without_environ().without_cmd());
        self.nets.refresh(true);
        let cores = self.sys.cpus().len().max(1);
        let mut by_name: HashMap<String, Proc> = HashMap::new();
        let (mut read, mut write) = (0u64, 0u64);
        for p in self.sys.processes().values() {
            let name = p.name().to_string_lossy().to_string();
            let d = p.disk_usage();
            read += d.read_bytes;
            write += d.written_bytes;
            let e = by_name.entry(name.to_lowercase()).or_insert_with(|| Proc { critical: is_critical(&name), name, count: 0, cpu: 0.0, memory: 0 });
            e.count += 1;
            e.cpu += p.cpu_usage() / cores as f32;
            e.memory += p.memory();
        }
        let mut procs: Vec<Proc> = by_name.into_values().filter(|p| p.name.to_lowercase() != "system idle process").collect();
        procs.sort_by(|a, b| (b.cpu * 4.0 + (b.memory as f32 / 1e8)).total_cmp(&(a.cpu * 4.0 + (a.memory as f32 / 1e8))));
        procs.truncate(14);
        let (down, up) = self.nets.values().fold((0, 0), |(d, u), n| (d + n.received(), u + n.transmitted()));
        let temperature = Components::new_with_refreshed_list().iter().filter_map(|c| c.temperature()).filter(|t| t.is_finite() && *t > 0.0).reduce(f32::max);
        Sample {
            cpu: self.sys.global_cpu_usage(),
            cores,
            cpu_name: self.sys.cpus().first().map(|c| c.brand().trim().to_string()).unwrap_or_default(),
            memory_used: self.sys.used_memory(),
            memory_total: self.sys.total_memory(),
            disk_read: (read as f64 / secs) as u64,
            disk_write: (write as f64 / secs) as u64,
            net_down: (down as f64 / secs) as u64,
            net_up: (up as f64 / secs) as u64,
            temperature,
            uptime: System::uptime(),
            procs,
        }
    }

    /// Closes every process with this name. Never a critical one.
    pub fn end(&mut self, name: &str) -> Result<u32, String> {
        if is_critical(name) {
            return Err("critical".into());
        }
        self.sys.refresh_processes(ProcessesToUpdate::All, true);
        let mut n = 0;
        for p in self.sys.processes().values() {
            if p.name().to_string_lossy().eq_ignore_ascii_case(name) && p.kill() {
                n += 1;
            }
        }
        if n == 0 {
            Err("none".into())
        } else {
            Ok(n)
        }
    }
}

// ── Services ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Known {
    pub safety: String,
    pub group: String,
    pub note_en: String,
}

#[derive(Deserialize)]
struct KnownServices {
    services: HashMap<String, Known>,
}

pub fn known_services() -> HashMap<String, Known> {
    serde_json::from_str::<KnownServices>(include_str!("../../../rules/services.json")).map(|k| k.services).unwrap_or_default()
}

/// Per-user services carry a suffix (CDPUserSvc_3a5f1): the known name is without it.
pub fn service_key(name: &str) -> String {
    let lower = name.to_lowercase();
    match lower.rsplit_once('_') {
        Some((base, suffix)) if !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_hexdigit()) => base.to_string(),
        _ => lower,
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub name: String,
    pub display: String,
    pub running: bool,
    /// "auto", "manual", "disabled" (or "boot"/"system").
    pub start: String,
    /// "safe", "caution" or "unsafe" to switch off.
    pub safety: String,
    pub group: String,
    pub note_en: String,
    /// The start type it had before Healthy PC changed it, if it did.
    pub was: Option<String>,
}

/// Joins what Windows reports (JSON from Win32_Service) with what we know.
pub fn join_services(json: &str, known: &HashMap<String, Known>, changed: &HashMap<String, String>) -> Vec<Service> {
    let v: serde_json::Value = serde_json::from_str(json.trim()).unwrap_or(serde_json::Value::Null);
    let items = match v {
        serde_json::Value::Array(a) => a,
        serde_json::Value::Null => Vec::new(),
        one => vec![one],
    };
    let mut out: Vec<Service> = items
        .iter()
        .filter_map(|i| {
            let name = i["Name"].as_str()?.to_string();
            let k = known.get(&service_key(&name))?;
            Some(Service {
                display: i["DisplayName"].as_str().unwrap_or(&name).to_string(),
                running: i["State"].as_str() == Some("Running"),
                start: i["StartMode"].as_str().unwrap_or("").to_lowercase(),
                safety: k.safety.clone(),
                group: k.group.clone(),
                note_en: k.note_en.clone(),
                was: changed.get(&name.to_lowercase()).cloned(),
                name,
            })
        })
        .collect();
    let rank = |s: &str| match s {
        "safe" => 0,
        "caution" => 1,
        _ => 2,
    };
    out.sort_by(|a, b| rank(&a.safety).cmp(&rank(&b.safety)).then_with(|| a.display.to_lowercase().cmp(&b.display.to_lowercase())));
    out
}

/// `sc.exe config` start= value for a start type.
pub fn sc_start(start: &str) -> Option<&'static str> {
    match start {
        "auto" => Some("auto"),
        "manual" => Some("demand"),
        "disabled" => Some("disabled"),
        _ => None,
    }
}

pub fn safe_service_name(n: &str) -> bool {
    !n.is_empty() && n.len() < 100 && n.chars().all(|c| c.is_ascii_alphanumeric() || "_-.".contains(c))
}

// ── Game mode ─────────────────────────────────────────────────────────────

/// What game mode changed, to put back.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GameSnapshot {
    pub on: bool,
    pub since: u64,
    /// The power plan before (GUID).
    pub scheme: String,
    /// Services it stopped, to start again.
    pub stopped: Vec<String>,
}

/// The GUID in `powercfg /getactivescheme`'s line, in any language.
pub fn scheme_guid(out: &str) -> Option<String> {
    out.split(|c: char| c.is_whitespace() || c == '(' || c == ')')
        .find(|w| w.len() == 36 && w.chars().filter(|c| *c == '-').count() == 4 && w.chars().all(|c| c.is_ascii_hexdigit() || c == '-'))
        .map(|s| s.to_lowercase())
}

/// The services game mode pauses (if running and the app is administrator):
/// Windows Search indexing and Windows Update, which both use the disk.
pub const GAME_PAUSES: &[&str] = &["WSearch", "wuauserv"];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn never_closes_windows_itself() {
        assert!(is_critical("CSRSS.EXE"));
        assert!(is_critical("explorer.exe"));
        assert!(!is_critical("chrome.exe"));
    }

    #[test]
    fn knows_services_and_their_suffixes() {
        let known = known_services();
        assert!(known.len() > 60);
        assert_eq!(known["diagtrack"].safety, "safe");
        assert_eq!(service_key("CDPUserSvc_3a5f1"), "cdpusersvc");
        assert_eq!(service_key("ssh-agent"), "ssh-agent");
        assert_eq!(service_key("Some_Thing"), "some_thing");
        let json = r#"[{"Name":"DiagTrack","DisplayName":"Connected User Experiences and Telemetry","State":"Running","StartMode":"Auto"},
                       {"Name":"Unknown1","DisplayName":"x","State":"Stopped","StartMode":"Manual"}]"#;
        let mut changed = HashMap::new();
        changed.insert("diagtrack".to_string(), "auto".to_string());
        let s = join_services(json, &known, &changed);
        assert_eq!(s.len(), 1, "only services we know something about");
        assert_eq!((s[0].running, s[0].start.as_str(), s[0].was.as_deref()), (true, "auto", Some("auto")));
        assert_eq!(join_services("{\"Name\":\"DiagTrack\",\"State\":\"Stopped\",\"StartMode\":\"Disabled\"}", &known, &HashMap::new()).len(), 1);
        assert!(!safe_service_name("a b"));
        assert_eq!(sc_start("manual"), Some("demand"));
    }

    #[test]
    fn reads_the_power_plan() {
        assert_eq!(
            scheme_guid("GUID del plan de energía: 381b4222-f694-41f0-9685-ff5bb260df2e  (Equilibrado)").as_deref(),
            Some("381b4222-f694-41f0-9685-ff5bb260df2e")
        );
        assert_eq!(scheme_guid("nothing"), None);
    }

    #[test]
    fn samples_this_pc() {
        let mut m = Monitor::new();
        let s = m.sample();
        assert!(s.memory_total > 0);
        assert!(s.cores >= 1);
        assert!(s.procs.len() <= 14);
    }
}
