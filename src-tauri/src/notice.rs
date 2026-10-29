// Tokkip PC (the island) hears how this PC is doing through one small file:
// %APPDATA%\Tokkip\shared\healthy-pc.json (~/.config/Tokkip/shared on Linux).
// The same contract as before: app, version, seq, at, score, mood, kind,
// message and, after a clean-up, bytes. Written beside and swapped in.

use serde_json::json;
use std::path::PathBuf;

pub const MOODS: [&str; 7] = ["happy", "calm", "tired", "dizzy", "worried", "party", "sleep"];
pub const KINDS: [&str; 3] = ["clean", "care", "status"];

fn path() -> Option<PathBuf> {
    let base = if cfg!(windows) {
        PathBuf::from(std::env::var_os("APPDATA")?)
    } else {
        PathBuf::from(std::env::var_os("HOME")?).join(".config")
    };
    Some(base.join("Tokkip").join("shared").join("healthy-pc.json"))
}

/// Leaves the note; quietly does nothing if it can't (Tokkip PC just won't hear).
pub fn write(score: u32, mood: &str, kind: &str, message: &str, bytes: Option<u64>) {
    if let Some(p) = path() {
        write_to(&p, score, mood, kind, message, bytes, crate::store::now_ms());
    }
}

pub fn write_to(p: &std::path::Path, score: u32, mood: &str, kind: &str, message: &str, bytes: Option<u64>, now: u64) -> bool {
    if !MOODS.contains(&mood) || !KINDS.contains(&kind) || message.chars().count() > 300 {
        return false;
    }
    let seq = std::fs::read_to_string(p)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v["seq"].as_u64())
        .unwrap_or(0);
    let mut note = json!({
        "app": "tokkip-healthy-pc", "version": 1, "seq": seq + 1, "at": now,
        "score": score.min(100), "mood": mood, "kind": kind, "message": message,
    });
    if let Some(b) = bytes {
        note["bytes"] = json!(b);
    }
    let Some(dir) = p.parent() else { return false };
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let tmp = p.with_extension(format!("json.{}.tmp", std::process::id()));
    std::fs::write(&tmp, serde_json::to_string_pretty(&note).unwrap_or_default()).is_ok() && std::fs::rename(&tmp, p).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_the_contract_and_counts_up() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("Tokkip/shared/healthy-pc.json");
        assert!(write_to(&p, 92, "happy", "clean", "Liberé 1.2 GB", Some(1_200_000_000), 7));
        assert!(write_to(&p, 92, "calm", "status", "Todo en orden", None, 8));
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(v["app"], "tokkip-healthy-pc");
        assert_eq!(v["seq"], 2);
        assert_eq!(v["mood"], "calm");
        assert!(v.get("bytes").is_none());
        assert!(!write_to(&p, 50, "grumpy", "status", "x", None, 9), "unknown moods are refused");
    }
}
