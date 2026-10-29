// Tokkip Healthy PC: the commands the page calls. Each tool lives in tools/,
// what the system answers in platform.rs, what the app remembers in store.rs.

mod health;
mod notice;
mod platform;
mod rules;
mod store;
mod tools;

use std::path::PathBuf;
use tauri::Manager;

struct Dirs {
    data: PathBuf,
}

#[tauri::command]
fn health(dirs: tauri::State<Dirs>) -> health::Health {
    let m = store::load(&dirs.data);
    let (total, free) = platform::system_disk();
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

#[tauri::command]
async fn cleaner_scan() -> Vec<tools::cleaner::RuleScan> {
    tauri::async_runtime::spawn_blocking(tools::cleaner::scan_all).await.unwrap_or_default()
}

#[tauri::command]
async fn cleaner_clean(dirs: tauri::State<'_, Dirs>, ids: Vec<String>) -> Result<tools::cleaner::CleanReport, String> {
    let report = tauri::async_runtime::spawn_blocking(move || tools::cleaner::clean(&ids)).await.map_err(|e| e.to_string())?;
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
        .setup(|app| {
            let data = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("tokkip-healthy"));
            app.manage(Dirs { data });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![health, cleaner_scan, cleaner_clean, relaunch_admin, tokkip_notice])
        .run(tauri::generate_context!())
        .expect("Tokkip Healthy PC no pudo arrancar");
}
