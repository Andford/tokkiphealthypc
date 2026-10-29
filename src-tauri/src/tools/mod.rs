// The tools, one module each. What long walks share: a cancel button and a
// progress report a few times a second.

pub mod apps;
pub mod cleaner;
pub mod downloads;
pub mod duplicates;
pub mod empty;
pub mod shredder;
pub mod software;
pub mod storage;

use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub tool: &'static str,
    pub files: u64,
    pub bytes: u64,
    pub path: String,
}

/// Lets a walk be cancelled, and tells the page how it goes (at most every 150 ms).
pub struct Progress {
    tool: &'static str,
    cancel: Arc<AtomicBool>,
    last: Mutex<Instant>,
    send: Box<dyn Fn(Report) + Send + Sync>,
}

impl Progress {
    pub fn new(tool: &'static str, cancel: Arc<AtomicBool>, send: impl Fn(Report) + Send + Sync + 'static) -> Progress {
        cancel.store(false, Ordering::SeqCst);
        Progress { tool, cancel, last: Mutex::new(Instant::now() - Duration::from_secs(1)), send: Box::new(send) }
    }

    /// For tests: never cancelled, says nothing.
    #[cfg(test)]
    pub fn quiet() -> Progress {
        Progress::new("test", Arc::new(AtomicBool::new(false)), |_| {})
    }

    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    pub fn tick(&self, files: u64, bytes: u64, path: &Path) {
        let mut last = self.last.lock().unwrap_or_else(|e| e.into_inner());
        if last.elapsed() < Duration::from_millis(150) {
            return;
        }
        *last = Instant::now();
        (self.send)(Report { tool: self.tool, files, bytes, path: path.display().to_string() });
    }
}
