// Tokkip Healthy PC: the commands the page calls. Each tool lives in tools/,
// what the system answers in platform.rs, what the app remembers in store.rs.
// Scans keep what they found here, by id: the page chooses ids, never paths,
// and every delete checks the file is still what was found.

mod fsx;
mod health;
mod notice;
mod platform;
mod rules;
mod store;
mod tools;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tools::{duplicates, Progress};

struct Dirs {
    data: PathBuf,
}

/// What the last scan of each tool found, by id.
#[derive(Default)]
struct Found {
    big: HashMap<u64, (PathBuf, fsx::Identity)>,
    dups: HashMap<u64, duplicates::Kept>,
    empty: HashMap<u64, PathBuf>,
    downloads: HashMap<u64, (PathBuf, fsx::Identity)>,
    startup: HashMap<u64, tools::software::StartupKey>,
    programs: HashMap<u64, tools::software::Uninstall>,
    leftovers: HashMap<u64, PathBuf>,
}

struct App {
    monitor: Mutex<Option<tools::perf::Monitor>>,
    found: Mutex<Found>,
    next: AtomicU64,
    cancel: Arc<AtomicBool>,
}

impl App {
    fn id(&self) -> u64 {
        self.next.fetch_add(1, Ordering::Relaxed) + 1
    }
    fn found(&self) -> std::sync::MutexGuard<'_, Found> {
        self.found.lock().unwrap_or_else(|e| e.into_inner())
    }
}

fn progress(app: &tauri::AppHandle, tool: &'static str) -> Progress {
    let state = app.state::<App>();
    let handle = app.clone();
    Progress::new(tool, state.cancel.clone(), move |r| {
        let _ = handle.emit("progress", r);
    })
}

/// Runs a slow job off the main thread.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Removed {
    freed: u64,
    files: u64,
    /// Ids left alone: changed since the scan, protected, or Windows said no.
    kept: Vec<u64>,
}

/// Sends files to the Recycle Bin if they are still exactly what was found.
fn trash_checked(list: Vec<(u64, PathBuf, fsx::Identity)>) -> Removed {
    let home = fsx::home();
    let mut r = Removed { freed: 0, files: 0, kept: Vec::new() };
    for (id, path, identity) in list {
        let ok = fsx::identity(&path) == Some(identity)
            && !path.parent().is_some_and(|p| fsx::in_protected_tree(p, &home))
            && fsx::to_trash(&path).is_ok();
        if ok {
            r.freed += identity.len;
            r.files += 1;
        } else {
            r.kept.push(id);
        }
    }
    r
}

// ── Inicio ────────────────────────────────────────────────────────────────

#[tauri::command]
fn health(dirs: tauri::State<Dirs>) -> health::Health {
    let m = store::load(&dirs.data);
    let (total, free) = platform::system_disk();
    store::record_space(&dirs.data, store::now_ms(), free, total);
    let (score, mood, reasons) = health::assess(total, free, m.last_clean, store::now_ms());
    health::Health {
        score,
        mood,
        disk_total: total,
        disk_free: free,
        last_clean: m.last_clean,
        last_freed: m.last_freed,
        total_freed: m.total_freed,
        elevated: platform::is_elevated(),
        reasons,
    }
}

/// Adds what a tool freed to what Tokkip has freed with you.
fn freed(data: &std::path::Path, bytes: u64) {
    if bytes == 0 {
        return;
    }
    let mut m = store::load(data);
    m.total_freed += bytes;
    store::save(data, &m);
}

// ── Limpiar ───────────────────────────────────────────────────────────────

#[tauri::command]
async fn cleaner_scan() -> Vec<tools::cleaner::RuleScan> {
    blocking(tools::cleaner::scan_all).await.unwrap_or_default()
}

#[tauri::command]
async fn cleaner_clean(dirs: tauri::State<'_, Dirs>, ids: Vec<String>) -> Result<tools::cleaner::CleanReport, String> {
    let report = blocking(move || tools::cleaner::clean(&ids)).await?;
    if report.files > 0 {
        let mut m = store::load(&dirs.data);
        m.last_clean = store::now_ms();
        m.last_freed = report.freed;
        m.total_freed += report.freed;
        m.cleans += 1;
        store::save(&dirs.data, &m);
    }
    Ok(report)
}

// ── Almacenamiento ────────────────────────────────────────────────────────

#[tauri::command]
fn drives() -> Vec<platform::Drive> {
    platform::drives()
}

#[tauri::command]
fn space_history(dirs: tauri::State<Dirs>) -> Vec<store::SpaceDay> {
    store::space_history(&dirs.data)
}

#[tauri::command]
fn cancel(state: tauri::State<App>) {
    state.cancel.store(true, Ordering::SeqCst);
}

/// A folder or drive the page asks about must be a real local folder.
fn real_dir(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if !p.is_absolute() || path.starts_with("\\\\") {
        return Err("local".into());
    }
    let m = std::fs::symlink_metadata(&p).map_err(|e| e.to_string())?;
    if !m.is_dir() || m.file_type().is_symlink() {
        return Err("folder".into());
    }
    Ok(p)
}

#[tauri::command]
async fn storage_analyze(app: tauri::AppHandle, root: String) -> Result<tools::storage::Analysis, String> {
    let root = real_dir(&root)?;
    let p = progress(&app, "storage");
    blocking(move || {
        let state = app.state::<App>();
        let mut kept = Vec::new();
        let a = tools::storage::analyze(&root, &p, &mut |path, identity| {
            let id = state.id();
            kept.push((id, (path, identity)));
            id
        });
        state.found().big = kept.into_iter().collect();
        a
    })
    .await
}

#[tauri::command]
async fn big_remove(app: tauri::AppHandle, dirs: tauri::State<'_, Dirs>, ids: Vec<u64>) -> Result<Removed, String> {
    let list: Vec<_> = {
        let state = app.state::<App>();
        let found = state.found();
        ids.iter().filter_map(|id| found.big.get(id).map(|(p, i)| (*id, p.clone(), *i))).collect()
    };
    let r = blocking(move || trash_checked(list)).await?;
    app.state::<App>().found().big.retain(|id, _| !ids.contains(id) || r.kept.contains(id));
    freed(&dirs.data, r.freed);
    Ok(r)
}

#[tauri::command]
async fn duplicates_find(app: tauri::AppHandle, root: String, min: Option<u64>) -> Result<duplicates::Found, String> {
    let root = real_dir(&root)?;
    let p = progress(&app, "duplicates");
    blocking(move || {
        let state = app.state::<App>();
        let mut kept = HashMap::new();
        let found = duplicates::find(&root, &fsx::home(), min.unwrap_or(duplicates::MIN_SIZE), &p, &mut |k| {
            let id = state.id();
            kept.insert(id, k);
            id
        });
        for g in &found.groups {
            let ids: Vec<u64> = g.copies.iter().map(|c| c.id).collect();
            for id in &ids {
                if let Some(k) = kept.get_mut(id) {
                    k.group = ids.clone();
                }
            }
        }
        state.found().dups = kept;
        found
    })
    .await
}

#[tauri::command]
async fn duplicates_remove(app: tauri::AppHandle, dirs: tauri::State<'_, Dirs>, ids: Vec<u64>) -> Result<duplicates::Removed, String> {
    let found: HashMap<u64, duplicates::Kept> = app.state::<App>().found().dups.clone();
    let p = progress(&app, "duplicates");
    let r = blocking(move || duplicates::remove(&ids, &found, &p, &|path| fsx::to_trash(path))).await?;
    freed(&dirs.data, r.freed);
    Ok(r)
}

#[tauri::command]
async fn empty_find(app: tauri::AppHandle, root: String) -> Result<tools::empty::Found, String> {
    let root = real_dir(&root)?;
    let p = progress(&app, "empty");
    blocking(move || {
        let state = app.state::<App>();
        let mut kept = HashMap::new();
        let found = tools::empty::find(&root, &fsx::home(), &p, &mut |path| {
            let id = state.id();
            kept.insert(id, path);
            id
        });
        state.found().empty = kept;
        found
    })
    .await
}

#[tauri::command]
async fn empty_remove(app: tauri::AppHandle, ids: Vec<u64>) -> Result<(u64, Vec<u64>), String> {
    let chosen: Vec<(u64, PathBuf)> = {
        let state = app.state::<App>();
        let found = state.found();
        ids.iter().filter_map(|id| found.empty.get(id).map(|p| (*id, p.clone()))).collect()
    };
    blocking(move || tools::empty::remove(&chosen, &fsx::home())).await
}

#[tauri::command]
async fn downloads_find(app: tauri::AppHandle) -> Result<tools::downloads::Found, String> {
    blocking(move || {
        let state = app.state::<App>();
        let mut kept = HashMap::new();
        let found = tools::downloads::find(&tools::downloads::folder(), &mut |path, identity| {
            let id = state.id();
            kept.insert(id, (path, identity));
            id
        });
        state.found().downloads = kept;
        found
    })
    .await
}

#[tauri::command]
async fn downloads_remove(app: tauri::AppHandle, dirs: tauri::State<'_, Dirs>, ids: Vec<u64>) -> Result<Removed, String> {
    let list: Vec<_> = {
        let state = app.state::<App>();
        let found = state.found();
        ids.iter().filter_map(|id| found.downloads.get(id).map(|(p, i)| (*id, p.clone(), *i))).collect()
    };
    let r = blocking(move || trash_checked(list)).await?;
    freed(&dirs.data, r.freed);
    Ok(r)
}

/// Opens a found file's folder with it selected.
#[tauri::command]
fn reveal(state: tauri::State<App>, id: u64) {
    let found = state.found();
    let path = found
        .big
        .get(&id)
        .map(|f| f.0.clone())
        .or_else(|| found.downloads.get(&id).map(|f| f.0.clone()))
        .or_else(|| found.dups.get(&id).map(|k| k.path.clone()))
        .or_else(|| found.empty.get(&id).cloned());
    if let Some(p) = path {
        fsx::reveal(&p);
    }
}

#[tauri::command]
async fn shred_describe(paths: Vec<String>) -> Result<Vec<tools::shredder::Chosen>, String> {
    blocking(move || {
        let home = fsx::home();
        paths.iter().map(|p| tools::shredder::describe(&PathBuf::from(p), &home)).collect()
    })
    .await
}

#[tauri::command]
async fn shred(app: tauri::AppHandle, paths: Vec<String>) -> Result<tools::shredder::Shredded, String> {
    let p = progress(&app, "shredder");
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).filter(|p| p.is_absolute()).collect();
    blocking(move || tools::shredder::shred(&paths, &fsx::home(), &p)).await
}

// ── Software ──────────────────────────────────────────────────────────────

#[tauri::command]
fn startup_list(state: tauri::State<App>) -> Vec<tools::software::StartupItem> {
    let mut kept = HashMap::new();
    let list = tools::software::startup(&mut |k| {
        let id = state.id();
        kept.insert(id, k);
        id
    });
    state.found().startup = kept;
    list
}

/// Turns a startup program on or off. Err("admin") when it needs administrator rights.
#[tauri::command]
fn startup_set(state: tauri::State<App>, id: u64, on: bool) -> Result<(), String> {
    let key = state.found().startup.get(&id).cloned().ok_or("gone")?;
    if key.source != "user" && key.source != "userFolder" && !platform::is_elevated() {
        return Err("admin".into());
    }
    tools::software::set_startup(&key, on)
}

#[tauri::command]
async fn programs_list(app: tauri::AppHandle) -> Result<Vec<tools::software::Program>, String> {
    blocking(move || {
        let state = app.state::<App>();
        let mut kept = HashMap::new();
        let list = tools::software::programs(&mut |u| {
            let id = state.id();
            kept.insert(id, u);
            id
        });
        state.found().programs = kept;
        list
    })
    .await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Uninstalled {
    gone: bool,
    /// Folders it left behind, to send to the Recycle Bin if you choose.
    leftovers: Vec<tools::apps::Leftover>,
}

/// Where programs leave folders behind.
fn leftover_bases() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = ["APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "ProgramFiles(x86)"]
        .iter()
        .filter_map(|n| std::env::var_os(n).map(PathBuf::from))
        .collect();
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        v.push(PathBuf::from(local).join("Programs"));
    }
    v
}

/// Opens the program's own uninstaller and waits; if it's gone, looks for what it left.
#[tauri::command]
async fn program_uninstall(app: tauri::AppHandle, id: u64) -> Result<Uninstalled, String> {
    let u = app.state::<App>().found().programs.get(&id).cloned().ok_or("gone")?;
    let handle = app.clone();
    blocking(move || {
        tools::software::run_uninstaller(&u)?;
        if tools::software::still_installed(&u) {
            return Ok(Uninstalled { gone: false, leftovers: Vec::new() });
        }
        let mut present = Vec::new();
        tools::software::programs(&mut |p| {
            present.push(tools::apps::Present { name: p.name, location: p.location });
            0
        });
        let gone = tools::apps::Gone { name: u.name.clone(), publisher: u.publisher.clone(), location: u.location.clone() };
        let state = handle.state::<App>();
        let mut kept = HashMap::new();
        let leftovers = tools::apps::find_leftovers(&gone, &leftover_bases(), &present, &fsx::home())
            .into_iter()
            .map(|(path, bytes)| {
                let id = state.id();
                let l = tools::apps::Leftover { id, path: path.display().to_string(), bytes };
                kept.insert(id, path);
                l
            })
            .collect();
        state.found().leftovers = kept;
        Ok(Uninstalled { gone: true, leftovers })
    })
    .await?
}

/// Sends chosen leftover folders to the Recycle Bin.
#[tauri::command]
async fn leftovers_remove(app: tauri::AppHandle, ids: Vec<u64>) -> Result<Removed, String> {
    let chosen: Vec<(u64, PathBuf)> = {
        let state = app.state::<App>();
        let found = state.found();
        ids.iter().filter_map(|id| found.leftovers.get(id).map(|p| (*id, p.clone()))).collect()
    };
    blocking(move || {
        let home = fsx::home();
        let mut r = Removed { freed: 0, files: 0, kept: Vec::new() };
        for (id, p) in chosen {
            let real = std::fs::symlink_metadata(&p).map(|m| m.is_dir() && !m.file_type().is_symlink()).unwrap_or(false);
            let size = tools::apps::folder_size(&p);
            if real && tools::apps::safe_leftover(&p, &home) && fsx::to_trash(&p).is_ok() {
                r.freed += size;
                r.files += 1;
            } else {
                r.kept.push(id);
            }
        }
        r
    })
    .await
}

#[tauri::command]
async fn preinstalled_list() -> Result<Vec<tools::apps::Preinstalled>, String> {
    blocking(|| {
        let out = platform::powershell("Get-AppxPackage | Select-Object Name, InstallLocation | ConvertTo-Json -Compress").unwrap_or_default();
        let v: serde_json::Value = serde_json::from_str(out.trim()).unwrap_or(serde_json::Value::Null);
        let items = match v {
            serde_json::Value::Array(a) => a,
            serde_json::Value::Null => Vec::new(),
            one => vec![one],
        };
        let installed: Vec<(String, String)> = items
            .iter()
            .map(|i| (i["Name"].as_str().unwrap_or_default().to_string(), i["InstallLocation"].as_str().unwrap_or_default().to_string()))
            .collect();
        tools::apps::pick_preinstalled(&installed, &tools::apps::known_apps())
    })
    .await
}

/// Removes these apps for you. Returns the ones removed.
#[tauri::command]
async fn preinstalled_remove(packages: Vec<String>) -> Result<Vec<String>, String> {
    blocking(move || {
        let known = tools::apps::known_apps();
        packages
            .into_iter()
            .filter(|p| tools::apps::safe_package(p) && known.iter().any(|k| tools::apps::matches_known(p, &k.package)))
            .filter(|p| platform::powershell(&format!("Get-AppxPackage -Name '{p}' | Remove-AppxPackage -ErrorAction Stop")).is_some())
            .collect()
    })
    .await
}

/// What winget can update. None when winget isn't on this PC.
#[tauri::command]
async fn updates_list() -> Result<Option<Vec<tools::apps::Update>>, String> {
    blocking(|| {
        let (_, out) = platform::run_hidden("winget", &["upgrade", "--accept-source-agreements", "--disable-interactivity"])?;
        Some(tools::apps::parse_upgrades(&out))
    })
    .await
}

/// Updates one program with winget. True if it worked.
#[tauri::command]
async fn update_run(id: String) -> Result<bool, String> {
    if !tools::apps::safe_id(&id) {
        return Err("id".into());
    }
    blocking(move || {
        platform::run_hidden(
            "winget",
            &["upgrade", "--id", &id, "--exact", "--silent", "--accept-source-agreements", "--accept-package-agreements", "--disable-interactivity"],
        )
        .map(|(ok, _)| ok)
        .unwrap_or(false)
    })
    .await
}

// ── Rendimiento ───────────────────────────────────────────────────────────

#[tauri::command]
async fn perf_sample(app: tauri::AppHandle) -> Result<tools::perf::Sample, String> {
    blocking(move || {
        let state = app.state::<App>();
        let mut m = state.monitor.lock().unwrap_or_else(|e| e.into_inner());
        m.get_or_insert_with(tools::perf::Monitor::new).sample()
    })
    .await
}

/// Closes every process with this name (never one Windows needs).
#[tauri::command]
fn perf_end(state: tauri::State<App>, name: String) -> Result<u32, String> {
    let mut m = state.monitor.lock().unwrap_or_else(|e| e.into_inner());
    m.get_or_insert_with(tools::perf::Monitor::new).end(&name)
}

const SERVICES_FILE: &str = "servicios.json";

#[tauri::command]
async fn services_list(dirs: tauri::State<'_, Dirs>) -> Result<Vec<tools::perf::Service>, String> {
    let data = dirs.data.clone();
    blocking(move || {
        let json = platform::powershell("Get-CimInstance Win32_Service | Select-Object Name, DisplayName, State, StartMode | ConvertTo-Json -Compress").unwrap_or_default();
        let changed: HashMap<String, String> = store::load_json(&data, SERVICES_FILE);
        tools::perf::join_services(&json, &tools::perf::known_services(), &changed)
    })
    .await
}

fn sc(args: &[&str]) -> bool {
    platform::run_hidden("sc.exe", args).map(|(ok, _)| ok).unwrap_or(false)
}

/// Sets a known service's start type (stopping it when switched off), remembering
/// the first start type it had so it can be put back. Err("admin") without rights.
#[tauri::command]
async fn service_set(dirs: tauri::State<'_, Dirs>, name: String, start: String, was: String) -> Result<(), String> {
    let known = tools::perf::known_services();
    let k = known.get(&tools::perf::service_key(&name)).ok_or("unknown")?;
    if !tools::perf::safe_service_name(&name) || (start == "disabled" && k.safety == "unsafe") {
        return Err("refused".into());
    }
    let value = tools::perf::sc_start(&start).ok_or("start")?;
    if !platform::is_elevated() {
        return Err("admin".into());
    }
    let data = dirs.data.clone();
    blocking(move || {
        if !sc(&["config", &name, "start=", value]) {
            return Err("sc".to_string());
        }
        if start == "disabled" {
            sc(&["stop", &name]);
        } else if start == "auto" {
            sc(&["start", &name]);
        }
        let mut changed: HashMap<String, String> = store::load_json(&data, SERVICES_FILE);
        let key = name.to_lowercase();
        match changed.get(&key) {
            // Back to where it was: nothing left to put back.
            Some(orig) if *orig == start => {
                changed.remove(&key);
            }
            Some(_) => {}
            None => {
                changed.insert(key, was);
            }
        }
        store::save_json(&data, SERVICES_FILE, &changed);
        Ok(())
    })
    .await?
}

const GAME_FILE: &str = "modojuego.json";

#[tauri::command]
fn game_status(dirs: tauri::State<Dirs>) -> tools::perf::GameSnapshot {
    store::load_json(&dirs.data, GAME_FILE)
}

/// Game mode on: high performance power plan, no sleep, and (as administrator)
/// Windows Search and Windows Update paused.
#[tauri::command]
async fn game_on(dirs: tauri::State<'_, Dirs>) -> Result<tools::perf::GameSnapshot, String> {
    let data = dirs.data.clone();
    blocking(move || {
        let mut snap: tools::perf::GameSnapshot = store::load_json(&data, GAME_FILE);
        if snap.on {
            return snap;
        }
        snap = tools::perf::GameSnapshot { on: true, since: store::now_ms(), ..Default::default() };
        if let Some((_, out)) = platform::run_hidden("powercfg.exe", &["/getactivescheme"]) {
            if let Some(g) = tools::perf::scheme_guid(&out) {
                if platform::run_hidden("powercfg.exe", &["/setactive", "SCHEME_MIN"]).is_some_and(|(ok, _)| ok) {
                    snap.scheme = g;
                }
            }
        }
        if platform::is_elevated() {
            for svc in tools::perf::GAME_PAUSES {
                let running = platform::run_hidden("sc.exe", &["query", svc]).is_some_and(|(_, out)| out.contains("RUNNING"));
                if running && sc(&["stop", svc]) {
                    snap.stopped.push(svc.to_string());
                }
            }
        }
        platform::keep_awake(true);
        store::save_json(&data, GAME_FILE, &snap);
        snap
    })
    .await
}

fn game_off_in(data: &std::path::Path) {
    let snap: tools::perf::GameSnapshot = store::load_json(data, GAME_FILE);
    platform::keep_awake(false);
    if !snap.on {
        return;
    }
    if !snap.scheme.is_empty() {
        platform::run_hidden("powercfg.exe", &["/setactive", &snap.scheme]);
    }
    for svc in &snap.stopped {
        sc(&["start", svc]);
    }
    store::save_json(data, GAME_FILE, &tools::perf::GameSnapshot::default());
}

#[tauri::command]
async fn game_off(dirs: tauri::State<'_, Dirs>) -> Result<(), String> {
    let data = dirs.data.clone();
    blocking(move || game_off_in(&data)).await
}

/// Network fixes: "dns" (no rights needed), "arp" and "reset" (administrator; reset asks for a restart).
#[tauri::command]
async fn network_fix(what: String) -> Result<bool, String> {
    if what != "dns" && !platform::is_elevated() {
        return Err("admin".into());
    }
    blocking(move || match what.as_str() {
        "dns" => platform::run_hidden("ipconfig.exe", &["/flushdns"]).is_some_and(|(ok, _)| ok),
        "arp" => platform::run_hidden("netsh.exe", &["interface", "ip", "delete", "arpcache"]).is_some_and(|(ok, _)| ok),
        "reset" => {
            let a = platform::run_hidden("netsh.exe", &["winsock", "reset"]).is_some_and(|(ok, _)| ok);
            let b = platform::run_hidden("netsh.exe", &["int", "ip", "reset"]).is_some_and(|(ok, _)| ok);
            a && b
        }
        _ => false,
    })
    .await
}

// ── General ───────────────────────────────────────────────────────────────

/// Opens the app again as administrator and closes this one. False if Windows said no.
#[tauri::command]
fn relaunch_admin(app: tauri::AppHandle) -> bool {
    if platform::relaunch_elevated() {
        app.exit(0);
        true
    } else {
        false
    }
}

/// Tells Tokkip PC (the island) how the PC is, in the user's own words.
#[tauri::command]
fn tokkip_notice(score: u32, mood: String, kind: String, message: String, bytes: Option<u64>) {
    notice::write(score, &mood, &kind, &message, bytes);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(App { monitor: Mutex::new(None), found: Mutex::new(Found::default()), next: AtomicU64::new(0), cancel: Arc::new(AtomicBool::new(false)) })
        .setup(|app| {
            let data = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("tokkip-healthy"));
            // Game mode left on by a closed app: put things back.
            game_off_in(&data);
            app.manage(Dirs { data });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            health,
            cleaner_scan,
            cleaner_clean,
            drives,
            space_history,
            cancel,
            storage_analyze,
            big_remove,
            duplicates_find,
            duplicates_remove,
            empty_find,
            empty_remove,
            downloads_find,
            downloads_remove,
            reveal,
            shred_describe,
            shred,
            startup_list,
            startup_set,
            programs_list,
            program_uninstall,
            leftovers_remove,
            preinstalled_list,
            preinstalled_remove,
            updates_list,
            update_run,
            perf_sample,
            perf_end,
            services_list,
            service_set,
            game_status,
            game_on,
            game_off,
            network_fix,
            relaunch_admin,
            tokkip_notice
        ])
        .build(tauri::generate_context!())
        .expect("Tokkip Healthy PC no pudo arrancar")
        .run(|app, event| {
            // Game mode lasts while the app is open: closing it puts things back.
            if let tauri::RunEvent::Exit = event {
                game_off_in(&app.state::<Dirs>().data);
            }
        });
}
