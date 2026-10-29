// What the app remembers between runs: when you last cleaned and how much,
// in a small JSON file in its own folder (%APPDATA%\mx.loperstack.tokkiphealthypc).

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Memory {
    /// Milliseconds since 1970; 0 = never.
    pub last_clean: u64,
    pub last_freed: u64,
    pub total_freed: u64,
    pub cleans: u64,
}

pub fn file(dir: &Path) -> PathBuf {
    dir.join("memoria.json")
}

pub fn load(dir: &Path) -> Memory {
    std::fs::read_to_string(file(dir)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn save(dir: &Path, m: &Memory) {
    let _ = std::fs::create_dir_all(dir);
    // Written beside and swapped in, so a crash never leaves half a file.
    let tmp = dir.join("memoria.json.tmp");
    if std::fs::write(&tmp, serde_json::to_vec_pretty(m).unwrap_or_default()).is_ok() {
        let _ = std::fs::rename(&tmp, file(dir));
    }
}

/// One day's free space on the system disk, for the storage history.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SpaceDay {
    /// Days since 1970 (UTC).
    pub day: u64,
    pub free: u64,
    pub total: u64,
}

/// A year and a bit is plenty.
pub const SPACE_DAYS: usize = 400;

pub fn space_history(dir: &Path) -> Vec<SpaceDay> {
    std::fs::read_to_string(dir.join("espacio.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

/// Records today's space (the last reading of the day wins).
pub fn record_space(dir: &Path, now_ms: u64, free: u64, total: u64) {
    if total == 0 {
        return;
    }
    let mut days = space_history(dir);
    let day = now_ms / 86_400_000;
    match days.last_mut() {
        Some(last) if last.day == day => *last = SpaceDay { day, free, total },
        _ => days.push(SpaceDay { day, free, total }),
    }
    if days.len() > SPACE_DAYS {
        days.drain(..days.len() - SPACE_DAYS);
    }
    let _ = std::fs::create_dir_all(dir);
    let tmp = dir.join("espacio.json.tmp");
    if std::fs::write(&tmp, serde_json::to_vec(&days).unwrap_or_default()).is_ok() {
        let _ = std::fs::rename(&tmp, dir.join("espacio.json"));
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remembers_and_survives_a_broken_file() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load(dir.path()), Memory::default());
        let m = Memory { last_clean: 5, last_freed: 10, total_freed: 30, cleans: 2 };
        save(dir.path(), &m);
        assert_eq!(load(dir.path()), m);
        std::fs::write(file(dir.path()), "{ broken").unwrap();
        assert_eq!(load(dir.path()), Memory::default());
    }

    #[test]
    fn keeps_one_space_reading_a_day() {
        let dir = tempfile::tempdir().unwrap();
        let day = 86_400_000;
        record_space(dir.path(), 10 * day + 5, 100, 1000);
        record_space(dir.path(), 10 * day + 900, 90, 1000);
        record_space(dir.path(), 11 * day, 80, 1000);
        record_space(dir.path(), 12 * day, 0, 0);
        let h = space_history(dir.path());
        assert_eq!(h, vec![SpaceDay { day: 10, free: 90, total: 1000 }, SpaceDay { day: 11, free: 80, total: 1000 }]);
        for d in 0..500 {
            record_space(dir.path(), (100 + d) * day, d, 1000);
        }
        assert_eq!(space_history(dir.path()).len(), SPACE_DAYS);
    }
}
