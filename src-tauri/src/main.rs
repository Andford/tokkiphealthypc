// No console window behind the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Windows' Task Scheduler runs the weekly clean this way: no window.
    if std::env::args().any(|a| a == "--limpiar") {
        tokkip_healthy_lib::scheduled_clean();
        return;
    }
    tokkip_healthy_lib::run();
}
