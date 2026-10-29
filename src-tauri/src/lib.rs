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
}

struct App {
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
        .manage(App { found: Mutex::new(Found::default()), next: AtomicU64::new(0), cancel: Arc::new(AtomicBool::new(false)) })
        .setup(|app| {
            let data = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("tokkip-healthy"));
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
            relaunch_admin,
            tokkip_notice
        ])
        .run(tauri::generate_context!())
        .expect("Tokkip Healthy PC no pudo arrancar");
}
